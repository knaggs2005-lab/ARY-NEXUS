# Real internal create_task — audit and verification

Verified September 7, 2026, against the existing Ary Nexus repository and authenticated local Supabase app.

## What already existed

- The owner-scoped `tasks` table, Task domain model, timestamps, project/goal foreign keys and Activity → Tasks display.
- Permission levels 0–5, user/workspace/product/tool/action scopes, exact-request approvals, approval UI, immutable audit history and outcomes.
- ToolRegistry, ActionRequestService, ActionService, safe mock tools, canonical JSON fingerprints and durable execution keys (migration 010).
- Atomic LocalRepository batches and Supabase `apply_memory_batch`, including tasks/actions/outcomes and optimistic ownership/version checks.
- Canonical entities/aliases, Chat streaming and durable extraction jobs, provider abstractions and reviewed episodic action-memory support.
- `create_task` had registry capability metadata but no real dispatcher. `mock.create_task` produced a preview and never saved tasks. There was no partially real task handler to preserve.

Baseline: **197 tests passed**. No replacement task system, repository, permission service or schema was introduced.

## Exact files added or modified

Paths below are relative to `/Users/austin/Documents/Clevaryn/Premiere Plugins/QACutter/ary-nexus`.

| File                                        | Change and reason                                                                                                                                                                                                                          |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/domain/task-actions.ts`                | Added strict real-task input schema using existing status and priority storage.                                                                                                                                                            |
| `src/infrastructure/tools/create-task.ts`   | Added handler that stages task insertion and owned evidence/version checks; no independent writes.                                                                                                                                         |
| `src/services/task-conversation-service.ts` | Added narrow create-task intent adapter and confirmation from actual task/action records.                                                                                                                                                  |
| `src/components/task-proposal.tsx`          | Added small inline review/approve/reject/result card and safe same-key recovery.                                                                                                                                                           |
| `tests/create-task.test.ts`                 | Added 20 focused service/conversation/rollback/recovery tests.                                                                                                                                                                             |
| `src/domain/tool-registry.ts`               | Extended execution context with optional staging, source, evidence and action ID fields.                                                                                                                                                   |
| `src/domain/permissions.ts`                 | Registered real creation as an executable medium-risk internal capability, default level 4.                                                                                                                                                |
| `src/domain/validation.ts`                  | Added optional validated Chat IANA time zone for tomorrow/today.                                                                                                                                                                           |
| `src/services/action-service.ts`            | Added optional staged mutations to the existing success transaction, before action completion and outcome.                                                                                                                                 |
| `src/services/action-request-service.ts`    | Registered real handler; required its execution key; validated source; aligned connected-product scope across Chat/HTTP; distinguished reviewed real memory from simulated memory. Optional source field preserves envelopes that omit it. |
| `src/services/ary-brain-service.ts`         | Added the task adapter inside the existing brain permission gate; kept normal reasoning/retrieval and extraction flow. Internal replies have truthful provider/intent metadata.                                                            |
| `src/components/dashboard.tsx`              | Sends browser time zone, renders task proposals, refreshes existing task data, displays task ID/project/priority/due date.                                                                                                                 |
| `src/components/action-center.tsx`          | Distinguishes real tools from mocks, preserves conversation/message when modifying a proposal, refreshes task data, highlights task result or replay in history.                                                                           |
| `tests/database.test.ts`                    | Added real PostgreSQL/RLS test of task + action + outcome commit and late-error rollback. All earlier tests retained.                                                                                                                      |
| `README.md`                                 | Added real tool usage, API example, schema mapping, transaction/retry semantics and limitations.                                                                                                                                           |
| `CREATE_TASK_TEST_REPORT.md`                | This audit, evidence and manual test plan.                                                                                                                                                                                                 |

Four byte-identical duplicate generated declaration files (`* 2.ts`) in ignored `.next/types` caused an initial TypeScript conflict. They were moved to `/tmp/ary-duplicate-next-types`; no source declarations were removed. Type checking and the production build then passed.

## Migrations and transaction boundary

**No new migrations; no schema edits.** Existing migration 010 is already active in the development Supabase project. The existing table and transaction RPC support this milestone.

The action attempt and approval consumption happen before execution using existing safeguards. The handler stages a task; the task insert, successful action result, and success outcome commit in one batch. Failure rolls back that batch and the existing catch path records failure. A successful execution key returns the saved task on replay. Recorded failures require a new key and fresh approval. Uncertain in-flight attempts remain blocked for investigation rather than risking duplicate execution.

Task metadata holds workspace, requesting user/agent, action ID, source conversation/message, related entity/memory IDs and reason. The tenant and creation/update timestamps use existing columns. No automatic action memory is written; optional reviewed memory remains a separate, explicit operation.

## Automated results

**218 tests passed across 18 files**, including all 197 baseline tests. `npm run typecheck`, `npm run build`, and `npm run format:check` passed.

New coverage:

- Real creation with task ID, owner, timestamps, project, source and linked memory evidence.
- Rejected approval; permission levels 0, 1, 2 and 3 cannot write.
- Invalid title, priority, date, status; missing execution key; mismatched source conversation; foreign project rejection.
- Same-key and concurrent execution produce one task.
- Late failure rolls back staged task/action/outcome writes and records failure.
- Transient database failure: no partial task; same key blocked; new approved key succeeds.
- Lost commit acknowledgement: same key recovers the already committed task.
- Level 5 internal execution uses the existing policy gate without an approval.
- Full Brain conversation → entity resolution → proposal → approval → real task → record-based confirmation. A changed task title is read from the saved row, proving confirmation does not echo the original proposal.
- Chat-origin and HTTP-origin requests use the same connected-project approval scope.
- Action memory is written only after explicit review and review replay does not duplicate it.
- PGlite executes the actual migrations/RPC under authenticated RLS: a foreign-key failure after task/action/outcome writes rolls back all three; success commits all three; another user cannot read the task.

Database failure injection used isolated test stores and PostgreSQL fixtures, not the user's live database.

## Live end-to-end result

Executed in the authenticated browser at `http://127.0.0.1:3000/`, using Supabase storage:

