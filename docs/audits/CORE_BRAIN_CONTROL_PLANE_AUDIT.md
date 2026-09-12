# Executive Summary

This audit maps the current source implementation from user input through Ary's brain, model routing, memory, tools, permissions, missions, agents, and external adapters. It is source-based and audit-only; no application code, configuration, schema, dependency, or environment file was changed.

The system has a single `AryBrainService.respond` entry path for text and transcribed voice requests. It persists the user message, resolves entities, dispatches domain conversation adapters, retrieves hybrid memory, invokes the configured language-model interface/router, persists the response, and queues extraction/reflection. Effectful work is centrally guarded by `ActionService` and `PermissionService`, although several read/projection paths intentionally call services directly inside an action read gate.

# Canonical Request Flow

```text
Chat UI / voice transcription
  -> POST /api/chat (streaming NDJSON) or voice/transcribe
  -> server/context.ts service composition
  -> AryBrainService.respond()
     -> conversations + user message + extraction_jobs
     -> EntityService.resolveMentions()
     -> domain conversation adapters (orchestration/studio/finance/calendar/task)
     -> identifyIntent() + MemoryService.getRelevantMemories()
        -> pgvector + lexical/graph candidates + hybrid ranking
     -> LanguageModelProvider (normally ModelRouter -> configured provider)
     -> assistant message + model/retrieval telemetry
     -> ActionService audit for brain.respond
     -> response stream
     -> memory.extract / MemoryReconciliationService
     -> optional ReflectionService queue/drain
```

# Brain

- `src/app/api/[...path]/route.ts` is the catch-all Next route; `src/server/http.ts` owns dispatch and streams chat responses around lines 1020–1100.
- `src/services/ary-brain-service.ts` is the canonical `respond()` implementation. It saves messages and extraction jobs, resolves mentions, invokes domain adapters, retrieves memory, invokes `identifyIntent`/`reasonWithUsage`, persists response metadata, then runs reconciliation and reflection.
- `src/services/orchestration-conversation-service.ts`, `studio-conversation-service.ts`, `finance-conversation-service.ts`, `calendar-conversation-service.ts`, and `task-conversation-service.ts` are intent/domain adapters selected in Brain order before general model reasoning.
- Voice converges after STT: `src/server/voice-stream.ts` and `/api/voice/transcribe` produce text; the client submits that text to the same chat/Brain stream. TTS (`voice/speak`) is a separate output action. No alternate voice brain was found.
- `src/services/entity-resolution-service.ts`/`entity-service.ts` provide canonical IDs, aliases, contextual disambiguation, and resolution evidence.
- Possible bypasses: direct domain APIs can invoke services without `AryBrainService` by design (calendar/Gmail/mission/agent/graph HTTP routes); they are not conversational Brain paths. `ActionService` remains their effect gate.

# Model Routing

| Caller/path | Classification | Evidence |
|---|---|---|
| General Brain reasoning, intent, extraction | CANONICAL ROUTER (when enabled) | `src/server/context.ts`; `src/infrastructure/providers/model-router-config.ts`; `src/services/model-router.ts` |
| OpenAI Responses | SPECIALIZED PROVIDER behind router | `src/infrastructure/providers/openai.ts` |
| Compatible OpenAI-style provider | SPECIALIZED PROVIDER behind router | `src/infrastructure/providers/compatible.ts`, `routed-chat.ts` |
| Development stub | MOCK/TEST ONLY and explicit `ARY_LLM_PROVIDER=mock` | `src/infrastructure/providers/local.ts`, context provider validation |
| Embeddings | Provider selected in context, guarded for policy/failure; not the reasoning router | `src/infrastructure/providers/openai.ts`, `local.ts`, `compatible.ts`, `model-router-config.ts` |
| Voice STT/TTS | SPECIALIZED PROVIDER, OpenAI voice classes; action-gated, outside reasoning router | `src/infrastructure/providers/openai-voice.ts`, `src/services/voice-service.ts` |
| Vision/perception and visual control | SPECIALIZED PROVIDER, OpenAI vision; action-gated | `openai-vision.ts`, `openai-visual-control.ts`, `perception-service.ts` |
| Board/agents/missions/planning | CANONICAL `LanguageModelProvider` supplied by context; planning through `ModelRouter` when available | `board-meeting-service.ts`, `agent-runtime-service.ts`, `orchestrator-service.ts` |
| Hermes | HERMES subordinate worker; separate `AgentProvider` transport, never canonical Brain | `src/infrastructure/agents/hermes-agent-provider.ts`, `delegated-job-service.ts` |

