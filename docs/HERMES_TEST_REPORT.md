# Hermes worker acceptance — September 10, 2026

**PASS — bounded live advisory-worker integration.** Real connection, approvals, diagnostic/result review, cancellation, idle restart/result replay and final regression checks passed. This is not full production-security or forced-interruption certification.

## Latest verified result — September 10

The separate self-managed VPS now serves the restricted pinned Hermes worker through authenticated, allowlisted public TLS. With explicit owner approval, the existing OpenAI credential was provisioned securely on the worker; Ary's endpoint, bearer and restriction confirmation are configured only in its ignored server environment. Neither credential nor endpoint is included in this report. Existing Managed Hermes remains separate and unchanged.

Actual inference uses the owner-selected **`gpt-5.6-sol` / `openai-api`**. The dedicated bootstrap resolves the environment credential through upstream's explicit-key provider path and rejects credential-pool routing, client overrides, auxiliary titles/context compression, tools, MCPs, hooks and worker memory. Actual-agent guards reject nonempty effective toolsets/schemas before execution. These controls do not constitute complete network egress isolation.

| Live or final check                                  | Result                             | Evidence / practical limit                                                                                                                        |
| ---------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authenticated public TLS/provider health             | PASS                               | Real endpoint, bearer and Runs/tool-inventory contract; 674 ms health sample in the isolated live acceptance                                      |
| Real model diagnostic through Ary actions            | PASS                               | `scripts/evaluate-hermes-live.ts`: one submission HTTP attempt, mandatory approval before dispatch, inert result review, canonical audit/outcomes |
| Approved-action replay                               | PASS                               | Same job and remote run; no redispatch; one completed job                                                                                         |
| Reviewed episodic outcome/replay                     | PASS, isolated local store         | One reviewed memory with action provenance, local test embeddings; replay did not duplicate it; no production memory written                      |
| Isolated fixture cleanup                             | PASS                               | Temporary owner/store removed in finally; safe report records cleanup true                                                                        |
| Isolated live total latency                          | 4,739 ms                           | Single whole acceptance run including health, polling, reviews and local storage; not a response-latency average                                  |
| Canonical receipts                                   | 10 actions / 10 outcomes           | Isolated live acceptance, one completed delegated job                                                                                             |
| Physical installed Ary application                   | PASS, diagnostic and result review | Actual signed-in Supabase workspace showed connected status, received the real diagnostic and accepted its Ary review; not a browser-mock claim   |
| Full regression suite                                | PASS — 1,508 tests / 87 files      | Fresh `/tmp/hermes-completion-tests.log`, 24.17 seconds; 45 Hermes cases                                                                          |
| Production build                                     | PASS                               | Fresh isolated `/tmp/hermes-completion-build.log`; existing desktop output preserved                                                              |
| Public authentication/route checks and session audit | PASS, bounded                      | Seven HTTP checks; six sessions with zero tool calls/messages; no auth store                                                                      |
| Canonical completed result after idle restart        | PASS                               | Same key/run/completed status; GET returned original saved result; corrected local check 223 ms                                                   |
| Live cancellation                                    | PASS                               | 2,949 ms total; 1,761 ms confirmed; seven actions/outcomes; one submit/stop; replay and cleanup passed                                            |
| Forced in-flight restart                             | NOT TESTED — limitation            | No hard-kill/chaos run requested; not an additional gate for bounded advisory acceptance                                                          |

**Follow-up security and recovery evidence:** Seven public TLS checks passed: valid bearer 200, absent/incorrect bearer 401, and configuration, profile-alias, remote approval and chat routes 404. Independent read-only worker database inspection found six sessions, zero tool calls and zero tool messages; no additional `auth.json` credential store existed. This verifies those inspected sessions, not a complete network or host compromise assessment.

**Recovery verification passed:** The corrected real-container test retained the same idempotency key/run identity and `completed` status across idle restart. Canonical GET returned the original saved diagnostic summary. The complete corrected local check took 223 ms (2 ms capabilities, 1 ms submission acknowledgement); authentication, inventory and route rejection checks also passed. No data loss was observed. The earlier missing-output assertion incorrectly expected a POST replay acknowledgement to include result text; the harness now fetches canonical GET. Ary's provider now hydrates completed replay acknowledgements through GET using the same run identity; mismatched or missing results fail safely rather than creating a fabricated completed answer or resubmitting. The final 45-worker/1,508-total-test suite, typecheck, repository formatting and isolated production build all passed. Three loopback-harness regressions verify canonical retrieval. No bounded live-acceptance gate remains open.

Live cancellation passed: 2,949 ms total, 1,761 ms to confirmed cancellation, seven actions/outcomes, one submission and one stop request, with audit/idempotency checks and local cleanup. Forced interruption of an active model call has not been tested and is a limitation, not an added gate for bounded advisory acceptance. The physical Supabase-backed Ary diagnostic and its exact `worker.review` are separately verified **COMPLETED**.

