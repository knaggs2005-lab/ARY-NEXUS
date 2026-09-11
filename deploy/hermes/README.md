# Restricted Hermes worker deployment

This additive package deploys an advisory worker behind Ary's existing `AgentProvider`, ToolRegistry, permissions, approvals, actions, audit and memory. It does not add an Ary execution pipeline or change application providers, schemas or UI. Ary remains authoritative.

## Verified status — September 10, 2026

The setup session verified the pinned Docker image on an actual isolated VPS:

- Authenticated loopback capabilities, missing/incorrect-key rejection, disabled tool inventory and blocked broader API routes passed.
- Capabilities latency was 2 ms initially and 1 ms after container recreation; complete local probes took 911 ms and 486 ms respectively. These are API checks, **not inference latency**.
- A no-inference run failed closed, and the same idempotency key returned the same run before and after container recreation.
- Those initial compatibility checks used no model credential and did not verify successful reasoning, actual-agent schemas during inference, public TLS, an Ary-approved live diagnostic or an end-to-end outcome. The owner subsequently explicitly approved secure reuse of the existing OpenAI credential. Current live acceptance is tracked in [the canonical Hermes test report](../../docs/HERMES_TEST_REPORT.md).

The subsequent owner-approved live setup now passes authenticated public TLS and real `gpt-5.6-sol` / `openai-api` inference through Ary's mandatory approval, review, audit/outcome and idempotency path. The isolated live check took 4,739 ms total with 10 actions/outcomes in its final current-code run and verified local-fixture cleanup; its episodic-memory exercise used local test embeddings. The physical signed-in Ary app also received a real diagnostic and approved its result review. Seven public authentication/route checks and independent zero-tool session inspection passed. Live cancellation passed with confirmed status, audit, replay and cleanup. Idle restart preserved key/run identity/completed status and canonical GET returned the original result (223 ms corrected local check). The harness was corrected to fetch result text rather than expecting it in the POST acknowledgement; no data loss was observed. Ary terminal-replay hydration and final regression passed: 45 worker cases, 1,508 total tests, typecheck, formatting and isolated production build. Bounded live advisory acceptance is PASS. Forced in-flight restart has not been tested and is a limitation rather than an additional gate for bounded live advisory acceptance. See [current acceptance](../../docs/HERMES_TEST_REPORT.md#latest-verified-result--september-10); the loopback results above describe the earlier no-inference stage.

## Pinned runtime and boundaries

Official image:

```text
nousresearch/hermes-agent@sha256:ba6caded2d3cf57336b881cf54f8533d384095f06360324228f0d2df2e30c66b
```

The registry OCI revision matches audited upstream source `564aef2946c436500a5e80ee117b66b789b3f99a`. This package contains no copied Hermes codebase or bundled reference sources.