Production direct-provider construction exists for the configured primary and per-agent OpenAI model targets, but callers receive the interface/router from `server/context.ts`. The specialized voice/vision providers are intentional capability paths and are not reasoning-model bypasses.

# Memory

`src/services/memory-service.ts` is the canonical durable memory service. It embeds records with model/version metadata, applies user/scope/current/supersession/conflict filters, and merges semantic, lexical, entity-linked, and graph candidates through `src/services/graph-retrieval.ts` and `hybrid-ranking.ts`. `src/services/memory-reconciliation-service.ts` processes durable extraction jobs, source messages, contradiction/supersession evidence, and review state; `src/services/contradiction-guard.ts`, `relationship-validity.ts`, and `nexus-memory.ts` enforce lifecycle rules. `NexusMemoryService` exposes the richer knowledge/memory projection.

Conversation history is `conversations`/`messages`; extraction jobs are persisted separately. Source evidence is represented by `memory_sources`; conflicts and memory history are exposed by HTTP review routes. Automatic writes occur after Brain responses through `memory.extract` and reconciliation; manual/reviewed updates use memory APIs and action gates. Temporary model context is the bounded Brain `history` and retrieved `MemoryHit[]`; Hermes receives scoped job context and does not own canonical user memory. Agents share the repository/user memory services; no independent agent memory store was found.

# Tool / Permission / Action Pipeline

`src/services/action-request-service.ts` creates/validates requests and uses the central `ToolRegistry` (`src/domain/tool-registry.ts`) plus registered adapters. `src/services/action-service.ts` performs validation, permission resolution, exact-input fingerprinting, approval consumption, idempotency replay, execution, outcomes, model/action telemetry, cancellation, and audit rows. `src/services/permission-service.ts` owns policies, approval review, emergency stop, and permission classes. `src/server/http.ts` exposes request/history/review/retry routes.

Representative path: Brain/domain adapter -> `ActionRequestService.request()` -> `ActionService.run()` -> `PermissionService.resolve()` -> exact fingerprint/approval lookup -> registered tool handler -> transactional mutations/result -> `actions`, `outcomes`, `model_calls`, and Nexus events. Retry uses execution keys and replay protection. External Calendar, Gmail, Twilio calls, Desktop/Browser, Premiere, Design, Studio, Perception, and control adapters are registered through `createActionToolRegistry` in `src/server/context.ts` and do not intentionally execute outside this gate. Read-only projections may call a service inside `actions.run` to preserve the read audit boundary.

# Missions

`src/domain/mission.ts` defines the durable MissionEngine contract and states. `src/services/checkpoint-mission-engine.ts` is the current implementation: leases work, plans/checkpoints, pause/resume/cancel/retry, submissions, wake/deadline handling, and recovery. It delegates actual plan creation/step execution to `OrchestratorService`; every step retains per-step approvals and action evidence. `mission-tools.ts`, `mission-control-service.ts`, and HTTP routes provide inspection/control. It does not replace the action or memory systems.

# Orchestrator

`src/services/orchestrator-service.ts` owns execution-plan creation, model planning, dependency-aware step dispatch, control records, verification, retries, and mission reconciliation. It does not own canonical permissions, raw provider transport, or durable memory. Tools are invoked through `ActionRequestService`/`ActionService`; capability discovery uses `ToolDiscoveryService`. It is the execution coordinator beneath Brain and MissionEngine, and supplies dispatch to agents. Responsibility overlap with MissionEngine is intentional layering: MissionEngine owns durable lifecycle/leases, Orchestrator owns plan/step execution.

