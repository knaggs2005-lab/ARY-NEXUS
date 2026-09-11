# Hermes subordinate cloud worker

Implementation: September 10, 2026. **PASS — bounded live restricted-worker integration.** A separate self-managed VPS uses the owner-approved server-side model credential and authenticated TLS. Existing Managed Hermes remains unchanged. Public authentication/route checks and zero-tool session audit passed; live cancellation passed; idle restart with canonical result retrieval and final terminal-replay regression passed. Forced in-flight restart is an untested limitation, not an additional gate; no hosted schema migration or next milestone is implied.

## Audit and reuse

Read `ARY_NEXUS_ROADMAP.md` and inspected AgentRuntimeService, AgentModelRegistry, MissionEngine/OrchestratorService, ToolRegistry, ActionRequestService, ActionService, PermissionService, canonical messages/actions/outcomes, MemoryService/NexusMemoryService, HTTP/context composition and disposable LocalRepository/Vitest/browser conventions before editing.

Existing agent profiles, assignments, shared memory scope and durable mission steps remain. There was no external AgentProvider/Hermes transport. This addition is a worker boundary, not another brain or agent framework. Existing messages hold versioned owner-scoped jobs, following the current agent/mission persistence pattern. Existing action/outcome records, one-use approvals, execution keys, product/agent policies, emergency stop and Nexus events remain authoritative. No tables or migrations were added.

## Protocol decision and limits