1. Sent the requested sentence: “Ary, create a high priority task to finish the Wag Trails Live tracking bug fix tomorrow.”
2. Existing canonical resolution selected **Wag Trails**, ID `332646ef-4c64-4816-8673-e814c425df27`.
3. Proposal showed high priority, pending status, due **2026-09-08**, interpreted from the America/Denver calendar date, and no task created before approval.
4. Approved once in Chat. The real tool committed successfully at **2026-09-07 08:04:55 UTC**.
5. Activity → Tasks displayed one new Wag Trails task, alongside the original Ary Nexus seed task.
6. Asked “What task did you just create?” Ary returned the saved task title, priority, pending status, due date, project and exact task ID with the `internal · Internal task records` indicator.
7. Action History showed requester, reason, source, project, consumed approval, successful execution result and outcome.
8. Clicked **Retry same request** in Action History. It returned the original task, logged an idempotent replay, and Activity still showed only one new Wag Trails task.

Evidence IDs:

| Record           | ID                                     |
| ---------------- | -------------------------------------- |
| Created task     | `1452d433-5d0a-4401-80df-5eae39d8885e` |
| Execution action | `4f42e656-684b-409a-9128-398581523dbe` |
| Approval         | `2a8c78b3-9382-43ee-a127-ac3000a9fb81` |
| Success outcome  | `ad55ae04-6b93-4a36-b04e-7f62715f0b3f` |
| Conversation     | `974b7de1-5362-4f50-a807-c4b7ec03777e` |
| Source message   | `74df317d-961c-422d-bad7-a69a9a516f3e` |
| Replay action    | `f4984822-609d-4835-92be-525abbdbf5ea` |

An initial live attempt exposed Chat/HTTP connected-project scope mismatch. The gate correctly refused to reuse a narrower approval; the extra request was rejected without creating a task. Scope calculation was corrected in the real action request path and covered by a regression test before the successful run above. These earlier proposals remain in the audit history; they were not erased.

## Known limitations and intentionally untouched systems

- A separate extraction job for the repeated live request failed with **“This record already exists”**, including one retry through Memory review. The initial conversation did save a source-backed memory describing the requested task; the follow-up extraction completed with no new memories. The failed job remains visible for investigation. No memory/reconciliation/schema changes were made to hide or bypass it. It did not affect task creation or record-based recall.
- Chat task commands intentionally use a narrow grammar and one unambiguous project. General natural-language tool planning, multi-turn clarification state, scheduled reminders and relative dates beyond today/tomorrow are not implemented.
- Due dates are date-only values stored in the existing `due_at` column at end of UTC date; no local-time scheduling is implied.
- Failed/rejected proposal buttons can be revisited after a reload; the authoritative approval queue/history and server checks prevent invalid execution. A recorded failed key needs a fresh request/approval. Successful cards read current task data after refresh.
- Full database unavailability can prevent recording the final failure; the earlier action claim remains for investigation. No automatic takeover of uncertain execution is added.
- This follows existing repository list/pagination patterns. It does not add a high-volume task search/index redesign.
- Memory, retrieval, canonical/alias implementation, temporal facts, graph interaction/vgpu, providers, database migrations, existing APIs and other screens were preserved. No provider config, keys, dependencies, external tools, voice, financial actions or multi-agent work were added. Existing tests and mocks remain.

## Short manual test plan

1. In Chat, start a new conversation and request a task with one known project. Inspect title, priority, date, source and project in the proposal.
2. Reject once and confirm Activity contains no task from that request.
3. Submit a fresh request, approve it, and verify its actual task ID in Activity and its approval/outcome in Action History.
4. Ask “What task did you just create?” in that same conversation; compare the returned ID with Activity.
5. Use Action History → Retry same request; verify the ID is unchanged and no duplicate task appears.
6. For controlled testing, set create_task to no_access and verify a new attempt is blocked; restore the intended policy afterward. Keep failure injection in the automated fixtures.

Recommended next real tool: **update_task**, with the same approval/transaction/execution-key path and an expected task version to prevent overwriting concurrent changes. Investigate the extraction-job conflict as a separate focused maintenance task before expanding memory behavior.
