# Real update_project_status — September 7, 2026

## Audit: existing systems reused

Projects were already canonical `entities` rows with `entity_type = project`.
The graph already read status from metadata, blockers from temporal incoming
`blocks` edges, and goals through `goals.entity_id` or linked tasks. The Entities
screen already displayed projects. No dedicated project table/view was needed.

ToolRegistry, the request API, scoped permissions, exact approvals, ActionService,
staged repository transactions, action/outcome logs, execution keys, retry/replay,
and optional reviewed action memories were already implemented. Only the project
status mock existed; it still simulates without changing records.

## Added files

- `src/domain/project-actions.ts`: strict review/patch contract, canonical link
  snapshot, transparent field diff, read-only task rollups.
- `src/infrastructure/tools/update-project-status.ts`: real transactional handler;
  owner/type validation, stale review rejection, goal/blocker link changes,
  source checks, preserved metadata, and recorded before/after results.
- `src/components/project-state.tsx`: project controls inside the existing Entity
  cards, actual task counts, notes, goals/blockers, review, and Graph navigation.
- `src/components/project-change-review.tsx`: shared readable approval diff.
- `src/components/project-state.module.css`: scoped state tint, request light pulse,
  save highlights, link reveal, and reduced-motion behavior.
- `tests/update-project.test.ts`: 58 action/permission/transaction cases.
- `tests/project-http.test.ts`: complete isolated HTTP approval and execution flow.
- `tests/project-ui.test.ts`: diff clarity and honest empty/unconfirmed state.
- `UPDATE_PROJECT_TEST_REPORT.md`: this report.

## Modified files and reasons

- `src/domain/permissions.ts`: register the real action with default level 4.
- `src/services/action-request-service.ts`: compose the handler, validate project
  references/scopes, require execution keys, record real rather than simulated
  results, and accurately describe reviewed project memories. Existing interfaces
  and mock registrations remain available.
- `src/components/dashboard.tsx`: embed ProjectState only for project entities;
  pass a selected entity into the existing Graph view.
- `src/components/approval-dialog.tsx`: render the project diff before approval.
- `src/components/action-center.tsx`: project diff/result evidence, accurate tool
  description, and dashboard refresh after project execution/replay.
- `src/components/brain/brain-experience.tsx`: optional `initialEntityId` prop uses
  the existing neighborhood/fly-to/selection behavior. No renderer or effect changes.
- `tests/database.test.ts`: test the existing PostgreSQL batch RPC against project,
  relationship, goal, action, and outcome mutations, late failure, stale versions,
  tenant isolation, and relationship history.
- `README.md`: schema mapping, workflow, input fields, history, and limitations.

## Verification

- Full suite: **344 tests passed across 24 files**, including existing tests.
- Typecheck: passed. An initial test fixture cast failed typecheck; it was corrected.
- Production build: passed after that correction.
- PostgreSQL/PGlite: actual migrations through 010 and actual batch RPC; verified
  late FK failure leaves no partial project/goal/edge/success outcome, then successful
  commit, stale-version rejection, and reopening the same temporal relationship ID.
- Isolated HTTP end-to-end: Wag Trails under Clevaryn → project update proposal →
  exact approval → real repository write → graph blocker visible → complete action
  evidence → successful-key replay without duplicate edges.
- Live authenticated browser: Entities loads project state and actual task rollups;
  Wag Trails preview shows “not set → blocked” and “not set → at risk”; cancel leaves
  saved state unchanged. Explore project connections opens the Wag Trails context,
  existing connected path, and active GPU layer without an error overlay.
- Live production business records were not edited to invent project status for a
  test. Successful execution and rollback were verified in isolated fixtures.

Coverage includes all 36 supported status-to-status pairs, permission levels 0–3,
rejection, level-5 internal execution, field clearing, invalid inputs, missing keys,
no-ops, cross-user references, wrong target type, self blockers, protected goals,
stale/forged review, late rollback, transient retry with fresh approval, lost commit
acknowledgement, concurrent project edits, concurrent goal edit, and history.

## Migrations

None. The existing unique relationship key and relationship history trigger are
preserved; reopening a blocker uses an update rather than inserting a duplicate.
Project state version evidence is recorded by the existing action before/after log.

## Intentional limits and untouched systems

- Project updates currently originate in Entities or the existing action API/queue.
  No new natural-language project-intent parser or autonomous scheduler was added.
- Health/status are explicit user-reviewed values. Task completion never silently
  marks a project complete. Rollups are observations, not financial or predictive data.
- Blockers reference existing entities; this action does not create blocker entities.
  Scheduled blockers require separate timing review. Direct goals cannot be stolen
  from other entities; indirect goal links remain derived from tasks.
- Relationship/goal changes from other subsystems are protected by the versions of
  the rows this action touches. Concurrent newly added links are not deleted by this
  action; the refreshed view is authoritative for the latest combined state.
- Request caps are 50 blocker IDs and 50 direct goal IDs; larger snapshots fail closed.
- Memory, retrieval, entity resolution/aliases, temporal-memory logic, task tools,
  schemas, existing API contracts, provider settings, permissions semantics,
  approvals, audit/retry internals, Graph model/renderer/vgpu, and unrelated UI were
  not rebuilt or refactored. No external integrations were introduced.

## Short manual test

1. Open Entities, then Edit project on a project you intend to change.
2. Change status/priority/health/notes; optionally select an existing blocker or
   unassigned goal. Review the explicit before/after preview.
3. Request the update. Reject once and verify the saved card does not change.
4. Open a fresh edit, request and approve. Verify updated fields, task counts,
   related links, and the project ID/result in Action history.
5. Open project connections; verify the existing Graph highlights the neighborhood.
6. Reopen the same approved request from history: its saved result is replayed;
   it must not create duplicate links. For an actual failed attempt, refresh and
   submit a new proposal with fresh approval.
