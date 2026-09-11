# Real update_task — audit and verification

September 7, 2026.

## Audit and scope

The repository already contained the real create_task transaction, existing task schema/model, ToolRegistry, ActionRequestService, ActionService, permission levels/scopes, exact-request approvals, immutable audit logs, outcomes, durable execution keys, atomic batches and task visual components. `mock.update_task` existed as a simulation. There was no partially real update handler to extend.

This milestone adds a real update handler to that same registry and pipeline. It does not replace the task system or create new persistence infrastructure. No migration, new endpoint, new dependency, model change or external integration was needed.

## Exact files changed

Paths relative to `/Users/austin/Documents/Clevaryn/Premiere Plugins/QACutter/ary-nexus`:

| File                                        | Change                                                                                                                                                                                  |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/domain/task-actions.ts`                | Added strict update/snapshot/patch schemas and shared snapshot/change helpers alongside existing create input.                                                                          |
| `src/domain/permissions.ts`                 | Added real update_task capability, default level 4, preserving mocks.                                                                                                                   |
| `src/infrastructure/tools/update-task.ts`   | New transactional handler: verifies actual before/version, stages guarded changes, preserves creation evidence and returns before/after audit data.                                     |
| `src/services/action-request-service.ts`    | Adds update handler registration, update-key requirement, old/new link permission scope, and accurate optional reviewed-memory wording. Existing interfaces and creation flow retained. |
| `src/components/task-update-card.tsx`       | New Activity task editor/card around existing task records, with review, refresh and changed-field feedback.                                                                            |
| `src/components/task-change-review.tsx`     | New reusable field-by-field before/after comparison.                                                                                                                                    |
| `src/components/dashboard.tsx`              | Renders existing tasks through the task editor/card; goals and decisions retain their existing display.                                                                                 |
| `src/components/action-center.tsx`          | Existing approval/history workflow now recognizes update_task, refreshes task data, shows change comparisons and update receipts.                                                       |
| `src/components/approval-dialog.tsx`        | Adds a readable change comparison for update_task before the existing exact-input approval controls. Other approval types are unchanged.                                                |
| `src/components/task-experience.tsx`        | Optional update wording in progress and receipts; existing create callers stay compatible.                                                                                              |
| `src/components/task-experience.module.css` | Scoped editor, comparison, completion-state transition and brief field highlights, including reduced-motion overrides.                                                                  |
| `tests/update-task.test.ts`                 | 55 new update behavior/transition/failure tests using isolated stores.                                                                                                                  |
| `tests/database.test.ts`                    | Adds real PostgreSQL transaction rollback and stale-version test using existing migrations/RLS/RPC.                                                                                     |
| `tests/task-change-review.test.ts`          | Adds before/after rendering test, including due-date removal and omission of unchanged fields.                                                                                          |
| `tests/task-experience.test.ts`             | Adds update-specific progress wording test.                                                                                                                                             |
| `README.md`                                 | Documents API, update semantics, versions, permissions, retries and UI.                                                                                                                 |
| `UPDATE_TASK_TEST_REPORT.md`                | This report.                                                                                                                                                                            |

## Transaction and history

Updates reuse `tasks.id`. `expected_updated_at` plus the complete editable `before` snapshot bind review to actual state. The handler verifies both before staging, and the transaction checks the timestamp again while writing. The task update, successful action result and outcome commit together. Later failure rolls them all back; the existing attempt is marked failed through the existing failure path.

Action results store before, after and changed field names. Creation metadata is preserved, including its original action/source; latest update provenance gets separate metadata fields. No autonomous memory edits are introduced. Optional reviewed memory uses the existing separate review flow.

Both previous and proposed project/entity links contribute permission scopes. The approved envelope is stable for replay; a successful replay never reapplies its old patch. Approval grants remain single-use and version-bound. Recorded failures require refresh/new-key/new-approval; uncertain pending executions remain blocked under existing recovery rules.

## Verification

**282 tests passed in 21 files** (all 224 baseline tests retained). Typecheck, production build and formatting checks passed.

New behavior coverage:

- All 16 status transitions, including reopening completed/cancelled tasks.
- All 16 priority transitions.
- Every supported field, project move, explicit entity links, and clearing nullable/empty values.
- Creation ID/provenance preservation; source conversation/message evidence on an update.
- Permissions 0–3 denied, default approval, rejected approval and explicit autonomous internal permission.
- Old and destination project policies, foreign task/entity rejection.
- Invalid input, missing key, no-op, forged before snapshot, stale review.
- Concurrent independently approved updates: only one can change the reviewed version.
- Late transaction failure rolls task changes back and records failure.
- Transient failure: same key blocked; fresh reviewed key succeeds.
- Lost commit acknowledgement: retry returns the committed result.
- Successful replay after later task changes does not overwrite those changes.
- PostgreSQL under authenticated RLS: a late foreign-key failure rolls back task/action/outcome; a successful batch commits; stale expected version is rejected.
- Accessible before/after rendering and update-specific progress wording.

The live authenticated UI was checked using the existing Wag Trails task. Edit task exposed all requested fields. Draft changes from pending to completed and High to Urgent displayed explicit before/after values before the Request task update button. The layout was visually inspected. The draft was cancelled, so the real tracking task remains unchanged. Database write, approval, rollback and transition tests ran in isolated stores/PGlite; no production task was modified for testing. The operating-system reduced-motion setting was not changed during verification; stylesheet overrides disable new motion.

## Known limits and untouched systems

- Activity and the existing request API support updates. A natural-language update command parser is intentionally not added.
- Dates use the existing date-only convention, not reminders/scheduling.
- Action audit snapshots are the update history; no separate task-version table or migration.
- Field highlights follow successful edits in Activity. Updates executed from Approvals refresh task data and show the change comparison/result there; Activity receives current records when opened.
- Existing repository list/query patterns and full-database-outage recovery limitations remain. A complete outage can prevent final failure logging, leaving the earlier attempt for investigation.
- The prior independent memory-extraction conflict is untouched. Memory, retrieval, entities/aliases, temporal facts, graph/vgpu, providers, schemas, existing routes, create_task, mock tools and unrelated screens/tests remain in place.

## Manual use

Open Activity → Edit task → change the desired fields → Review changes → Request task update. Inspect and approve the exact request if required. Confirm the updated values and highlights without reloading, then inspect before/after evidence in Action History. For a stale review, refresh the task and create a new proposal; do not reuse an old failed key.
