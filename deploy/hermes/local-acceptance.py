#!/usr/bin/env python3
"""Real loopback transport checks. Inference requires --submit and --idempotency-key.

Never prints credentials, remote error bodies, response headers, or full run output.
Health-only success does not establish inference or independent tool isolation.
"""
import argparse
import json
from pathlib import Path
import re
import stat
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

OBJECTIVE = (
    "Return a short diagnostic confirming you received this delegated job. "
    "Do not modify files, systems, accounts, or external services."
)
MAX_BYTES = 128000
TERMINAL = {"completed", "failed", "cancelled", "interrupted"}
RUN_ID = re.compile(r"^[A-Za-z0-9_-]{1,160}$")


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def load_key(path):
    source = Path(path)
    if source.is_symlink():
        raise ValueError("credential_file_must_not_be_symlink")
    info = source.stat()
    if not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077:
        raise ValueError("credential_file_requires_owner_only_permissions")
    if info.st_size > 65536:
        raise ValueError("credential_file_too_large")
    matches = []
    for line in source.read_text().splitlines():
        name, separator, value = line.strip().partition("=")
        if separator and name == "API_SERVER_KEY":
            value = value.strip()
            if len(value) > 1 and value[0] == value[-1] and value[0] in "\"'":
                value = value[1:-1]
            matches.append(value)
    if len(matches) != 1 or not matches[0] or "\n" in matches[0] or "\r" in matches[0]:
        raise ValueError("credential_missing_or_ambiguous")
    return matches[0]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:8642")
    parser.add_argument("--env-file", required=True)
    parser.add_argument("--submit", action="store_true")
    parser.add_argument("--idempotency-key")
    parser.add_argument("--poll-seconds", type=int, default=90)
    args = parser.parse_args()
    report = {"transport": "real_loopback", "inference_requested": args.submit,
              "inference_verified": False, "checks": {}, "success": False}
    started = time.monotonic()
    key = ""
    try:
        url = urllib.parse.urlsplit(args.base_url)
        if (url.scheme not in {"http", "https"} or url.hostname not in {"127.0.0.1", "::1"}
                or url.username or url.password or url.query or url.fragment or url.path not in {"", "/"}):
            raise ValueError("numeric_loopback_base_url_required")
        if args.submit and (not args.idempotency_key or not RUN_ID.fullmatch(args.idempotency_key)):
            raise ValueError("submit_requires_stable_valid_idempotency_key")
        if not 1 <= args.poll_seconds <= 180:
            raise ValueError("poll_seconds_must_be_between_1_and_180")
        key = load_key(args.env_file)
        base = args.base_url.rstrip("/")
        client = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())

        def request(path, auth="valid", body=None, idempotency=None):
            headers = {"Accept": "application/json"}
            if auth != "none":
                headers["Authorization"] = "Bearer " + (key if auth == "valid" else "invalid-acceptance-key")
            if idempotency:
                headers["Idempotency-Key"] = idempotency
            data = None
            if body is not None:
                data = json.dumps(body).encode()
                headers["Content-Type"] = "application/json"
            req = urllib.request.Request(base + path, data=data, headers=headers)
            t = time.monotonic()
            try:
                with client.open(req, timeout=10) as response:
                    raw = response.read(MAX_BYTES + 1)
                    if len(raw) > MAX_BYTES:
                        raise ValueError("response_exceeds_limit")
                    payload = json.loads(raw) if raw else None
                    return response.status, payload, round((time.monotonic() - t) * 1000)
            except urllib.error.HTTPError as error:
                status_code = error.code
                error.close()
                return status_code, None, round((time.monotonic() - t) * 1000)

        def check(name, passed):
            report["checks"][name] = bool(passed)
            if not passed:
                raise ValueError("check_failed:" + name)

        check("keyless_401", request("/v1/capabilities", "none")[0] == 401)
        check("wrong_key_401", request("/v1/capabilities", "wrong")[0] == 401)
        status_code, caps, latency = request("/v1/capabilities")
        report["health_latency_ms"] = latency
        check("authenticated_capabilities", status_code == 200 and isinstance(caps, dict)
              and caps.get("object") == "hermes.api_server.capabilities"
              and caps.get("auth", {}).get("type") == "bearer"
              and caps.get("auth", {}).get("required") is True)
        features = caps.get("features", {})
        check("run_contract", all(features.get(k) is True for k in ("run_submission", "run_status", "run_stop")))
        idem = features.get("runs_idempotency", {})
        check("durable_idempotency", idem.get("supported") is True and idem.get("durable") is True
              and isinstance(idem.get("retention_seconds"), (int, float)) and idem["retention_seconds"] >= 86400)
        status_code, inventory, _ = request("/v1/toolsets")
        tools = inventory.get("data") if isinstance(inventory, dict) else None
        check("reported_toolsets_disabled", status_code == 200 and isinstance(tools, list)
              and 0 < len(tools) <= 1000 and all(isinstance(t, dict) and t.get("enabled") is False for t in tools))
        report["tool_inventory_is_not_full_isolation_attestation"] = True
        for route in ("/v1/models", "/v1/sessions", "/v1/skills", "/v1/browser-control", "/api/config", "/api/jobs"):
            check("denied_" + route, request(route)[0] == 404)
        if args.submit:
            body = {"input": json.dumps({"objective": OBJECTIVE, "context": "", "role": "diagnostic"}),
                    "conversation_history": [],
                    "instructions": "You are an advisory worker. Do not call tools or delegate. Return only JSON with summary (string), requiresApproval (boolean), proposals (string array), artifacts (empty array)."}
            status_code, run, latency = request("/v1/runs", body=body, idempotency=args.idempotency_key)
            report["submission_latency_ms"] = latency
            check("diagnostic_accepted", status_code in {200, 201, 202} and isinstance(run, dict)
                  and isinstance(run.get("run_id"), str) and bool(RUN_ID.fullmatch(run["run_id"])))
            run_id = run["run_id"]
            # POST returns an admission/replay receipt, not the persisted result. A replay
            # may already say completed but omit output; always hydrate via GET first.
            status_code, run, _ = request("/v1/runs/" + run_id)
            check("initial_status_identity", status_code == 200 and isinstance(run, dict)
                  and run.get("run_id") == run_id)
            deadline = time.monotonic() + args.poll_seconds
            while run.get("status") not in TERMINAL and time.monotonic() < deadline:
                time.sleep(min(1, max(0, deadline - time.monotonic())))
                status_code, run, _ = request("/v1/runs/" + run_id)
                check("poll_identity", status_code == 200 and isinstance(run, dict) and run.get("run_id") == run_id)
            report["run_status"] = run.get("status") if run.get("status") in TERMINAL | {"queued", "running", "started", "stopping", "waiting_for_approval"} else "unknown"
            status_code, replay, _ = request("/v1/runs", body=body, idempotency=args.idempotency_key)
            check("same_key_same_run", status_code in {200, 201, 202} and isinstance(replay, dict)
                  and replay.get("run_id") == run_id)
            check("diagnostic_completed", run.get("status") == "completed" and isinstance(run.get("output"), str)
                  and bool(run["output"].strip()))
            try:
                summary = json.loads(run["output"]).get("summary", "")
            except (ValueError, AttributeError):
                summary = "Diagnostic completed with unstructured output; inspect through Ary review."
            if not isinstance(summary, str):
                summary = "Diagnostic completed; summary format unsupported."
            summary = summary.replace(key, "[redacted]").replace(base, "[redacted]")
            summary = re.sub(r"Bearer\s+\S+", "Bearer [redacted]", summary, flags=re.I)
            report["summary"] = "".join(c for c in summary if c.isprintable())[:500]
            report["inference_verified"] = True
            report["side_effects"] = "requires_independent_remote_execution_log_review"
        report["success"] = True
    except ValueError as error:
        message = str(error)
        report["error"] = message if re.fullmatch(r"[a-zA-Z0-9_:/.-]{1,120}", message) else "validation_failed"
    except Exception as error:
        report["error"] = "transport_or_runtime_failure:" + type(error).__name__
    report["total_latency_ms"] = round((time.monotonic() - started) * 1000)
    print(json.dumps(report, indent=2))
    return 0 if report["success"] else 2


if __name__ == "__main__":
    sys.exit(main())
