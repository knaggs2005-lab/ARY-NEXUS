# Nexus Permission Engine

Extends the existing permission and action system. No parallel executor, approval store or agent identity system was introduced.

## Audit and preserved systems

Before implementation, the repository already had `PermissionService`, numerical levels 0–5, owner/workspace/product/tool/action-type policy scopes, append-only policy revisions, single-use approvals bound to exact inputs and a policy hash, `ActionService`, transactional internal task writes, audit/outcomes, execution keys, server-owned agent ceilings, a Settings permission editor, a global confirmation dialog, Action Center, and durable mission pause/resume controls.

These remain authoritative. Memory, retrieval, entities, temporal facts, graph/vgpu, providers and their selection, task/project models, existing APIs, and prior tests were preserved. Brain/voice/MCP received only cancellation-signal wiring. No external tool was connected or executed.

## Permission contract

Classes: `READ`, `WRITE`, `EXECUTE`, `COMMUNICATE`, `DELETE`, `PURCHASE`, `ADMIN`, `PHYSICAL_CONTROL`, `FINANCIAL`, `EXTERNAL_PUBLISH`.

Tool classes are server-owned. Existing tools derive conservative classes from their registered mode and domain; a definition may declare explicit classes. Opaque `mcp.invoke` intersects **all classes**, so a class denial cannot be bypassed through a generic remote capability. Class availability does not register purchase, trading or publishing executors.

Policies optionally add:

| Field              | Meaning                                                                                 |
| ------------------ | --------------------------------------------------------------------------------------- |
| `permission_class` | Match a declared capability class; null matches all                                     |
| `subject_agent_id` | Existing owned agent message ID, matched against authenticated server execution context |
| `behavior`         | `always_allow`, `ask_every_time`, `deny`; null retains numerical semantics              |

- **Always allow** records level 5 within the selected scope. Other matching restrictions, agent ceilings and mandatory capability approvals still apply.
- **Ask every time** requires an exact, expiring, one-use approval for reads, recommendations, drafts or execution when the requester has sufficient authority.
- **Allow this time** uses the existing `action_approvals` record. No persistent grant is created. It expires after ten minutes and is consumed atomically.
- **Deny** records level 0. The most restrictive matching level wins.
- Scope dimensions combine: user, workspace, product/project/company, tool, action type, class and agent.
- Agent names supplied in request data do not establish identity. An agent cannot administer the owner's policies.
- Historical numeric policies keep their original scope hashes and revision chains. Changing a policy invalidates approvals issued under its previous hash.

Sending email, initiating calls, physical controls and other capabilities with an existing mandatory approval ceiling retain that ceiling, including under always allow. No provider annotations or model output can grant permission.

## Approval experience and Activity

The global approval dialog, Action Center and Settings attempt inspector share an explanation component: requested action, reason, requesting identity, data/tool scope, consequences, risk, classes and reversibility. Exact input/source details and the existing task/project/Gmail/Calendar/phone previews remain available. Unknown reversibility is explicitly described as unguaranteed, not invented.

New action attempts snapshot the explanation in immutable metadata. Decisions use existing action, approval, policy and outcome records. Existing Nexus event persistence projects these into Activity; hosted event streaming still depends on earlier migration 014. Rejected owner-administration attempts from an agent are also recorded.

The presentation uses the existing surface tokens with a restrained glass dialog, readable boundaries, keyboard focus, native modal behavior, and reduced-motion support. No unrelated screen or graph redesign.

## Emergency stop

`GET /api/permissions/emergency-stop` returns `{ active, revision, reason, updated_at }`.

`POST /api/permissions/emergency-stop` accepts `{ active, revision, reason }` through the authenticated owner control plane. Revision comparison prevents stale resets.

The latch is an append-only reserved scope in the **existing** policy table (`nexus-emergency-stop-v1`). It survives process/browser restart and does not depend on migration 017. Normal policy editing cannot overwrite its reserved scope.

While stopped:

- New non-read work is blocked before dispatch. Existing read permissions still apply; owner recovery, call cancellation and worker termination remain available within their existing boundaries.
- Cooperative in-process actions receive an abort signal. Other runtimes check durable stop state every second while non-read work runs. A failed durable-state read fails closed.
- Brain response, STT/TTS and MCP operations use the existing provider cancellation contracts. The initiating UI stops generation, speaking and capture; other visible controls refresh at fifteen-second intervals.
- Active plans receive the coordinator's existing durable pause records. Before clearing the latch, pause records are reconciled again. Reset does not submit a resume command or revive old approvals.
- Authority is rechecked immediately before dispatch and before committing staged internal mutations. A stopped staged task does not partially commit.
- Effects already completed cannot be undone by a stop. Adapters without cancellation support may finish. Completed receipts are retained; cancellation arrival is annotated on the outcome without rewriting immutable action metadata.

This is cooperative software cancellation, not an instantaneous physical or distributed kill switch. There remains a boundary between a final authorization check and an external provider accepting an effect. Uncertain external effects require receipt inspection before retrying.

## Database activation

Apply `supabase/migrations/202609090017_permission_engine.sql` to enable class/agent/behavior policies on hosted Supabase. It adds three nullable columns and validates class values, behavior/level consistency, and references to owned existing agent messages. Existing RLS, append-only privileges, tables and IDs remain intact. The migration is rerunnable.