The implementation targets the official Hermes API server Runs contract: capability discovery, durable keyed runs, status, events and stop. Hostinger's managed setup documentation does not establish that a specific user's managed endpoint exposes this API. Compatibility must be demonstrated by the actual instance; the hPanel page URL or Hostinger account API token is not automatically a worker endpoint/key. Sources: [Hermes API server](https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server/), [official transport implementation](https://github.com/NousResearch/hermes-agent/blob/main/gateway/platforms/api_server.py), [official runs implementation](https://github.com/NousResearch/hermes-agent/blob/main/gateway/platforms/api_server_runs.py), [Hostinger managed setup](https://www.hostinger.com/support/hostinger-managed-hermes-overview-and-setup/).

Hermes executes its own tools remotely. Client prompts do not constrain that authority. V1 therefore requires an independently configured **dedicated advisory worker** with tools, MCP integrations, scheduled actions, hooks, shared memory and external tool/account credentials disabled. The dedicated model credential and worker bearer are necessary exceptions and remain server-side. Tool inventory is checked before every submission; because that inventory is not a complete sandbox attestation, an operator confirmation is also required. This code does not remotely configure or prove Hostinger's isolation. If the managed offering cannot provide the required isolation/API, submission remains blocked; use a separately restricted supported worker deployment. Research in V1 means reasoning over explicitly supplied context, not unrestricted remote browsing or shell access.

## Architecture and data flow

`AgentRuntime/Mission/owner intent → ToolRegistry → ActionRequestService → ActionService/PermissionService → DelegatedJobService → AgentProvider → HermesAgentProvider`.

- `AgentProvider` declares submission, status, result, cancellation, optional events and health. `AgentProviderRegistry` supports future implementations without changing orchestration. No current model-provider behavior changed.
- `worker.submit` always requires exact approval, including when a policy level is autonomous. Only bounded objective/context/role text is sent. No database dump, Ary credentials, approval grants, tools, callback URLs or arbitrary commands are sent.
- Owner messages persist the normalized job, source action/conversation/message, requesting agent, project, priority, immutable advisory authority, timestamps, status, errors, text artifacts and audit transitions. Conversation/job reservation commits atomically before dispatch. IDs derive from the owner and original action key.
- Each run uses the job ID as the provider's durable idempotency key. The adapter requires authenticated capability discovery advertising durable keys retained for at least 24 hours. Local recovery is restricted to a 15-minute submission window. `worker.recover` requests approval and resubmits the original saved context with the same remote key; it does not alter existing failed-action replay rules.
- `worker.refresh` reconciles owned remote status. UI refresh/manual Mission steps use existing permissioned requests. No unowned provider IDs are accepted at the tool boundary. QUEUED/RUNNING/WAITING_FOR_APPROVAL/COMPLETED/FAILED/CANCELLED/TIMED_OUT are persisted. Unknown dispatch stays QUEUED with an error rather than falsely implying no remote work; definitive setup failure becomes FAILED.
- Each operation produces existing action/outcome records; nonterminal jobs have pending outcomes. State transitions emit real `agent.worker_status` Nexus events. No invented progress. Final provider errors and timeout uncertainty remain in history.
- All Hermes output is untrusted. V1 conservatively marks completed Hermes findings for Ary review, even if the worker claims no approval is required. `worker.review` is an existing Ary approval request containing the bounded findings. Acceptance records review only. It **never calls Hermes' approval endpoint** or executes a proposal. A separately reviewed exact request to an existing Ary tool is needed for any subsequent effect. A remote pending native tool approval is stopped when reviewed, rather than granted.
- Meaningful completed outcomes can be explicitly remembered from Action History using the existing reviewed episodic-memory path. The memory names the job/provider/action and labels the text worker-reported, not independently verified truth. Nothing imports Hermes memory or silently rewrites existing facts.
- Cancellation is cooperative. Stop requests are not reported as confirmed cancellation; status reconciliation must confirm it. Cancellation remains available during Ary emergency stop, subject to explicit policy denials. Emergency stop prevents new submissions; it does not guarantee that a previously submitted remote compute job immediately stops. No automatic remote rollback is claimed.

## Secure configuration

Use Ary's existing ignored **server-side** `.env.local` or deployment secret environment. `.env.example` contains placeholders only:

```dotenv
HERMES_BASE_URL=
HERMES_ACCESS_KEY=
HERMES_RESTRICTED_WORKER_CONFIRMED=false
```

Set the base to the authenticated HTTPS API root of a compatible restricted Hermes instance; a trailing `/v1` is accepted. Use that instance's API server bearer key. Set the confirmation to `true` only after independently validating its restricted deployment. It is an operator assertion, not a security sandbox. Do not use `NEXT_PUBLIC_` variables or paste keys into chat.

The server never returns the configured endpoint or key. Requests reject redirects and URL userinfo/query/fragments. Provider errors expose only bounded safe messages/status codes; returned text is redacted after JSON decoding, including nested result fields. Artifact content is inert text; links are not fetched or opened. There are no uploads, shell execution or webhook callbacks in this adapter. A request is limited to two attempts where safe, 12 seconds per attempt, 128 KB response bytes. Stop requests are not automatically retried. SSE is bounded to 15 seconds/128 KB/100 lifecycle labels and drops raw payloads. Diagnostics uses explicit refresh; the UI does not keep an indefinite subscription alive.

## Use and verification

1. Configure and verify the restricted worker, then set the three server values and restart Ary.
2. Run `node --import tsx scripts/check-hermes.ts`. This performs read-only authenticated capability/tool-inventory checks, outputs redacted health and exits 2 if not ready. `--env-dir /absolute/project/path` selects an environment directory when running in an isolated build mirror.
3. In development, open **System → Permissions & settings → Hermes**. Check connection. Only configuration booleans, health/status/latency, counts, last success/error and owner job details are displayed. The diagnostics endpoint returns 404 in production.
4. Click **Test Hermes Worker**, inspect the exact harmless diagnostic and approve once. Refresh the job. Review its returned findings in existing Ary approvals. A successful diagnostic must show a real response, stable job ID, action/approval audit and final status. Inspect independent remote execution logs before claiming no remote side effects.
5. Exercise cancellation and, only if dispatch is uncertain, **Recover original submission**. Do not press Test repeatedly to recover a lost receipt: each new test intentionally creates a new approved job.
6. Review a meaningful completed action into memory; inspect its job/action provenance and later recall. The trivial connection diagnostic need not become lasting memory.

Automated commands:

```sh
npx vitest run tests/hermes.test.ts
npm test
npm run typecheck
npm run format:check
npm run build
node --import tsx scripts/evaluate-hermes-browser.ts
```

The browser evaluator creates a disposable Next.js/demo workspace without any credentials, verifies the unconfigured approval/failure path and an unchanged seeded task list, then deletes its fixtures. It is not a live Hermes test. Provider fixtures cover compatibility, redaction, permissions/denial/rejection, scope, crash recovery, idempotency, proposal review, episodic review, cancellation, timeout, emergency stop and database rollback.

## Current acceptance and remaining gates

See [worker test report](HERMES_TEST_REPORT.md). Real authenticated public TLS and the owner-selected `gpt-5.6-sol` / `openai-api` worker passed the fixed diagnostic through Ary's existing approval/action/result-review/audit/outcome path. The isolated live acceptance took 4,739 ms in the final current-code run (one sample), with one submission, 10 actions/outcomes, idempotent approved-action replay and reviewed episodic-memory replay, then verified fixture cleanup. Local test embeddings were used only for that disposable memory check. The signed-in physical Ary app also displayed connected status, received a real diagnostic and accepted its Ary review. Seven public authentication/route checks passed, and independent inspection found six worker sessions with zero tool calls/messages and no extra auth store. Live cancellation passed with audit/replay/cleanup evidence (1,761 ms to confirmation). Idle restart retained job identity/status and canonical GET returned the saved result (223 ms corrected local acceptance). The earlier missing-output assertion was a POST acknowledgement expectation error, not observed data loss. Ary terminal-replay hydration now retrieves the same canonical result and rejects mismatches; 45 worker tests, 1,508 total tests, typecheck, formatting and production build passed. Forced in-flight restart is an untested limitation; neither model output nor tool inventory alone proves absence of side effects.

No background polling daemon was added: the remote run may continue while Ary is closed, and Ary reconciles on refresh or an existing Mission step. Local deadlines are enforced when reconciled, not by an independent remote watchdog. Idle-restart retained-result replay passed; forced interruption during inference has not been validated. Job diagnostics currently project existing owner messages in memory; an indexed paginated query can be added when measured job volume warrants it. Provider token/cost metadata is not yet ingested; no cost estimate is fabricated.

Recommended next step: choose one bounded advisory task to delegate through existing approval. Bounded live acceptance passed, including completed-result GET retrieval after idle restart. Forced in-flight restart is outside this acceptance; no additional milestone starts automatically. Do not expand tool, outreach or financial authority. The deployment does not implement complete egress isolation; keep supplied context bounded. The separate hosted event-journal 503/migration gate remains unchanged.

## Exact files

Added: `src/domain/agent-provider.ts`; `src/infrastructure/agents/hermes-agent-provider.ts`; `src/services/delegated-job-service.ts`; `src/infrastructure/tools/worker-tools.ts`; `src/components/hermes-diagnostics.tsx`; `tests/hermes.test.ts`; `scripts/check-hermes.ts`; `scripts/evaluate-hermes-browser.ts`; `scripts/evaluate-hermes-live.ts`; `scripts/evaluate-hermes-cancel.ts`; `deploy/hermes/`; this document; `docs/HERMES_TEST_REPORT.md`; redacted evidence under `docs/evidence/hermes-*`.

Extended: `src/domain/permissions.ts` (worker capability metadata), `src/domain/tool-capabilities.ts` (remote environment-auth classification), `src/services/action-request-service.ts` (owned job/project scope, mandatory keys, real outcome classification and explicit worker episodic records), `src/services/permission-service.ts` and `src/services/action-service.ts` (permit cancellation during emergency stop), `src/server/context.ts` (provider/service/tool composition), `src/server/http.ts` (development diagnostics), `src/components/permissions-panel.tsx` (development section), `.env.example` (empty server variables), `README.md`, `ARY_NEXUS_ROADMAP.md`, `docs/nexus-current-state.md`.

Preserved: AgentRuntime, MissionEngine, brain/router/providers, memory/retrieval/entities/temporal facts, graph/XYFlow/vgpu, voice, existing APIs and screens, schemas, existing model-provider selection, installed desktop application, existing tests and all prior acceptance statuses. Only the explicitly approved worker environment/credential provisioning and separate restricted worker deployment were performed; no Ary production deployment or next milestone started.
