# Ary Actions + Permissions milestone — 2026-09-07

## Audit and preservation

Baseline: **185 tests across 17 files passed** before changes. Already present: levels 0–5, owner/workspace/tool/action/product policy scopes, capability metadata, `ToolRegistry`, `ActionRequestService`, `ActionService`, exact-request approval/rejection, ten-minute atomic grants, Settings, immutable action/outcome/policy/approval records, four mock handlers and tests. These were extended in place.

Memory, canonical entities/aliases, hybrid retrieval, temporal facts, graph data, current Canvas2D interaction/vgpu effects, provider configuration, schema tables, old APIs and tests were preserved. XYFlow remains a reference rather than a runtime dependency; no graph substitution was made. No new package or external executor was added.

## Changes and reasons

- `domain/tool-registry.ts`, `domain/permissions.ts`, `infrastructure/tools/mock-tools.ts`: richer discovery, schemas, risks/default permissions and six named simulations. Existing handlers remain available.
- `services/action-request-service.ts`: reasons, server-assigned identity, validated evidence references and derived scope, canonical request serialization, linked request revisions, and an explicit memory-proposal acceptance path using the existing memory service.
- `services/action-service.ts`: optional validation before approval, durable execution-key claims/replay, linked retry audits, and atomic successful action/outcome recording. Existing call signatures remain compatible.
- `services/permission-service.ts`: identify owner administration attempts in audit metadata.
- `domain/repository.ts`, `infrastructure/repositories/supabase.ts`: optional readiness check to fail closed if production key protection is missing. `infrastructure/repositories/local.ts`: mirror durable uniqueness in its existing atomic write lock.
- `server/http.ts`: additive tool-catalog, paged history, revision and memory-acceptance routes. History includes consumed approval grants and model-call records.
- New `components/action-center.tsx`: request composition, editable approval queue and inspectable history using existing styles. `components/dashboard.tsx` adds only the Approvals and Action history navigation/rendering hooks. The original Settings mock playground remains limited to its four supported schemas in `components/mock-actions-panel.tsx`.
- `tests/action-requests.test.ts`, `tests/database.test.ts`: extend service, HTTP, migration, evidence, concurrency, history and memory acceptance coverage. README updated to describe current behavior and boundaries.

## Migration

`202609070010_action_execution_keys.sql` adds a unique owner/execution-key index to existing action metadata and an authenticated readiness function. No tables or existing columns were replaced. The migration is rerunnable and was applied successfully to the configured Ary Nexus Supabase project through its SQL editor. PGlite tests applied it twice, checked owner-scoped uniqueness, and verified readiness.

## Verification

- **197 tests passed across 17 files**, including every existing regression suite.
- TypeScript and production build passed; formatting checked after documentation updates.
- Blocked, observe-only, recommend-only, draft-only, approval-required/rejected/approved and level-5 simulated execution remain covered.
- Invalid tool inputs fail before approval; foreign references and spoofed authority fail validation. Memory evidence contributes restrictive project scope.
- Concurrent execution is claimed once. Identical retries across repository/service instances return the persisted result; changed inputs conflict; failures require a deliberately new key.
- Edited approvals preserve the original rejection and link a fresh pending request. Canonical serialization survives JSONB key reordering.
- Complete HTTP history includes owner, actor, reason, evidence, consumed approval decision, result, outcome and model-call list.
- Explicit episodic memory acceptance obeys `memory.create` policies, preserves provenance, labels simulation content, and is idempotent. This was tested in isolated storage, not by adding synthetic content to production memory.

Live Supabase/UI walkthrough:

1. The authenticated app loaded both new navigation views and all ten discoverable tools.
2. Submitted `mock.create_note`; it entered the approval queue at level 4.
3. Modified its inputs; original was rejected and a fresh request appeared.
4. Approved and ran the edited simulation; queue cleared and the result stated `simulated: true`, `saved: false`.
5. Retried the same request; it returned the same action ID `1fd8fe78-0567-4f2b-a49b-3f424f5c914a` and result, with no second tool execution.
6. Opened Action history to inspect the resulting ledger.

Live checks wrote only mock action/outcome and approval audit records. Existing policy values, six production memories, entities and relationships were not changed. Automated tests exercised memory writes using disposable fixtures.

## Known limitations and next milestone

- All six named tools are simulations; they do not perform real task/project CRUD or send messages. The explicit memory-acceptance action is a real internal memory write through the existing service/provider.
- Tool selection is explicit; no new LLM intent planner, external integrations or agent orchestration.
- Personal-workspace owner policies only; workspace remains `ary-nexus`.
- Legacy callers without a request key retain prior retry behavior. New UI requests always have a key.
- A crash can leave a claimed request awaiting investigation; no automatic worker, lease recovery or exactly-once external-effect promise.
- History responses are paged, but current repository reads scan the owner's records before slicing; database cursor pagination is a future scaling improvement.
- Invalid envelopes/authentication/foreign-ID errors retain the existing HTTP boundary before action dispatch. Dispatched attempts, including failed tool validation and cached retries, are audited.
- Existing database-administrator privileges remain outside Ary's action gate.

Recommended next milestone: promote one mock, `create_task`, into a real internal tool with transactional domain writes, stale-input checks and rollback/recovery tests. Keep external tools disconnected until that path is proven.
