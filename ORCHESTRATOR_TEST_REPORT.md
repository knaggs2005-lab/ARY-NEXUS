# Ary Jarvis Orchestrator v1 — September 8, 2026

## Audit and preserved systems

Read the canonical roadmap and AGENTS instructions before editing. Inspected ToolRegistry, ActionRequestService, ActionService, PermissionService, repository transactions/CAS, Board advisory orchestration, Studio/Premiere planners, task mutations, memory source creation, provider context limits, HTTP authentication/origin policy and dashboard/palette composition.

Already present: shared memory/entities/retrieval, advisory Board, provider reasoning/telemetry, exact approvals, durable action keys, action/outcome storage, transactional tasks/projects, Studio/Premiere/Design inspect/plan interfaces, Calendar/Gmail and Desktop adapters. No missing-capability rebuild was needed. Native/live integration gaps remain unchanged.

Added a bounded coordinator over those interfaces. All domain execution uses ActionRequestService; no direct tool execution from the model, alternate permission pipeline, external SDK or new framework.

## Added files

| File                                                  | Purpose                                                                                                                                                        |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/domain/orchestration.ts`                         | Plan DAG/schema, states, strict bounded dependency references.                                                                                                 |
| `src/services/orchestrator-service.ts`                | Shared-context planning, checkpoint/CAS scheduler, exact per-step dispatch, recovery, read-back verification, concise summaries and reviewed memory promotion. |
| `src/infrastructure/tools/orchestrator-tools.ts`      | Three plan control tools and read-only `task.inspect` registration using the existing task snapshot.                                                           |
| `src/components/orchestrator/orchestrator-panel.tsx`  | Goal/structured plan input, dependency/status view, existing approval dialog, pause/stop/recovery and reviewed memory controls.                                |
| `src/components/orchestrator/orchestrator.module.css` | Scoped glass panels, informative status emphasis, restrained motion and reduced-motion support.                                                                |
| `tests/orchestrator.test.ts`                          | 31 focused cases, including parametrized permission levels.                                                                                                    |
| `scripts/evaluate-orchestrator.ts`                    | Ten isolated browser acceptance checks through the actual internal pipeline.                                                                                   |
| `scripts/evaluate-orchestrator-live.ts`               | Real-model planning plus approved synthetic internal task/read-back acceptance.                                                                                |
| `ORCHESTRATOR_TEST_REPORT.md`                         | This report.                                                                                                                                                   |

## Existing files modified and why

| File                                       | Additive change                                                                                                                                                                                                                                                        |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/domain/permissions.ts`                | Plan/review/advance capability definitions and read-only task inspection permission.                                                                                                                                                                                   |
| `src/services/action-request-service.ts`   | Plan/task project scope inheritance; orchestration idempotency requirement; real-tool labeling; exclude plan operations from generic automatic memory conversion; optional server-owned `ary_orchestrator` audit identity with unchanged default for existing callers. |
| `src/services/memory-service.ts`           | Optional atomic commit arguments for deterministic memory ID plus plan-version check. Existing callers keep the original method behavior. Reuses embedding validation and canonical repository/source infrastructure.                                                  |
| `src/domain/providers.ts`                  | Optional provider-neutral `planWithUsage` interface; existing implementations/callers remain compatible.                                                                                                                                                               |
| `src/infrastructure/providers/openai.ts`   | Implement planning on the existing Responses transport/model/telemetry; separate bounded catalog avoids truncating schemas at Chat's 10,000-character input limit. Chat behavior and model configuration unchanged.                                                    |
| `src/server/context.ts`                    | Compose/register the coordinator with current shared services.                                                                                                                                                                                                         |
| `src/server/http.ts`                       | Authenticated plan-history read route. All writes use the existing action endpoint.                                                                                                                                                                                    |
| `src/components/dashboard.tsx`             | Jarvis tab/view.                                                                                                                                                                                                                                                       |
| `src/components/commands/command-index.ts` | Same Jarvis destination in ⌘K.                                                                                                                                                                                                                                         |
| `package.json`                             | Two acceptance commands. No dependency installation.                                                                                                                                                                                                                   |
| `README.md`, `ARY_NEXUS_ROADMAP.md`        | Setup, contracts, recovery boundaries and evidence/status.                                                                                                                                                                                                             |

**Migrations: none.** Existing conversations/messages/actions/outcomes/memories and optimistic transaction infrastructure are reused. No production environment, model allowance, credentials, native plugin or device configuration changed.

## Verification results

- **888 automated tests / 57 files passed**, including **31 orchestration cases**.
- TypeScript, configured Prettier checks and production build passed. No separate lint script exists.
- **10 isolated browser checks passed**: Jarvis navigation, reviewed structured plan, exact step approval, zero task before approval, actual internal task, read-back verification, dependent execution, action/outcome agent attribution, idempotent task replay and reviewed central outcome memory. Used a disposable Next application and LocalRepository with mock/local providers; no external effects. Temporary app/data/browser removed. Screenshot: `/tmp/ary-orchestrator-e2e.png`.
- One real configured-model acceptance rerun passed: planning → task approval → actual temporary task → separate observation → exact title verified. Original intent and action/model/outcome references persisted in the isolated store; cleanup removed all fixtures. No Supabase account created.

