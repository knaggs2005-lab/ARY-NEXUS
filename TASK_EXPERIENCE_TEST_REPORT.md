# Task action experience — September 7, 2026

## Audit before changes

Real `create_task` already existed and worked: existing tasks schema, owned entity/project and source-message links, default level-4 approval, strict input validation, execution keys, transactional task/action/outcome commit, rollback/recovery and reviewed optional memory. The prior milestone passed 218 tests and a live Supabase creation/recall/replay test. These services were preserved in place. No duplicate implementation was created.

The missing capability was the visual lifecycle. Chat used a plain bordered card and disabled buttons; Activity showed plain task rows; Action History showed textual task IDs without a visual connection.

## Exact files changed in this milestone

All paths are relative to `/Users/austin/Documents/Clevaryn/Premiere Plugins/QACutter/ary-nexus`.

| File                                        | Change                                                                                                                                                                                                                       |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/components/task-proposal.tsx`          | Extended existing approval component with real request phases, a synchronous double-click guard, scoped dark panel and saved-task receipt. Existing review and execution API calls are preserved.                            |
| `src/components/action-center.tsx`          | Added permission-check/review/execution/result state display to task operations; displays actual execution-to-task receipts and labels replay as an existing result. Existing history and approval handlers remain in place. |
| `src/components/dashboard.tsx`              | Added only the entrance class to existing real task rows in Activity.                                                                                                                                                        |
| `src/components/task-experience.tsx`        | New reusable accessible TaskProgress and TaskReceipt components.                                                                                                                                                             |
| `src/components/task-experience.module.css` | New scoped dark surfaces, soft gradient field, breathing status light, receipt connection, entrance transition, focus states, responsive layout and reduced-motion overrides.                                                |
| `tests/task-experience.test.ts`             | Six new rendering/accessibility tests; retained all existing tests.                                                                                                                                                          |
| `README.md`                                 | Documented task experience and motion behavior.                                                                                                                                                                              |
| `TASK_EXPERIENCE_TEST_REPORT.md`            | This audit and report.                                                                                                                                                                                                       |

No changes to services, schema, migrations, repository adapters, tool registration, permissions, providers, memory/retrieval/entities, graph/vgpu, APIs, dependencies or global styles. Existing unrelated screens retain their original appearance. No new integrations.

## Behavior and accessibility

- Status follows awaited requests, never an animation timer or optimistic task insert.
- Permission checks, recording approval, execution, saved, rejected and unconfirmed states are distinct.
- Busy controls are disabled. Chat additionally uses a synchronous ref guard against duplicate clicks before React rerenders.
- `role=status`, polite live announcements, `aria-busy`, and current-step semantics describe progression. Errors use an alert. Decorative light and connection marks are hidden from assistive technology.
- Actual task/action IDs and project names remain visible. Replays say “Existing task returned.”
- Animation is local CSS; no RAF loops, polling, 3D, spinners or new rendering dependencies. Light-field and pulse motion stop when the active request ends. Receipts and task rows use a 500 ms entrance.
- Reduced-motion CSS disables all newly introduced animations/transitions and hover translation. The OS preference was not changed during live testing; runtime reduced-motion emulation was not performed.
- Screenshots were visually inspected in the existing narrow browser viewport: buttons, progress labels and task receipts were readable, with wrapping IDs and no neon effects.

## Automated verification

- **224 tests passed in 19 files**, including all 218 existing tests.
- `npm run typecheck` passed.
- `npm run build` passed (Next.js production build).
- `npm run format:check` passed.
- New tests verify checking/approval/execution announce busy without saved success; rejection/failure mark no stage completed; replay receipts use actual task/action identifiers and escape content.
- Existing transactional tests still cover real creation, rejected approval, denied permissions, invalid input, database failure, partial rollback, retry after transient failure, duplicate execution, lost commit acknowledgement, project/source evidence and grounded recall.

An initial TypeScript check found a missing `checking` member in the new UI phase type. It was corrected; the subsequent typecheck and build passed.

## Live verification and limits

Used the existing authenticated Supabase app at `http://127.0.0.1:3000/`.

1. Proposed “Ary, create a task to verify the Ary Nexus task approval experience today.” The existing entity resolver selected Ary Nexus. The new dark card displayed “Awaiting your approval,” exact inputs, a three-step indicator and approval/rejection buttons. The conversation extraction completed successfully.
2. Automatic approval review blocked approving that new task because it was an agent-written test payload beyond the previously authorized Wag Trails task. The rejection was respected. The proposal was explicitly declined through the existing UI; observed “Recording your decision” → “Request declined,” disabled controls while pending, and no created-task receipt. No task was created for this proposal.
3. Inspected the previously approved Wag Trails task in Action History. The new receipt visibly joined execution `4f42e656-684b-409a-9128-398581523dbe` to task `1452d433-5d0a-4401-80df-5eae39d8885e`, with project and title visible.
4. Used **Retry same request** on that completed execution. Observed “Checking task permissions” → “Task saved.” The API returned the original action ID and task ID. This exercised live idempotent recovery without another task insert.

Fresh creation through the updated UI was **not completed in this run** because of the automatic approval restriction. The unchanged creation transaction has the prior live success recorded in `CREATE_TASK_TEST_REPORT.md` and passes the current automated end-to-end conversation/approval/creation test. Visual execution/success rendering is covered by component tests; live checking/rejection/replay and receipt rendering were observed.

The earlier independent extraction conflict remains outside this visual milestone; no memory changes were made to address it.

## Manual follow-up

For a user-approved real task: start a Chat request with a known project, review the exact proposal, approve, watch the progress light and saved receipt, verify Activity, then compare the task ID in Action History. Enable reduced motion in the OS and repeat to verify the static presentation. Existing Task History replay can safely verify returned results without creating another task.
