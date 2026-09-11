# Ary Multi-Tool Orchestration v1 — implementation and acceptance

Date: September 8, 2026. Ary is the only identity. This report extends, rather than replaces, the historical baseline in `ORCHESTRATOR_TEST_REPORT.md`.

## Result

The bounded software milestone is implemented and verified. Full physical/native/Google cross-domain acceptance is **pending**, not DONE. No external provider was enabled, no real calendar event was created, and no studio device, Premiere project or camera was controlled during these tests.

## Audit: what already existed

The repository already had one OrchestratorService, a bounded DAG specification, shared-context planning through the configured provider, conversation/message checkpoints, CAS claims, child action keys, exact approvals, serial dependency execution, conservative recovery, scalar read-back verification, a plan UI, and reviewed outcome memory. ToolRegistry, ActionRequestService, ActionService, PermissionService, MemoryService, the real task model and all domain adapters were preserved.

The previous baseline was 888 tests / 57 files, 31 coordinator tests and ten fixture browser checks. Its real `gpt-5.6-sol` planning → approved temporary internal task → read-back run passed with planning latency 6,866 ms. Those measurements are historical evidence; this milestone did not rerun paid model planning or physical STT/TTS.

## Additions and extensions

- Same coordinator now executes at most three independent, explicitly whitelisted observations across different domains in one wave. Each still obtains its own permission, action receipt and outcome. Same-domain observations, planner-source-bound steps and mutations stay serial.
- Server presentation supplies objective, action, risk, effective permission preview, approval state, requested execution states, failure classification/recovery guidance, retries and result/evidence references. The original persisted state representation and plan IDs remain compatible.
- Failure classes: transient, permission-related, missing input, unavailable tool, user decision required and critical dependency failure. Optional branch failure leaves independent work available; critical failure stops future effects. Retry remains explicit, bounded and limited to existing safe read/transactional paths.
- Owner-reviewed in-place re-plans preserve before/after specifications and reasons. Completed/uncertain effects cannot be rewritten or removed. Proven undispatched failures may use an alternative. Changed steps get new key generations; previous grants cannot authorize changed effects. No automatic model expansion of approved scope.
- Exact related approval groups use the existing owner-review control plane and immutable approval records. Up to three related non-high-risk snapshots can be reviewed together; unrelated/high-risk groups, stale revisions and altered inputs are rejected. Granting does not execute tools.
- Pause/cancel intents persist in the existing plan conversation even during an in-flight request. Already-running results are retained; subsequent dispatch stops. Resume uses the same coordinator. No compensation, forced kill or blind replay was added.
- A narrow conversation adapter supports plan creation, inspection, pause, resume, exact step approval, skip and cancellation through existing actions. AryBrainService handles both text and transcribed voice. Exact IDs/titles precede domain-name fallback. Ambiguity asks for clarification; context-free cancellation cannot affect unrelated plans. Conversational approval first displays exact inputs, then requires explicit confirmation of the same snapshot.
- Execution Plans replaces prior non-Ary branding in current UI/navigation. Existing glass/motion components remain. Live polling, richer state/evidence, skip controls, exact approval selection, revision editor and before/after history were added only to this screen.
- Reviewed central memory promotion remains the existing single episodic outcome/lesson flow with evidence, deterministic ID and atomic revision validation. Full execution traces remain action history.

## Exact files