Safe machine-readable evidence: [final live acceptance](evidence/hermes-live-final.json), [final verification](evidence/hermes-final-verification.json), [earlier live sample](evidence/hermes-live-acceptance.json), [live cancellation](evidence/hermes-live-cancel.json), [physical app](evidence/hermes-installed-app.json), [remote audit](evidence/hermes-remote-audit.json), [public security](evidence/hermes-public-security.json). The evidence excludes endpoints, credentials and real user context. The installed-app receipt includes only the fixed harmless diagnostic response; the isolated live report records its length rather than raw output. The earlier live run took 6,036 ms with 11 actions/outcomes; the final current-code re-run took 4,739 ms with 10. These are individual acceptance samples, not latency averages. The initial 1,498-test/unconfigured results below are preserved as historical stages, not current connection status.

During installed-app verification, one dashboard request displayed the existing generic profile-initialization error. Subsequent authenticated dashboard/action/permission requests succeeded without migrations or authentication changes. Existing `/api/events` 503 responses remain the separate documented hosted event-journal migration gate; this worker milestone does not mark it resolved.

Temporary credential-transfer files and remote private-key/auth-cache quarantine artifacts were removed; protected persistent worker/Ary environment configuration remains in place. Existing Managed Hermes was not modified.

Limits: no autonomous effect execution, no complete outbound destination allowlist, no provider cost ingestion, no background polling daemon or independent remote watchdog. No new integrations or next milestone were started. Meaningful real outcomes still require explicit reviewed memory; the trivial diagnostic was only used to exercise memory persistence in the disposable fixture.

Exact live-setup files:

- Added deployment: `deploy/hermes/api-only.py`, `compose.yaml`, `config.yaml`, `config.local-acceptance.yaml`, `config.openai-api.example.yaml`, `worker-secrets.env.example`, `traefik-exposure.yaml.example`, `local-acceptance.py`, `test_api_only.py`, `test_deployment_yaml.rb`, `test_env_resolver_upstream.py`, `test_local_acceptance.py`, and `README.md` (all under `deploy/hermes/`).
- Added Ary acceptance commands: `scripts/evaluate-hermes-live.ts`, `scripts/evaluate-hermes-cancel.ts`.
- Extended in place: `src/infrastructure/agents/hermes-agent-provider.ts` and `tests/hermes.test.ts` for interrupted status and terminal-acknowledgement recovery; `.gitignore` protects deployment-local secret/state artifacts.
- Updated documentation: `docs/HERMES_TEST_REPORT.md`, `docs/hermes-worker.md`, `deploy/hermes/README.md`, `ARY_NEXUS_ROADMAP.md`. Safe receipt filenames are linked above under `docs/evidence/`; earlier implementation files remain listed in the architecture document.

No schema migration, unrelated application feature, permissions redesign or additional integration was added. Recommended next step is a user-selected bounded advisory job; do not automatically start another milestone or grant additional authority.

## Historical implementation results

### Initial unconfigured checks

| Check                                             | Result                        | Evidence / limit                                                                                                                                                         |
| ------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Full existing + new Vitest suite                  | PASS — 1,498 tests / 87 files | 23.48 seconds; original 1,463 retained, 35 worker tests added                                                                                                            |
| Final worker tests                                | PASS — 35                     | Re-run after aligning SSE labels with official data-frame envelope                                                                                                       |
| TypeScript                                        | PASS                          | `npm run typecheck`                                                                                                                                                      |
| Formatting                                        | PASS                          | `npm run format:check`                                                                                                                                                   |
| Production build                                  | PASS                          | `npm run build`, isolated mirror; installed desktop output preserved                                                                                                     |
| Browser end-to-end                                | PASS — 12 checks              | Real disposable Next.js app, development Settings diagnostics, exact approval dialog, approved unconfigured failure, action/approval/job history, unchanged seeded tasks |
| Browser fixture cleanup                           | PASS                          | Finally cleanup completed; zero `ary-hermes-e2e-*` directories remained                                                                                                  |
| Actual local Hermes configuration                 | BLOCKED                       | Endpoint false, access key false, restricted-worker confirmation false                                                                                                   |
| Authenticated live health                         | NOT RUN                       | No endpoint/key configured; no latency is invented                                                                                                                       |
| Real diagnostic response                          | NOT RUN                       | No cloud job was sent                                                                                                                                                    |
| Live remote side effects / cancellation / restart | UNVERIFIED                    | Require actual compatible isolated worker and independent remote logs                                                                                                    |
| Production deployment / hosted migration          | NOT PERFORMED                 | Neither requested nor required for local adapter implementation                                                                                                          |

Raw redacted snapshots: [local readiness](evidence/hermes-live-health.json), [browser acceptance](evidence/hermes-browser-result.json), [automated summary](evidence/hermes-verification.json).