**Hosted migration 017 was not applied during this milestone.** The application reports this requirement explicitly if extended policy writes encounter the missing columns. Older numeric policy writes and emergency-stop records use existing columns. Earlier hosted 014/015/016 and native/live gates remain as recorded in the roadmap. No real user policy, task or external account was changed for verification.

## Exact files

Added:

- `src/domain/permission-classes.ts` — classifications, behavior names and explanatory contract.
- `src/services/action-cancellation.ts` — cooperative controller registry and scoped signal.
- `src/services/orchestration-control.ts` — shared existing durable control-record format.
- `src/components/permission-brief.tsx` — shared approval explanation.
- `src/components/permission-engine.module.css` — restrained dialog/control styling.
- `src/components/emergency-control.tsx` — persistent stop/reset controls.
- `supabase/migrations/202609090017_permission_engine.sql` — additive policy fields and constraints.
- `tests/permission-engine.test.ts` — policy/action/cancellation/recovery cases.
- `tests/permission-engine-database.test.ts` — actual PostgreSQL/PGlite migration, isolation and constraint checks.
- `scripts/lib/permission-browser-check.ts` — disposable browser acceptance flow.
- `docs/nexus-permissions.md` — this audit, contract and acceptance report.

Extended:

- `src/domain/permissions.ts` — optional policy and tool-class fields; strict validation.
- `src/domain/tool-registry.ts` — class discovery and optional cancellation signal.
- `src/services/permission-service.ts` — rule resolution, stable legacy scopes, owner-only decisions and durable emergency latch/pauses.
- `src/services/action-service.ts` — authority rechecks, agent-bound fingerprints, explanatory snapshots, cooperative cancellation and receipt retention.
- `src/services/action-request-service.ts` — passes the existing execution's signal to adapters.
- `src/services/orchestrator-service.ts` — reuses the extracted control-record builder without changing its interface.
- `src/services/ary-brain-service.ts`, `src/services/voice-service.ts`, `src/infrastructure/mcp/adapter.ts` — propagate cancellation through existing provider interfaces.
- `src/infrastructure/repositories/local.ts` — validates owned agent scope.
- `src/infrastructure/repositories/supabase.ts` — clear missing-migration error for extended policy fields.
- `src/server/http.ts` — owner stop endpoints and existing agent choices in Settings.
- `src/components/approval-dialog.tsx`, `src/components/action-center.tsx` — shared explanations and approval styling.
- `src/components/permissions-panel.tsx` — class, agent and behavior controls alongside existing policy/history UI.
- `src/components/nexus/nexus-shell.tsx` — persistent emergency access in the status area.
- `src/components/dashboard.tsx` — stops existing capture/playback/generation on emergency notification.
- `scripts/evaluate-nexus-shell.ts` — reuses the existing isolated harness for permission checks.
- `README.md`, `ARY_NEXUS_ROADMAP.md` — feature/activation documentation and milestone status.

## Acceptance

Verified September 9, 2026:

- **1,228 tests / 73 files passed**, including 43 new permission/database cases. Existing permission, agent, task/idempotency, mission, memory and provider tests remain intact.
- **Standalone TypeScript passed** in the actual repository.
- **Repository formatting passed**; no separate lint command is configured.
- **Production Webpack build passed** in the existing isolated verification checkout with locked dependencies and matching changed source. This avoids disrupting the running desktop dev server's `.next` directory.
- **Normal and reduced-motion browser acceptance passed**: explanatory rejection and single-use approval, class deny, history-preserving disable, stop surviving reload, explicit reset, approved real internal task and linked approval/outcome/Activity records. Responsive 900px layout had no horizontal overflow; the shared harness found no browser errors. Screenshots were inspected.
- **Restart recovery passed**: an activated mission stays PAUSED after stop/reset in a newly constructed runtime and creates no task before explicit resume.
- **PostgreSQL/PGlite checks passed**: migration rerun, legacy compatibility, owner isolation, append-only policy history, class/behavior constraints and owned agent references.

The initial full run had 18 Premiere plugin failures because its iCloud-backed source file was dataless and returned an empty module inside the sandbox. Reading it outside the sandbox hydrated the file. Both copies then matched SHA-256 `9695b158654ee461dc9a7af6e7fba9f65d8a5582431fbc7dfa0ba40fad71d84e`; no Premiere source was changed, and the complete suite subsequently passed.

All fixtures use temporary local repositories or embedded PostgreSQL; browser HTTP and repository writes are real, with explicit demo providers and no production credentials. Browser servers and fixtures were removed by the existing harness. No live physical-device cancellation or hosted migration acceptance is claimed.

Limits retained: provider cancellation is cooperative; opaque MCP class matching is intentionally conservative; existing owner-history reads and per-action polling need deployment-scale profiling. Existing hosted 014/015/016 and worker/native/provider gates are unchanged. Next recommended work is controlled hosted activation of the already-written migrations and production-owner acceptance, following the canonical roadmap; no next milestone was started.

Manual check in an isolated workspace:

1. Open **System → Permissions & settings**. Scope a deny rule to EXECUTE and a mock tool. Confirm it is blocked and visible in Activity.
2. Revise/disable the test rule. Run the mock action, inspect its explanation, reject, then repeat and approve once. Confirm a later request needs fresh approval.
3. Use the existing action form to request `create_task` for an isolated project. Check no task exists before approval, then approve and inspect the task ID, receipt and outcome.
4. Start an isolated mission, activate **Emergency stop**, reload and confirm the stop remains active. Clear it; the mission must remain paused until explicitly resumed.
5. Repeat with reduced motion. Verify readable previews and keyboard access.
