# Ary Nexus permissions verification — 2026-09-06

Current milestone: see [Actions + Permissions — 2026-09-07](ACTIONS_MILESTONE_TEST_REPORT.md) for the additive approval queue, richer registry, durable retries, applied migration, and latest test results. The reports below are historical.

## Actions + Permissions extension — audit and verification

This section records the additive action-request extension. The original permissions implementation report is retained below.

**Already present:** permission levels 0–5; capability metadata; `PermissionService` with intersecting tool/action/workspace/product/user scopes and append-only policies; `ActionService.run()`; approval/rejection APIs and dialog; exact-request retry; ten-minute, atomic single-use approvals; Settings policy/approval/audit UI; `actions`, `outcomes`, `permission_policies`, and `action_approvals`; SQL RLS/audit protections; existing permission and database tests. Baseline: **167 tests across 16 files passed** before edits.

**Added:** `src/domain/tool-registry.ts` supplies typed executable handlers with input validation; `src/infrastructure/tools/mock-tools.ts` supplies four deterministic simulations; `src/services/action-request-service.ts` dispatches only server-registered handlers through the existing gate; `src/components/mock-actions-panel.tsx` provides an in-place Settings playground; `tests/action-requests.test.ts` verifies service and HTTP behavior. These fill the missing executable registry/request/mock layer without recreating policy or approval services.

**Extended, with reasons:**

- `src/domain/permissions.ts`: add mock metadata with distinct action types and defaults 1/2/3/4; own-property lookup prevents prototype names being treated as registered capabilities. Existing names/defaults remain unchanged.
- `src/services/permission-service.ts`: use the safe lookup for policy validation and resolution.
- `src/services/action-service.ts`: use the safe lookup and add an optional sixth audit serializer argument to store bounded mock results. Existing signatures remain source-compatible and old callers keep their output behavior.
- `src/server/http.ts`: add authenticated `POST /api/actions/request` using existing origin checks, error handling, and approval responses.
- `src/components/permissions-panel.tsx`: embed the mock playground and show saved results in existing audit details.
- `src/components/approval-dialog.tsx`: associate async review completion and abort events with their originating prompt, preventing a stale operation from completing a newer prompt; add an accessible dialog name.
- `tests/permissions.test.ts` and `tests/http.test.ts`: extend unknown-tool/prototype denial, policy validation, authentication, and origin checks. Existing tests remain.
- `README.md`: document reuse, endpoint, registry, mock defaults, approval/retry semantics, audit boundaries, and manual checks.

| Current check                        | Result                                                                                                                                                                                                                                         |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Full regression suite                | **185 tests passed across 17 files**, including existing PGlite migration/RLS, memory, entity, hybrid retrieval, temporal knowledge, graph, vgpu, provider, and desktop tests                                                                  |
| Focused action/permission/HTTP suite | **39 passed**                                                                                                                                                                                                                                  |
| Mock mode boundaries                 | All six permission levels checked against observe/recommend/draft/execute                                                                                                                                                                      |
| Default execution approval           | Required; success binds the resulting action to its consumed approval                                                                                                                                                                          |
| Concurrent retry                     | Exactly one of two simultaneous retries consumes the grant and succeeds                                                                                                                                                                        |
| Rejection and changed input/scope    | No execution; unchanged approval remains unused for mismatched requests                                                                                                                                                                        |
| Scope restrictions                   | Product, workspace, action type, tool and user intersection enforced                                                                                                                                                                           |
| Handler failure                      | Logged with failure outcome; grant consumed; retry needs new approval                                                                                                                                                                          |
| Handler/input isolation              | Internal memory operations cannot be dispatched; unknown/prototype/integration names denied; invalid inputs never reach handlers                                                                                                               |
| HTTP flow                            | Real handler + temporary repository: request → 409 → review → identical retry → 201 → repeated request → new 409                                                                                                                               |
| Knowledge/provider isolation         | Mock runs leave memory, entities, relationships, tasks, model calls and financial attribution tables empty in isolated tests                                                                                                                   |
| TypeScript                           | Passed                                                                                                                                                                                                                                         |
| Production build                     | Passed                                                                                                                                                                                                                                         |
| Live UI verification                 | **Not completed in this extension: the Mac was locked and computer-use could not unlock it.** The prior live UI results below predate this extension. The stale-dialog race fix was reviewed but has no dedicated browser regression test yet. |

