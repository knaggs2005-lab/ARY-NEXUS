# Nexus Agent Runtime v1

## Audit and preserved systems

ARY already orchestrated canonical missions through `CheckpointMissionEngine` and `OrchestratorService`. Mission leases, checkpoints, recovery, exact approvals, execution keys, ActionService outcomes, the owner repository, central memory and the event bus already existed. Six Board roles and `mission.agent` provided bounded advisory submissions, but did not provide persistent worker identity, inherited scope or budget accounting. Those roles remain available in Daily Board; no personalities are seeded.

This milestone adds scoped identity and dispatch around those systems. It does not introduce an independent agent framework, queue, knowledge store, task model or permission system.

## Contract and lifecycle

`domain/agent.ts` defines `Agent`, `AgentRuntime`, validated configuration, capabilities and limits. ARY is the primary orchestrator. Each worker has a concrete purpose, existing functional specialization, stable UUID, lifetime, parent, capabilities, allowed tools, memory scope, permission ceiling, model profile and budgets. Configuration is immutable; create a new reviewed profile when scope needs to change. Terminated identities and their evidence remain historical.

Persistent agents accept multiple explicit assignments within their budgets. Ephemeral workers accept one assignment. Assignment creates a canonical DRAFT mission; explicit planning and activation in Mission Control remain required. Existing `mission.agent` steps without a profile materialize one ephemeral worker for the actual advisory job, linked to its source action and mission. Idle application startup creates no agents.

Status is projected from canonical mission/action evidence: IDLE, READY, RUNNING, WAITING, APPROVAL_REQUIRED, PAUSED, FAILED, COMPLETED, EXHAUSTED or TERMINATED. Completed persistent workers become idle for another assignment. Parent termination dominates child status. No random background activity exists.

## Storage and execution

Profiles use existing owner-scoped conversation/message records. The profile message uses `metadata.agent_version = "agent-v1"` and `metadata.agent`; configuration, assignment receipts, descendant IDs and reservation keys stay in that record. Optional `plan.mission.agent_id` binds an assignment to its worker **when the mission is created** via a server-only async context. Client mission input cannot supply that identity.

Existing repository batch/CAS updates reserve budgets across the ancestry atomically. Child creation inserts its records and reserves all ancestors' descendant budgets in one batch. Parallel reservation conflicts reload and retry before invoking work. A recovered successful mission-creation receipt repairs a missing profile link without creating a second mission. An unresolved reservation without a successful receipt fails closed and requires inspection; it is not blindly replayed.

Execution path remains:

`agent.submit / agent.delegate → existing mission DRAFT → plan/start → coordinator → agent scope/reservation → ActionRequestService → ToolRegistry → PermissionService → exact approval if needed → ActionService → original tool → outcome / verification / existing reviewed memory path`

Execution keys remain owned by ActionService. Reservations are not another idempotency system. Same-key action replay returns existing results; it does not execute a second task. Run/tool/model reservations include failed attempts and are not refunded automatically. A new reviewed retry may consume another reservation.

## Scope and budgets

- Capabilities: analyze, tools, delegate. Tool access must match capabilities.
- Internal v1 allowlist: `mission.agent`, `agent.delegate`, `create_task`, `update_task`, `update_project_status`, `task.inspect`, `mock.fetch_project_summary`, `mock.create_note`, `mock.draft_message`. Mock tools retain their simulated identity.
- Existing read dependencies (`conversation.read`, `entity.read`, `activity.read`, and scoped `memory.read`) still require owner permission and the worker ceiling. They support bounded context and result verification, not arbitrary external access.
- Effective permission is the minimum of owner policy and worker ceiling. The execution scope participates in the exact approval hash. Owner review followed by mission resume preserves the same scope; no approval bypass is introduced.
- Child capabilities, tools, permission, memory scope and budgets cannot exceed any ancestor. The child uses the parent's model profile. Maximum child depth is three; configured descendants are capped at eight per ancestry budget.
- Limits cover assignments, tool dispatch attempts, advisory model calls, descendants and per-step/model timeout. Parent counters include descendant work. Read dependencies and approval polling are not separate dispatched tool budget units.
- Monetary and token figures are **observations**, not hard spend caps. Actual linked model telemetry is reused when recorded and permitted by `roi.read`. Missing cost stays unknown; parent display is direct usage, while its reservation counters include descendants. No invoice value or financial impact is invented.

