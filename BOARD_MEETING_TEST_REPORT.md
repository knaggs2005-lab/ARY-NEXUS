# Ary Daily Board Meeting v1 — 2026-09-07

## Audit before implementation

Existing systems were inspected before edits: central memory/evidence/versioning and hybrid retrieval, canonical entities and relationships, goals/tasks/project metadata, Priority Intelligence, reflection, action requests and permissions/approvals, atomic repository mutations and execution keys, provider telemetry, streaming chat, graph/vgpu, the existing dashboard, and spatial navigation. Their existing implementations and reports were retained. The graph is currently the existing custom Canvas2D interaction with vgpu; it was not replaced with another library.

No board service, structured board report, or working Board destination existed. The spatial Agents destination was a reserved placeholder. PriorityService, MemoryService, LanguageModelProvider, ActionService, conversations/messages and outcomes already supplied the needed boundaries.

## Files added

- `src/domain/board.ts`: bounded request/output validation and shared report/event contracts.
- `src/services/board-meeting-service.ts`: shared evidence snapshot, six advisory role calls, validation, Analyst ordering, CEO plan, audit/idempotency, atomic shared persistence and history.
- `src/components/board/board-view.tsx`: streamed stages, role results, evidence-linked brief, cancellation, history and graph navigation.
- `src/components/board/board.module.css`: isolated dark board surface, restrained motion, responsive layout and reduced-motion support.
- `tests/board.test.ts`: 19 service, boundary and recovery tests.
- `tests/board-http.test.ts`: 6 API/authentication/validation/streaming tests.
- `scripts/evaluate-board.ts`: isolated browser fixture verification; intercepts API requests rather than modifying production data.
- `BOARD_MEETING_TEST_REPORT.md`: this report.

## Files extended

- `src/domain/permissions.ts`: register `board.meet` as a low-risk recommend capability, level 2 by default.
- `src/server/context.ts`: wire the board to the existing repository, memory, model and ActionService instances.
- `src/server/http.ts`: authenticated history and NDJSON meeting endpoints.
- `src/components/dashboard.tsx`: lazy Board screen and existing graph-focus callback.
- `src/components/spatial/modules.ts`: connect the reserved Agents destination to Board.
- `package.json`: add `test:board`; no dependency changes.
- `README.md`: architecture, API, operation, limits and verification instructions.

No schema/migration changes. No changes to memory/retrieval/priority implementations, task/project models, actions/approvals/retry internals, graph rendering, provider implementations/credentials, voice, or external integrations.

## Verification

- Final regression: **441 tests passed across 33 files** (25 new board tests); typecheck, formatting and production build passed. **12 isolated browser checks passed**.
- Live navigation verified: the Wag Trails brief link opened the existing canonical graph context with GPU effects active; leaving Board and reopening the saved meeting retained its report.

- Service tests cover all six roles using the same bounded snapshot, central goal inclusion even when tasks fill the leading slots, no work/fact writes, one conversation, complete action/outcome linkage, permission denial for all six gates, idempotent replay/input conflicts, forged evidence, invalid Analyst ranking, invalid CEO plan, provider failure, cancellation including the save boundary, database failure/new-key recovery, explicit stub rejection, empty evidence and user isolation.
- HTTP tests cover streaming stages/final confirmation, streamed failure, request validation, authentication, history and cross-origin rejection.
- Isolated browser checks cover six waiting/running/completed cards, real streamed stages, final plan/entity links, history, reduced motion, mobile width, cancellation, denial, no outside writes, no reload and no browser errors.
- Live authenticated Supabase/OpenAI meeting: all six roles successfully used `gpt-5.6-sol`, producing eight accepted findings and a consolidated two-item plan in **24.9 seconds**. Specialist/Analyst/CEO latencies shown: 4.7, 4.9, 3.9, 5.2, 6.3 and 5.1 seconds (specialists overlap).
- Live brief prioritized defining/validating the Wag Trails tracking fix, then concrete Ary Nexus retrieval validation. Links point to existing entities. Pipeline/revenue evidence was explicitly unknown.
- First live run correctly saved a partial report because CEO output failed validation. The CEO contract was clarified and validation diagnostics improved; the next run succeeded. Both reports are intentionally retained as truthful history.
- Visual inspection caught and fixed low contrast against the existing light workspace. The dark board surface is scoped to the new screen.

## Manual check

1. Open Board (or spatial Agents), optionally set a focus, and start a meeting.
2. Watch specialist findings arrive, Analyst rank them, and CEO consolidate the brief. All six role cards should show their actual state and provider.
3. Expand findings and shared evidence. Follow a project link into the existing Brain Graph.
4. Return to Board and reopen a saved meeting. Confirm the same brief and evidence are retained.
5. Inspect Action history for `board.meet` and the saved report; tasks and confirmed memory must be unchanged.
6. Stop a running meeting, then check history before retrying. Set `board.meet` to no_access in Settings to verify denial; restore the desired policy afterward.

## Limits / next step

Manually triggered advisory meetings only. No scheduler, autonomous execution, external research, independent agent stores, or automatic memory extraction from generated findings. Snapshots are bounded and can omit relevant lower-ranked work; providers can fail validation or time out, resulting in partial reports. Evidence reference validation proves provenance IDs exist, not that every model interpretation is correct. Estimated costs depend on existing provider pricing configuration. Database reads still use existing repository list methods; provider input is bounded separately.

A useful next milestone is letting the user select a proposal and submit it through the existing reviewed internal action pipeline, while retaining its board evidence. Do not automatically execute the daily plan.