| File                                                 | Change / necessity                                                                                                                                        |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/domain/orchestration.ts`                        | Add compatible cancellation/failure/revision/presentation fields and transparent state/failure projection.                                                |
| `src/domain/permissions.ts`                          | Explicit safe-observation flag/whitelist and definitions for reviewed re-plan/group-review control actions. Existing levels and policy evaluation remain. |
| `src/services/orchestrator-service.ts`               | Extend scheduling, per-phase source linkage, durable controls, review/re-plan, snapshot presentation and recovery guidance.                               |
| `src/infrastructure/tools/orchestrator-tools.ts`     | Register new controls and extend the existing advance schema.                                                                                             |
| `src/services/action-request-service.ts`             | Apply existing plan/entity scope validation to the new control verbs.                                                                                     |
| `src/services/orchestration-conversation-service.ts` | New narrow intent adapter into the existing coordinator; no second planner or dispatcher.                                                                 |
| `src/services/ary-brain-service.ts`                  | Optional adapter injection before single-domain routing; shared text/voice handling.                                                                      |
| `src/server/context.ts`                              | Compose that adapter with the existing coordinator.                                                                                                       |
| `src/components/orchestrator/orchestrator-panel.tsx` | Live status, durable controls, step explanation and review/revision composition.                                                                          |
| `src/components/orchestrator/plan-review.tsx`        | Exact approval selection and reviewed revision form/history.                                                                                              |
| `src/components/dashboard.tsx`                       | Rename the existing screen to Execution Plans.                                                                                                            |
| `src/components/commands/command-index.ts`           | Keep the same palette path under Execution Plans.                                                                                                         |
| `tests/orchestrator.test.ts`                         | Extend regression coverage from 31 to 50 cases.                                                                                                           |
| `scripts/evaluate-orchestrator.ts`                   | Extend isolated browser acceptance from ten to twelve checks, including revision UI.                                                                      |
| `README.md`                                          | Replace old serial/fixed-plan guidance with current contracts and limits.                                                                                 |
| `ARY_NEXUS_ROADMAP.md`                               | Update IP-14 and current evidence without marking pending live work DONE.                                                                                 |
| `MULTI_TOOL_ORCHESTRATION_TEST_REPORT.md`            | This report.                                                                                                                                              |

No migration, dependency, API route, provider configuration, environment, desktop package or production database changes. An identical duplicate generated `.next/types/cache-life.d 2.ts` was moved out of the generated directory to resolve a local TypeScript collision; no source was changed for that artifact.

## Verification

- Full suite: **907 tests passed / 57 files**.
- Coordinator coverage: **50 tests passed** (19 additions); existing 31 remain passing.
- TypeScript: `npm run typecheck` passed.
- Formatting: `npm run format:check` passed. No separate lint command is configured.
- Production: `npm run build` passed; static `/`, `/_not-found` and dynamic existing `/api/[...path]` generated.
- Browser: `npm run test:orchestrator` **12/12 checks passed**: navigation, structured plan, visible in-place revision, stable plan ID/paused revision, exact approval, zero pre-approval task, actual temporary task, read-back, dependency ordering, action/outcome attribution, replay dedupe, reviewed central outcome memory. Screenshot inspected at `/tmp/ary-orchestrator-e2e.png`; existing glass styling remains readable. Temporary server/storage/browser fixtures were removed.

The tests exercise successful multi-tool workflow, actual observation overlap, same-domain/write serialization, dependency order, denied/rejected/revoked permissions, transient transactional failure/retry, critical/optional branch handling, reviewed revisions, cancellation/pause during a running read, shared voice/text controls, duplicate requests/CAS, verification mismatch, audit/outcome completeness and evidence-linked memory. Existing tests cover foreign-user access and unsafe expression/binding rejection.

### Realistic scenario

The requested podcast → latest Premiere interview → final-edit task → 90-minute Calendar block runs through one coordinator in an isolated test. Studio/Premiere/Calendar are explicitly simulated provider fixtures; the task uses the real existing internal tool and temporary repository. Independent initial observations overlap, Studio planner-source linkage is enforced, each required write approval is recorded, each important effect gets an independent state read-back, dependent work waits, and one separately reviewed outcome memory has source evidence. All fixtures are deleted by test teardown.

This test caught an existing integration bug: a Studio planner action link leaked into its independent verification read. Source linkage now applies only to the execution phase. Other focused tests caught and fixed exact-step versus tool-domain ambiguity in conversation control. Failures were corrected before the final passing run.

## Limits and next acceptance

- Hardware/native plugins, selected media/project paths, Studio device configuration, Google consent and approved real event details are still prerequisites. The fixture scenario is **not** a claim that a physical studio, Premiere or Google Calendar was changed successfully.
- Physical microphone/voice barge-in and real STT/TTS latency were not re-tested. Transcribed `modality:voice` and text pass through the same tested Brain/action route; no voice permission bypass exists in the added adapter.
- UI Run drives bounded phases; conversational resume advances one phase/wave. No durable autonomous worker or automatic re-plan execution is introduced. Pause/cancel cannot undo in-flight effects. External ambiguous delivery still needs adapter-specific reconciliation.
- Group approval recording is not an all-or-nothing database transaction; partial recording leaves individual exact grants visible and requires reload/review. Execution remains individually gated.
- Revision editing currently uses reviewed structured JSON rather than a natural-language diff editor. Plan history is latest 30, plans max 12 steps, max 3 concurrent observations, max 8 re-plans, bounded event history and two safe retries. Owner-table materialization remains an existing scalability limit.
- Native verification remains bounded API/state equality. Perception capture cannot be silently used to confirm success. Verified receipt does not imply a business outcome, physical causality or financial value.

Recommended next work: complete one **controlled cross-domain live acceptance** after the existing Studio/Premiere/Calendar prerequisites, approving each concrete real effect. Keep IP-14 live acceptance pending until then. The roadmap's retained NEXT 3 remains Calls live acceptance, Desktop Bridge live acceptance, then Google Calendar live acceptance. No next milestone was started.

## Short manual test plan

1. Open Execution Plans, enter an explicit multi-tool goal, inspect proposed source references and missing information. Confirm no effect occurs while planning.
2. Run initial observations; inspect each permission/action receipt. Deny one optional branch and verify its dependants stop while independent work remains available.
3. Supply missing inputs with a visible revision/reason. Confirm completed evidence stays fixed and changed actions require fresh approval.
4. Review exact action inputs, approve only the desired step/group, run, and inspect independent read-back evidence before dependants release.
5. In the same conversation say “pause that,” “what are you waiting on,” and “resume the plan.” For a pending step, ask to approve it, inspect the echoed inputs, then explicitly confirm. Cancellation stops future work without claiming rollback.
6. Review the final summary; separately approve or decline central outcome memory. Check Action history for execution/verification/result IDs and ensure replay creates no duplicate effect.