Memory scope is `none` or mission-linked central memory. Advisory context has no conversation history; central retrieval is bounded, then filtered to the canonical mission's memory IDs. Entity context is bounded to eight linked entities. There is no agent-owned memory database and no automatic permanent-memory write from an agent's prose. Existing reviewed mission outcome-memory behavior remains authoritative.

## Models and termination

`AgentModelRegistry` resolves server-owned `LanguageModelProvider` profiles. `configured` uses the existing reasoning provider. Optional `ARY_AGENT_OPENAI_MODELS` adds at most five existing OpenAI model IDs when the configured provider is OpenAI. It does not alter the main model, API key, endpoint, provider permissions or fallback policy. Other providers can be registered at composition through the same interface. The local development provider lacks usage-bearing advisory reasoning and reports that limitation visibly; internal task execution does not require a model call.

Termination persists the parent flag, requests cancellation of associated missions and aborts cooperative in-flight model calls in the current process. Every later dispatch rechecks the complete ancestry, including after restart. Retrying termination reissues cancellation after partial interruption. An effect already committed is not undone. A model in another process may finish its current request before the next scope/lease check rejects its late submission; provider charges may still occur. Existing mission lease fencing remains active.

## API and UI

- `GET /api/agents`: authenticated profile/status/mission projection and server model profiles.
- `POST /api/actions/request`: existing endpoint for `agent.create`, `agent.submit`, `agent.delegate`, `agent.terminate`; required request keys, strict registered input schemas, owner isolation, approvals and audit/outcomes remain active.
- AGENTS now opens Agent Runtime; Daily Board remains its second section. Typed, mouse and voice destination navigation share the same command index.
- The inspector exposes purpose, lifetime, scope, budgets, usage, model, parent and mission links. Assignment, child delegation and termination use existing action requests.
- The lazy XYFlow family view contains ARY and real persisted workers, with parent edges and mission-state activity. Newly created/delegated relationships briefly illuminate from recorded timestamps/events. Reduced motion and stale reads disable animation. The family renderer caps at 64 nodes; all loaded profiles remain selectable in the accessible list.
- Existing central Nexus map also projects worker nodes and stored parent/mission edges. Mission Control shows the assigned canonical worker and retains all prior execution controls. Brain Graph/vgpu and unrelated screens remain intact.

## Exact files

Added: `src/domain/{agent,agent-models}.ts`, `src/services/{agent-context,agent-runtime-service}.ts`, `src/infrastructure/tools/agent-tools.ts`, `src/components/agents/{agents-view,agent-family-graph}.tsx`, `src/components/agents/agents.module.css`, `tests/agents.test.ts`, this document.

Extended for identity/scope/atomic assignment: `src/domain/{mission,nexus-events,permissions,tool-registry}.ts`, `src/services/{checkpoint-mission-engine,action-service,action-request-service,permission-service,board-meeting-service,orchestrator-service,nexus-map-service}.ts`, `src/infrastructure/tools/{mission-tools,create-task}.ts`, `src/server/{context,http}.ts`.

Extended for navigation and visualization: `src/components/dashboard.tsx`, `src/components/nexus/destinations.ts`, `src/components/spatial/modules.ts`, `src/components/commands/command-index.ts`, `src/components/orchestrator/{orchestrator-panel,mission-control}.tsx`, `src/components/atlas/map-projection.ts`.

Extended validation/composition documentation: `scripts/lib/mission-fixture.ts`, `scripts/evaluate-nexus-shell.ts`, `.env.example`, `README.md`, `ARY_NEXUS_ROADMAP.md`, `docs/nexus-current-state.md`.

## Validation and deployment boundary

Final gates, September 9, 2026:

| Gate                                   | Result                                                                                      |
| -------------------------------------- | ------------------------------------------------------------------------------------------- |
| Existing baseline before agent changes | 1,054 tests / 66 files passed                                                               |
| Final automated suite                  | **1,088 tests / 67 files passed**, including 34 Agent Runtime cases                         |
| TypeScript                             | `npm run typecheck` passed                                                                  |
| Formatting                             | `npm run format:check` passed; no separate lint script configured                           |
| Production build                       | `npm run build` passed; static shell and dynamic existing API route generated               |
| Normal browser                         | Passed real browser → HTTP → disposable LocalRepository flow                                |
| Reduced-motion browser                 | Same flow passed, including compact 900px layout and all newly created nodes framed visibly |
| External effects                       | None; no real provider calls, accounts, messages or device effects                          |

Agent tests cover stable identity/restart, strict model/tool/config validation, audited control operations, idempotent assignment recovery after a link-checkpoint outage, levels 0–5, denied/rejected/approved/autonomous task behavior, real verification/outcomes, one-assignment lifetime, scope escalation and wrong-parent rejection, concurrent aggregate budget enforcement/CAS retry, model-call budget, parent accounting, cooperative model interruption, owner isolation, empty-memory context, recorded usage/cost visibility and central-map relationships.

Browser acceptance created a persistent worker, submitted an existing task/verification specification, opened the same Mission Control ID, confirmed no task before approval, approved/resumed, read the resulting task and outcome, verified actual worker attribution, created an ephemeral child/edge and terminated both. Normal and reduced-motion runs reported no browser errors; each disposable server, browser session and data directory was removed by the harness. Screenshots were visually inspected. Tests did not call real model providers; advisory output was an explicitly labeled in-process test provider.

Failures found and fixed during validation: internal `activity.read` dependency for task verification; shared typed/voice Agents destination still targeting Board; camera fitting for newly added controlled graph nodes; hidden controls icons. Harness corrections used the installed CLI's standard CSS select syntax and accepted disabled checkpoint controls after confirmed completion. An initial broader shell timing run did not complete; the final focused Agent Runtime flows are the browser acceptance claimed here.

The clean exact-lock verification checkout `/tmp/ary-shell-dependencies` was used because the original workspace had previously unreliable dependency file reads. Changed source/test/script files and README were copied back byte-for-byte; no dependencies were added for this milestone.

This milestone adds **no SQL migration**. Existing deployments still need the prior Nexus event/mission migrations 014/015 and worker configuration before unattended hosted scheduling can be claimed. No hosted database migration, real provider invocation, external execution or deployment is performed by this milestone.

Known limits: delegation creates reviewed child mission drafts; it does not implicitly start children or add a parallel child-result join engine. Existing six functional Board remits are the available specialization categories, with a concrete per-profile purpose. Owner-history materialization remains repository scale debt; family graph is bounded but the profile list has no server cursor yet. Budget reservations conservatively retain failed/uncertain attempts. Advisory retrieval filters the bounded top results, which can omit a relevant allowed memory ranked below that window. No arbitrary code, agent-created tool plugins, recursive free-form planning, autonomous external workers, separate persistent memory, hard dollar budget or independent agent scheduler is added.

## Manual check

1. Open AGENTS and create a persistent delivery specialist with `create_task, task.inspect`, tools capability and ceiling 4. Give it a concrete purpose and bounded limits.
2. Submit an objective with a reviewed existing `PlanSpec` for task creation plus `task.inspect` verification, using a real project UUID. Open its linked Mission Control draft, plan, process the checkpoint and start.
3. Confirm approval is required and no task exists before approval. Approve the exact action, resume and process checkpoints. Inspect the task UUID, worker identity, approval, outcome and verification receipt.
4. For an advisory parent, include `mission.agent, agent.delegate` and delegate capability at ceiling 3 or higher. Delegate a narrower child and confirm a new real node/edge and dormant mission appear.
5. Terminate the parent; check all descendants become terminated and later dispatch is blocked. Reload and confirm identities/history survive. Check normal and reduced-motion rendering.