# Agents

`src/services/agent-runtime-service.ts` owns persistent/ephemeral agent records, parent/child constraints, capabilities, budgets, status, model selection, delegation, and dispatch. Agents use the existing orchestrator and action request pipeline and share repository memory; they are not alternate assistants. Board agents are `src/services/board-meeting-service.ts` structured worker roles whose outputs are consolidated through the existing model/action context. Overlap with Orchestrator is intentional delegation layering; no second tool execution path was found.

# Hermes

`src/infrastructure/agents/hermes-agent-provider.ts` implements the provider-agnostic `AgentProvider` contract (`src/domain/agent-provider.ts`) with server-side URL/key configuration, health/status/result/cancel/event handling, bounded retries/timeouts, redaction, and idempotency. `src/services/delegated-job-service.ts` persists delegated jobs in owner-scoped records, routes sensitive proposals back into Ary approval requests, records status/result/errors, and can capture meaningful outcomes through existing services. Hermes is subordinate infrastructure: it does not receive canonical history/memory authority, permissions authority, or user-facing orchestration control.

# External Adapters

| Adapter | Classification | Evidence |
|---|---|---|
| Google Calendar | IMPLEMENTED_NOT_LIVE / read and approved write | `infrastructure/calendar/google-calendar.ts`, `calendar-tools.ts`, OAuth routes |
| Gmail | IMPLEMENTED_NOT_LIVE / read, summarize, draft, approved send | `infrastructure/gmail/*`, `gmail-tools.ts` |
| Twilio Calls | PARTIAL / implemented, currently blocked until approved Trust Hub KYC | `phone-service.ts`, `twilio-phone.ts`; current 401/20003 evidence |
| Desktop Bridge/macOS | IMPLEMENTED_NOT_LIVE / explicitly env and privacy gated | `desktop/*`, `control/*` |
| Browser/Computer | IMPLEMENTED_NOT_LIVE / permission and origin gated | `playwright-browser.ts`, `mac-accessibility.ts` |
| Premiere | PARTIAL / bridge and deterministic adapter, installation/runtime dependent | `premiere/bridge.ts`, `premiere-tools.ts` |
| Design/Cinema 4D | PARTIAL / bridge adapter, environment dependent | `design/bridge.ts`, `design-tools.ts` |
| Studio/Home Assistant/Amaran | PARTIAL / adapter scaffolding and scene service | `studio/*`, `studio-service.ts` |
| Perception/OpenAI vision | IMPLEMENTED_NOT_LIVE / provider and capture permission gated | `perception-service.ts`, `openai-vision.ts` |
| MCP | IMPLEMENTED_NOT_LIVE / configured servers only | `mcp/adapter.ts`, `mcp/config.ts` |
| Hermes | IMPLEMENTED_NOT_LIVE / diagnostics and provider contract; live only when endpoint/key configured | `hermes-agent-provider.ts` |
| Finance | READ_ONLY / source-backed visibility; no money movement | `finance-service.ts`, `finance-tools.ts` |
| Mobile | NOT_FOUND as a production adapter in this repository | source inventory |

These labels distinguish source implementation from successful live provider verification.

# Responsibility Overlap

- MissionEngine ↔ Orchestrator: INTENTIONAL LAYERING (durable lifecycle vs plan/step execution).
- AgentRuntime ↔ Orchestrator: INTENTIONAL LAYERING (agent identity/delegation vs execution).
- Board ↔ AgentRuntime: POSSIBLE OVERLAP in worker-role orchestration; Board produces structured findings, AgentRuntime owns agent records/dispatch.
- `MemoryService` ↔ `NexusMemoryService`: INTENTIONAL LAYERING (storage/retrieval vs visual knowledge projection).
- `ActionRequestService` ↔ `ActionService`: INTENTIONAL LAYERING (proposal/validation vs execution gate).
- No clear duplicate primary Brain, permission, or durable memory system was found.