- [Pinned upstream source](https://github.com/NousResearch/hermes-agent/tree/564aef2946c436500a5e80ee117b66b789b3f99a)
- [Official API documentation](https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server/)
- [Official Docker documentation](https://hermes-agent.nousresearch.com/docs/user-guide/docker/)

`api-only.py` is a small custom bootstrap around the pinned **internal** `APIServerAdapter`, not an upstream-supported startup contract. It retains upstream Runs execution, durable idempotency and cancellation. It skips `GatewayRunner`, whose normal startup starts cron scheduling unconditionally, and registers only health, capability/tool inventory, Runs submission/status/events/stop routes. Do not silently replace it with the full gateway if it fails.

The bootstrap supplies the approved environment credential through upstream's supported `resolve_runtime_provider(explicit_api_key=..., explicit_base_url=..., target_model=...)` path, which precedes credential-pool loading. Its isolated process hook fixes provider, endpoint and configured model, rejects client credential/routing overrides, and rejects any returned credential pool. It keeps the startup rejection of an additional `auth.json` store. The normal upstream env-import path can persist sanitized credential-reference metadata; this deployment avoids that path rather than treating the extra store as approved.

The bootstrap checks explicit empty platform/global toolsets, plugins, MCP and hooks; disabled built-in/external memory; no rule injection or external skill discovery. Before returning an actual agent to the upstream run loop, it checks the agent's effective toolsets, tool schemas, valid tool names, memory flags and memory store/manager, then disables background review. These actual-agent guards are unit-tested and active in the verified live diagnostic path; broader security and recovery acceptance remain separately tracked.

Automatic session titles and context compression are disabled with the pinned runtime's actual settings, `auxiliary.title_generation.enabled: false` and `compression.enabled: false`. The title gate is consumed before request/thread creation in `agent/title_generator.py`; the compression flag is parsed in `agent/agent_init.py` and enforced in `agent/turn_context_compaction.py` and `agent/turn_preflight.py`. Startup rejects missing or enabled auxiliary-title/compression settings, and the actual-agent guard additionally requires `compression_enabled=false` before execution. This avoids unintended auxiliary-model requests for isolated jobs. Keep Ary's bounded context limits: oversized jobs can fail rather than obtain automatic summaries.

The restricted worker can analyze supplied information and prepare proposals. It has no research browser, shell, file tool, messaging tool or other tool execution capability. New capabilities require separate review through Ary's existing architecture.

## Files

- `compose.yaml`: immutable image, UID/GID 10000, read-only image filesystem, dropped capabilities, no-new-privileges, bounded CPU/memory/processes, localhost port publication and public Traefik routing disabled.
- `config.yaml`: review template with explicit restrictions and provider/model placeholders.
- `config.local-acceptance.yaml`: concrete OpenAI/model name for a **no-inference** compatibility check; its `gpt-4o-mini` value is not approved for actual inference by this fixture. It does not change Ary's model configuration.
- `config.openai-api.example.yaml`: owner-selected `openai-api` / `gpt-5.6-sol` worker example. This matches the owner-selected live worker model/provider; successful live acceptance is recorded separately in the canonical test report.
- `worker-secrets.env.example`: empty credential example and explicit local-acceptance mode.
- `traefik-exposure.yaml.example`: optional restricted TLS routing for an existing, separately inspected Traefik installation.
- `local-acceptance.py`: loopback-only auth/inventory/route checks; optional separately authorized inference diagnostic.
- `test_api_only.py` and `test_deployment_yaml.rb`: offline restrictions/lifecycle and manifest checks.
- `test_local_acceptance.py`: three local harness regressions covering canonical GET result retrieval instead of relying on POST acknowledgement output.
- `test_env_resolver_upstream.py`: optional offline check inside the pinned image using its real resolver, disposable state and a fixture key; it rejects network access, pool loading and auth-store writes.

## Local-only acceptance setup

Use a dedicated deployment directory outside the repository. Do not copy Ary or managed-Hermes memory or application files into it. Credential transfer requires explicit owner authorization and the secure provisioning workflow; a separate scoped model key is preferred.

1. Inspect Docker/Traefik and the immutable image revision before starting. Create an empty `data/` directory owned by UID/GID 10000 with mode 0700. Mount the bootstrap/config read-only. The direct non-root startup intentionally skips image s6 initialization, so directory ownership must be prepared first.
2. Copy `config.local-acceptance.yaml` to the deployed `config.yaml`. Set only a newly generated disposable bearer key in protected `worker-secrets.env` (mode 0600), plus:

   ```dotenv
   ARY_HERMES_PROVIDER_KEY_ENV=OPENAI_API_KEY
   ARY_HERMES_LOCAL_ACCEPTANCE=1
   ```

   Do not add an inference credential in this mode. `_create_agent` fails closed before upstream construction. Keep actual key values out of commands, chat, screenshots, logs and version control.

3. Validate Compose without displaying expanded environment values: `docker compose config --quiet`. Keep `traefik.enable=false` and `restart=no` during acceptance.
4. Start only the restricted container. `127.0.0.1:8642` is the host publication; `0.0.0.0:8642` is the private container listener. No host-network/PID namespace, privileged mode, Docker socket, host filesystem or shared credential mount is allowed.
5. Run `python3 local-acceptance.py --env-file worker-secrets.env`. It must report no inference requested/verified, auth required, disabled inventory and denied broader routes. Never treat inventory alone as a complete isolation attestation.
6. Verify a no-inference failure uses the same persistent run on replay, including after container recreation. Fixtures stay only in this dedicated worker data directory. Do not use a real user conversation for compatibility tests.

## Live inference and public connection gates

Before changing out of local-acceptance mode:

- Prefer a **separate scoped model-provider key** with a spending cap and a separate persistent bearer key. Explicit owner approval can authorize secure reuse of an existing model key, as approved for this setup; shared usage limits and credential exposure then apply across both applications. Never substitute a WebUI password, Hostinger key or unrelated managed-provider credential. Use the approved secure provisioning workflow; actual credential entry may need owner handoff.
- For the pinned Hermes revision, the OpenAI provider ID is **`openai-api`**, using `OPENAI_API_KEY` and the registry endpoint `https://api.openai.com/v1`. The alias `openai` is rejected by this runtime. This ID is verified in [upstream hermes_cli/auth.py](https://github.com/NousResearch/hermes-agent/blob/564aef2946c436500a5e80ee117b66b789b3f99a/hermes_cli/auth.py).
- Choose verified provider/model IDs in `config.yaml` and set the selected provider key variable. This restricted deployment currently supports only the reviewed `openai-api` / `OPENAI_API_KEY` mapping. Additional worker providers require source verification and an extension of its explicit credential mapping; Ary's provider-agnostic interface remains unchanged.
- Remove/set `ARY_HERMES_LOCAL_ACCEPTANCE=0` only after those prerequisites. Verify actual constructed agent schemas are empty and both memory stores/managers disabled. Verify no scheduled jobs, plugin activation, external memory provider or side-channel platform.
- With explicit diagnostic authorization, `local-acceptance.py --submit --idempotency-key <stable-test-id> --env-file worker-secrets.env` submits one harmless diagnostic and verifies a same-key replay. Inference spends model quota. It does **not** establish absence of side effects: independently inspect execution logs and before/after state.
- Verify provider failure, stop/cancel and interrupted live-run restart recovery. The bootstrap refuses new work during shutdown, requests upstream interruption and waits up to 30 seconds before closing persistence. Docker has a 45-second grace period. If draining remains incomplete, it exits non-success and preserves uncertain run state for recovery; it does not claim cancellation succeeded. Never blindly resubmit uncertain runs.
- Review DNS/TLS and the optional Traefik overlay against the actual existing configuration. Expose only the allowlisted routes over valid HTTPS. Do not expose profile aliases, approval/steer, cron/jobs, admin, browser/terminal control or general chat endpoints. Verify disallowed routes with a valid credential.
- Configure Ary's existing server-only `HERMES_BASE_URL` and `HERMES_ACCESS_KEY`. Set `HERMES_RESTRICTED_WORKER_CONFIRMED=true` only after independent restrictions verification. Run existing `scripts/check-hermes.ts` and the approval-gated **Test Hermes Worker** in Ary, verifying canonical action/audit/outcome records.

The container needs outbound inference connectivity. Empty tools and container restrictions are **not** a complete egress sandbox. No outbound destination allowlist is implemented here; a runtime vulnerability could still access network resources or writable worker data. Context should remain bounded and non-sensitive until stronger controls are verified.

The upstream API may advertise capabilities for routes removed by this bootstrap. The registered route allowlist and direct rejection tests, not advertising alone, define reachability. Upstream automatically registers `/p/default` aliases internally; the public routing example does not expose them.

## Offline checks

```sh
python3 -m py_compile api-only.py local-acceptance.py
python3 test_api_only.py
python3 -O test_api_only.py
ruby test_deployment_yaml.rb
```

Current focused checks: 17 bootstrap tests in each Python mode, 30 YAML/configuration checks and three loopback-harness regressions. Ruby uses the standard YAML library; Python bootstrap uses PyYAML already supplied by the pinned container. No application dependency change is required.

Preserve state for durable replay while the worker is in use. Retention, backup/restore, security maintenance, scoped quotas and automatic restart policy must be reviewed before production operation. The included ignore rules exclude runtime secrets, data, bundles, logs and local reports; they do not replace careful secret handling.

For the real upstream resolver check, run `python3 test_env_resolver_upstream.py` **inside the pinned image**, with this package available. It clears inherited credentials before upstream imports, uses a disposable configuration and synthetic key, blocks network calls, and asserts two resolutions make no pool/auth-store writes. A successful result is offline resolver evidence only; actual inference and restart verification remain separate.