The browser evaluator initially failed because its palette navigation used “Permissions” instead of the actual “Settings” destination, then because it assumed the seeded task list was empty. The final attempt used the correct destination and compared task records to their pre-test baseline. No application regression was hidden by those harness corrections.

## What the tests establish

- Every submission requires Ary approval, including level 5; levels 0–3 and rejected approvals cannot dispatch.
- Tool input, owned project scope and run identifiers are validated. Worker authority cannot be supplied in request input. Mandatory execution keys and existing agent/policy ceilings remain.
- Authenticated compatible health requires durable Runs idempotency and disabled tool inventory; missing configuration, unsafe URLs, incompatible versions, enabled toolsets and absent operator restriction confirmation fail closed.
- Redirects are refused. HTTP attempts, bodies and streams are bounded. Raw remote error bodies and actual configured endpoint/key values are not returned; nested JSON-escaped values are redacted. Arbitrary artifacts, commands, callback URLs and remote approvals are not executed.
- Initial database reservation failure sends nothing. Crash/uncertainty after dispatch preserves the original idempotency key for explicit approved recovery. Reconstruction reads the same durable job. Replays do not create duplicate jobs.
- Completed sensitive findings create an existing Ary approval containing the proposal. Accepting that review executes no proposed external effect and grants no remote authority.
- Failed/cancelled/timed-out results remain distinguishable. Stop requests do not masquerade as confirmed cancellation. Cancellation errors remain in history. Emergency stop blocks new jobs while allowing stop requests, subject to explicit policy denial.
- Completed meaningful outcomes can enter existing episodic memory only by explicit review, once per reviewed action; the memory retains action identity and labels results as worker-reported rather than verified truth.

## Important limits

### Historical managed-instance follow-up — September 10

Read-only Safari inspection confirmed the existing managed instance is running (Agent v0.21.0-1). Its public WebUI address returned `{"error":"not found"}` for `/v1/capabilities`. Installed API source contained the capabilities, Runs and durable-idempotency features, but this does not establish public routing or an enabled API server. The environment-name audit found the existing WebUI password and model-provider key; no API-server enable/key configuration was observed. No secret values were revealed.

The managed terminal rejected an attempt to list server configuration directories. No attempt was made to bypass that boundary. No API exposure, tool-policy, credential, service restart or deployment change was performed.

With user authorization, the connection question was sent through Hostinger's support UI and escalated using **Wait for a human review**. The UI confirmed **Your request is being reviewed** and accepted the question asking whether authenticated `/v1/runs` access with all execution tools disabled is supported. The automated assistant could not verify instance-specific ingress; its initial claim that capabilities discovery was absent conflicted with the installed source and is not accepted as compatibility evidence. At 13:03 Pacific, the support UI returned an answer marked **Response reviewed by Matheus**: Managed Hermes does not expose custom loopback ports or customer-configurable API ingress/reverse-proxy routing for the required Runs/capabilities endpoints. Support identified a self-managed Hermes deployment on a VPS as the supported alternative. This is a human-reviewed support answer, not a successful worker test. No ticket identifier was displayed, and no live Ary worker job has run.

Automatic approval review rejected a supplementary note containing internal routing/security details. The shorter question explicitly authorized by the user was accepted instead. No blocked payload was resubmitted through another route.

This follow-up changes documentation only. The earlier automated results remain historical evidence; they were not rerun and do not establish live connectivity. **Live acceptance remains BLOCKED** until supported authenticated routing and independent worker restrictions are verified.

The initial one-month quote was not purchased. The user selected and explicitly approved **KVM 1 for 12 months, $83.88 total, renewing at $12.99/month**, including Hostinger terms. The first attempt did not show a successful receipt; the user confirmed payment failure. After addressing the card and explicitly requesting one retry, checkout displayed **Payment successful**. VPS inventory then showed the new KVM 1 **Running**, expiration **2027-09-10**, Ubuntu 24.04 with Docker and Traefik. The existing Managed Hermes was not cancelled or migrated. The user subsequently prohibited further human support contact; none was initiated after that instruction.

The one-click Hermes template was left undeployed because its form does not expose the required restrictions before startup. Read-only console checks found only the Hostinger Traefik container, host networking, Docker discovery default-disabled, TLS entrypoint/certificate resolver, and SSH/HTTP/HTTPS listeners. No worker credentials were read or changed, and no Hermes API or worker job is running. The server purchase is verified; worker live acceptance is still outstanding.

### Restart compatibility follow-up

The user requested coding helpers. Their source audit found that official Hermes can return `interrupted` after gateway restart. The existing transport now accepts that status and maps it to canonical `FAILED`, retaining an explicit restart/unknown-completion explanation. Unfinished output is discarded; no automatic resubmission or success claim occurs. This extends the existing provider and preserves all public interfaces and approval/action/memory paths.