No schema/migration, package, environment, provider, database adapter, desktop, memory, entity, retrieval, reflection, graph, voice, or ROI implementation was changed. Graph audit note: the current renderer uses Canvas2D interaction with a separate vgpu effects layer; XYFlow is reference material, not an installed runtime dependency. Both current layers remain untouched.

Typecheck initially encountered four pre-existing byte-identical duplicate generated `.next/types/* 2.ts` files. Only those generated duplicates were moved to `/tmp/ary-actions-duplicate-next-types`; their originals and all source files were preserved. Typecheck and build then passed.

Manual test in **Settings → Permissions**:

1. Run `mock.observe`; inspect its synthetic result and successful audit row.
2. Run `mock.execute`; verify the exact request is shown. Reject; confirm no execution.
3. Retry and approve once; verify success and the recorded result. Repeat; verify a new approval is required.
4. Select **Intentional failure**, approve, and verify the failure record and fresh approval requirement on retry.
5. Add a level-0 policy scoped only to `mock.execute`; verify denial and its reason. Disable the test policy afterward to restore the default, retaining history.

Limitations retained: personal owner-scoped permissions, no team-role administration; no external executors, automatic execution queue, or general request idempotency at level 5. Envelope/authentication/foreign-ID errors remain HTTP errors before dispatch; valid dispatched attempts are audited. Administrative database access remains outside Ary's permission gate.

Formatting verification also passed with `npm run format:check` after the final changes.

## Original permissions implementation report

Implemented and applied migration `202609060007_permissions.sql` to the configured Supabase project. Legacy actions were preserved with numeric levels and their former labels retained in metadata.

| Check                                    | Result                                                                                                                        |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| All six levels                           | Passed: observe, recommendation, draft and execution mode boundaries                                                          |
| Unknown tools                            | Passed: broad autonomous policy cannot enable an unregistered, financial or email tool                                        |
| Scope matching                           | Passed: tool, action type, workspace, product and user intersections; lowest matching level wins                              |
| Policy history                           | Passed: append-only revisions; stale/concurrent successors rejected                                                           |
| Tenant boundary                          | Passed in service and SQL tests: other users' policies, product IDs and approvals cannot be used                              |
| Approval binding                         | Passed: changed input or matching policy revision invalidates approval                                                        |
| Single use                               | Passed: simultaneous retries execute at most once; SQL consumption also rejects reuse                                         |
| Rejection and expiry                     | Passed: no execution with rejection, expired grant or mismatched fingerprint                                                  |
| Audit integrity                          | Passed: failures retain request/level/timestamp; terminal records and policy history cannot be rewritten through the app role |
| Owner recovery                           | Passed: policy management remains available under a no-access policy and writes an audit attempt                              |
| Regression suite                         | 127 tests passed, including existing memory, graph, reflection and voice tests                                                |
| TypeScript, formatting, production build | Passed                                                                                                                        |

Live browser verification used a temporary level-4 policy for `memory.reembed` in Ary Nexus. **Check embedding status** submitted `{ "dry_run": true }`, displayed the exact-request approval dialog, and executed after approval. A repeated request required a new approval. Rejecting it displayed “Action rejected. Nothing was executed.” The temporary rule was then disabled; its two policy revisions and approval/rejection records remain visible in Settings. Six existing memories stayed current and zero embeddings were changed.

Boundaries: this release manages the authenticated owner's personal workspace. Operation policies are not a replacement for database RLS or per-record confidentiality rules. Future shared-product integrations must supply trusted, complete product scope through their adapter. No financial/email executor or external integration was added. The earlier OpenAI speech-model access question remains separate; this task did not alter that model allowlist.