# Architectural Invariants

1. **Ary is the only primary assistant identity:** TRUE in the conversational path; Hermes/agents are subordinate.
2. **One canonical persistent memory system:** TRUE; repository memories plus source/conflict/history tables are used by Brain, agents, and Hermes outcome capture.
3. **One canonical permissions system:** TRUE; `PermissionService`/`ActionService` gate effects.
4. **One canonical action/audit pipeline:** TRUE for registered tools and external adapters.
5. **External effects pass through ToolRegistry/actions:** TRUE for adapters constructed in `server/context.ts`; provider internals are only reached by registered handlers.
6. **Approvals bind exact inputs:** TRUE via action fingerprint/policy hash and approval consumption.
7. **Hermes is subordinate:** TRUE; provider and delegated-job service explicitly preserve Ary authority.
8. **Voice is an I/O surface:** TRUE; STT text joins chat Brain and TTS is output.
9. **Missions/agents cannot bypass permissions:** TRUE in registered execution paths; this remains a regression-sensitive invariant.
10. **Provider failures do not silently become mock success:** TRUE by configuration and router behavior; mock requires explicit `ARY_LLM_PROVIDER=mock`, and guarded embeddings fail/degrade with explicit telemetry rather than relabeling cloud results.

# Risks Found

## Risk 1
SEVERITY: MEDIUM

EVIDENCE: `src/server/http.ts` exposes many domain read/projection routes that construct services directly, while `AryBrainService` is only the conversational path.

IMPACT: Future developers may mistake direct domain routes for Brain bypasses or add effectful work outside the action gate.

DO NOT FIX YET: yes

## Risk 2
SEVERITY: MEDIUM

EVIDENCE: `src/server/context.ts` constructs specialized OpenAI voice/vision providers outside `ModelRouter`; `src/services/model-router.ts` only governs reasoning/planning/extraction tasks.

IMPACT: Provider policy/observability is split by capability and needs explicit documentation when adding providers.

DO NOT FIX YET: yes

## Risk 3
SEVERITY: MEDIUM

EVIDENCE: Adapter classifications above rely on source and test reports; Calendar/Gmail/Hermes/Desktop/Premiere/Studio availability is environment- and credential-dependent.

IMPACT: A green fixture/unit suite does not prove external live execution.

DO NOT FIX YET: yes

## Risk 4
SEVERITY: LOW

EVIDENCE: `src/services/ary-brain-service.ts` dispatches multiple domain adapters in a fixed precedence order before general model reasoning.

IMPACT: Adding a new intent adapter can shadow a later adapter if precedence and ambiguity handling are not tested.

DO NOT FIX YET: yes

## Risk 5
SEVERITY: LOW

EVIDENCE: `src/services/delegated-job-service.ts` stores delegated jobs in owner-scoped message metadata while actions/outcomes remain separate records.

IMPACT: Cross-record diagnostics require joins/projections and can be harder to inspect than a dedicated job table.

DO NOT FIX YET: yes

# Safe Follow-Up Work

- **SAFE_FOR_SMALL_MODEL:** add documentation links/tests that assert the Brain convergence path; add adapter status checks that do not change execution; expand audit fixtures for action fingerprint replay.
- **REQUIRES_STRONG_REASONING:** reconcile precedence between domain conversation adapters and general intent routing; evaluate model-policy consistency across specialized voice/vision providers; improve mission/agent overlap diagnostics.
- **REQUIRES_OWNER_INPUT:** choose which external adapters should be live-enabled; define whether direct read projections should appear in the unified Brain trace; approve any changes to provider fallback or memory retention policy.
- **BLOCKED_BY_EXTERNAL_PROVIDER:** Twilio outbound calling until Trust Hub primary compliance is approved; Gmail/Calendar until OAuth/provider access is valid; Hermes until endpoint/credential health succeeds; Premiere/Studio/Desktop until local bridges and privacy permissions are available.