Files changed: `src/infrastructure/agents/hermes-agent-provider.ts` and `tests/hermes.test.ts`. Three regression cases cover status/result normalization and canonical job/action/outcome reconciliation, error provenance, replay without resubmission, and no unintended memory creation. Fresh verification in the isolated mirror: **38 worker tests, 1,501 total tests / 87 files, typecheck, changed-file formatting, and production build passed**. Full suite duration: 28.73 seconds. Logs: `/tmp/hermes-restart-full-tests.log`, `/tmp/hermes-restart-build.log`. Installed desktop build, actual environment and hosted database remained unchanged. These tests do not establish live Hermes restart acceptance.

Mock protocol/transport fixtures establish the integration contract, not Hostinger's deployed behavior. The managed instance may not expose this Runs API or permit a sufficiently restricted profile. The environment confirmation is an operator assertion, not a sandbox. The adapter cannot independently certify remote file/system/account effects or contain a compromised provider.

No remote watchdog was added: jobs reconcile on explicit refresh or existing Mission steps, and local timeouts are enforced then. Remote compute may continue while Ary is offline; cancellation/restart acceptance remains a live gate. V1 restricts the worker to advisory reasoning over supplied context; unrestricted remote tools/browsing are blocked. Provider cost ingestion and automatic background polling are not implemented; no financial values or progress are fabricated.

See [architecture, exact files and setup](hermes-worker.md). **Next step:** configure a compatible dedicated restricted worker, provide credentials only through the server environment, then run the live readiness and approved diagnostic/recovery tests. Do not deploy or start another milestone automatically.

### Historical no-inference VPS runtime acceptance — September 10

The official pinned Hermes container is now running in an isolated VPS validation directory, bound to **host loopback only**. The existing Traefik configuration and Managed Hermes instance remain unchanged; no public worker route was enabled. The image is pinned by digest in `deploy/hermes/compose.yaml`. A new disposable worker bearer was generated on the VPS into an owner-only environment file without printing it. No model credential was copied, and inference is explicitly disabled in this validation mode.

Observed against the actual container through the authenticated VPS console:

- Missing and incorrect bearer tokens returned 401. Authenticated capabilities matched the Runs contract, including durable idempotency retention of at least 24 hours.
- All reported toolsets were disabled. Non-allowlisted models, sessions, skills, browser-control, configuration and jobs routes returned 404. Inventory alone is not treated as proof of complete isolation.
- The bootstrap blocks model construction in local acceptance mode. A harmless submitted run failed closed; replay returned the same run identity.
- Container replacement retained that failed run and its execution key; a replay after replacement returned the original run rather than duplicating it. This verifies durable failed-job replay, **not interruption of a live model call**.
- Runtime inspection confirmed user `10000:10000`, read-only root filesystem, all Linux capabilities dropped, no-new-privileges, and only host-loopback port publishing. The process list contained container init and Python; no gateway cron runner was started.
- Capability-check latency was 2 ms initially and 1 ms after replacement; complete local check durations were 911 ms and 486 ms. These are VPS-loopback measurements, not Ary-to-Hermes or model-response latency.

Real startup exposed a YAML tmpfs array parsing error. Quoting the complete mount fixed startup; the security option was also quoted for parser portability. A 45-second Compose shutdown grace was added around the bootstrap's 30-second drain.

The additive `deploy/hermes/` package preserves the tested deployment rather than leaving it only in temporary files. Ten bootstrap tests pass both normally and with Python optimization; 25 YAML/security configuration checks pass. No upstream application source is copied. Secret files, runtime data and transfer bundles are ignored.

**Still pending:** authorization to place a model credential on the new VPS, actual model construction/inference with zero tool schemas, live cancellation/in-flight restart, authenticated public TLS, Ary server environment configuration, and the approved diagnostic through Ary's existing action/audit/outcome/memory path. A model-key transfer question is pending; no existing Ary key has been transferred. The integration is not marked complete and no live successful worker result is claimed.

The additive `scripts/evaluate-hermes-live.ts` requires explicit `--live --env-dir /absolute/project/path`. It uses the real Hermes transport with an isolated local owner and the existing ActionService/ToolRegistry, verifies approval before dispatch, result review, audit/outcomes, replay without redispatch and reviewed episodic-memory idempotency, then removes local fixtures. It sends only the fixed harmless diagnostic and no real user context. Its typecheck/format and missing-opt-in rejection passed; **live execution has not run**.

Final resolved Compose configuration reported a 45-second shutdown grace. After applying it and replacing the container again, failed-run identity/replay and all loopback authentication/capability/route checks passed again (2 ms capabilities, 466 ms total). Fresh 38-test worker suite, TypeScript and changed-file formatting also passed. No model credential or public route was enabled.