| Successful live sample                  | Result                                                        |
| --------------------------------------- | ------------------------------------------------------------- |
| Model                                   | `gpt-5.6-sol`, existing OpenAI Responses provider             |
| Planning latency                        | **6,866 ms**, one successful sample, not an average/SLA       |
| Input / output tokens                   | **17,919 / 367**                                              |
| Estimated model cost                    | **$0.079016**, current application estimate, not an invoice   |
| Proposed effect / verification          | `create_task` / `task.inspect` title equality                 |
| Result                                  | One approved real task in the temporary local store, verified |
| External effects                        | Zero                                                          |
| Retrieval/embeddings in this acceptance | Local development embeddings; no new semantic-recall claim    |

The first real planning attempt used an incorrect verification path. Execution was not declared verified; the coordinator stopped at the mismatched criterion. The contract was clarified to distinguish dependency envelope paths from verification result paths. A new isolated run passed; both runs cleaned their records. No silent path correction or fabricated verification was used. Model-generated plans can still be invalid or incomplete; they must validate and remain reviewable.

Test coverage includes permission levels 0–3, exact approval/rejection, permission revocation after approval, cyclic/duplicate dependencies, unknown tools, mutating verification rejection, prototype/injection bindings, missing inputs, receipt-only unverified state, failed read-back, concurrent advance, lost checkpoint after successful effect, pending approval recovery, unresolved in-flight guard, database rollback and fresh-approved retry, stop/skip, foreign plan isolation, old summary rejection, scoped project control denial, original action retained on verification failure, noncritical failure with independent work, uncertain receipt retry rejection, atomic memory rollback and concurrent memory deduplication. Studio/Premiere/Calendar observation ordering is covered with explicitly stubbed registered tools; it is not native/Google acceptance.

## Execution and privacy boundaries

- Up to 12 ordered steps, serial execution, one tool phase per request, at most two explicit safe retries and 160 checkpoint events. The browser drives advancement after an explicit Run command. No background schedule or independent worker while the app is closed.
- Planning uses resolved shared entities and up to four retrieved memories; relevant capability domains are selected from the existing registry. Catalog bounds: 80 capabilities / 90,000 characters. No database dump in the prompt. Provider cost remains visible in existing action-linked telemetry.
- Every dispatch rechecks current policy and exact inputs. Approvals never transfer between steps/attempts or imply permission for unrelated tools. Existing adapter preflight, revision, tenant, path and delivery-receipt checks remain authoritative. Planning does not enable disconnected services.
- `verified` on observations/planning means receipt completion, explicitly labeled; it does not prove later effects. Mutation verification requires a registered non-simulated observe tool and exact scalar read-back equality. No criterion means `needs_verification` and paused dependants. Mismatch/partial/uncertainty stops dependent work; critical failure skips remaining planned work.
- Successful effects and immutable action evidence survive plan checkpoint failure. Recovery uses saved action receipts/pending approval. Missing or still-running receipts do not automatically retry. There is no compensation engine, arbitrary expression evaluator or automatic replan.
- Goal/plan/input/result summaries are durable existing records, potentially containing sensitive tool content. They are not silently added to permanent memory. Outcome memory requires separate exact revision/summary approval and preserves action references; no user fact supersession. A memory-write success followed by outer audit failure can be retried with the existing reviewed record ID without duplicating memory.
- Plan events are bounded history inside the current message checkpoint; domain actions, approvals and outcomes remain the durable audit. Plan discovery currently scans owner messages and returns the latest 30; this is not a large-scale indexed scheduler. No schema rollout or independent Supabase-backed workflow acceptance was performed in this milestone.

## Known limitations and next verification

The full request “prepare studio → open yesterday's interview → selects → reserve 90 minutes” has **not** been run against real devices, Premiere or Google Calendar. Their previously recorded setup/native acceptance prerequisites remain. Missing file paths, project/sequence IDs, presets, time zone or source settings require clarification and a new reviewed plan. Studio/Premiere/Design planner outputs can bind their exact approved request inputs; adapters still enforce their own freshness and recovery.

V1 does not automatically adapt/revise a plan after new observations, accept arbitrary natural-language success predicates, infer causality from receipts, or execute transformed pending approvals outside its fixed plan. A changed scope needs a revised plan, with old history retained. Some registered adapters lack a suitable machine-readable read-back criterion; these stop as unverified rather than receiving a false green check. Cancel/pause cannot recall an external effect already in flight. Long-running/crashed calls need operator recovery.

Recommended next milestone: controlled multi-domain live acceptance after the existing native/Calendar prerequisites are configured, beginning with harmless observations and one approved effect. Do not broaden autonomy or start another milestone automatically.
