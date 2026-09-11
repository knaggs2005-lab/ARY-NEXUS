# Nexus Skills and Automations

## Audit and preserved architecture

The prior Skills destination projected ToolRegistry capabilities; Automations displayed an explicit placeholder. Durable Missions, a checkpoint engine, XYFlow Mission Control, shared-memory advisory submissions, per-step approvals, action idempotency, transactional repository batches, outcomes, and Nexus events already existed. These remain authoritative. No second executor, memory store, permissions engine, model provider, dependency, or database table was introduced.

## Implemented contract

`SkillDefinition` includes instructions, typed scalar inputs, named output bindings, success criteria, an exact declared tool list, ordered steps, conditional decisions, bounded repetition, and pinned subskill versions. Tools and `mission.agent` execute through the existing MissionEngine and ActionRequestService. Every generated proposal is an unapproved draft. Its required tool list is a ceiling, **not a policy grant**.

A Skill has a stable UUID and up to 50 immutable content versions. Saving an edit appends an unapproved version under a compare-and-swap transaction. Earlier approved versions remain reusable and running Missions keep their snapshots. Version review requires an exact version/hash and the existing one-time owner approval, even if the policy level is five. Skills cannot call permission administration, agent administration, Skill review, trigger enablement, or mission/orchestrator control tools. Sensitive domain tools retain their own approval and policy requirements on every execution.

Definitions live in owner-scoped canonical `messages.metadata.nexus_skill_v1` records with a dedicated artifact conversation, following the existing Mission/Agent metadata persistence boundary. Automation records use `nexus_automation_v1`. Artifact writes, successful action and outcome commit in the same existing transaction. Source user message, creating action, review action, timestamps, content hash and compiled version preserve provenance. There is no schema migration for this milestone. Previous hosted migration and worker gates still apply.

## Compilation and execution

1. Validate the strict definition and ordered dependency graph.
2. Read only explicitly pinned, approved subskill versions; inline their frozen compiled steps.
3. Expand repetitions (one to three) into unique serial steps; keep a maximum of twelve expanded steps, including subskills.
4. Rewrite result/verification bindings and decision references to compiled IDs.
5. Verify every executable and verification tool is registered and declared; reject control-plane tools and surplus permission declarations.
6. At launch, bind declared scalar inputs using `{"$input":"name"}` and validate actual tool inputs. No scripts, expressions, shell strings, dynamic tool dispatch, or prototype paths.
7. Create an existing Mission **draft** through `mission.create`, with a stable nested execution key.
8. Plan/start it in Mission Control. Every step retains current permissions, exact approvals, retry handling, audit, outcome, and read-back verification.

Output bindings reference actual action envelopes (`result`, `action_id`, `tool`); the launch receipt contains their compiled paths. Success criteria are review instructions, not fabricated proof. Existing per-step read-back determines verified execution. Arbitrary natural-language success predicates are not automatically certified.

## Natural language and editor

In Chat or transcribed voice: **“Ary, make this into a reusable skill.”** The shared conversation router takes up to six preceding messages, capped at 1,800 characters, and uses the existing bounded planner/provider. A specific workflow can replace “this.” No tools run during proposal. The mock provider does not silently replace real planning: use examples or the structured editor in development when planning is unavailable.

Skills opens a lazy-loaded React Flow workshop with selectable/movable nodes, editable forward dependencies, step/title/tool/repetition controls, version selection, instructions, criteria, and declared tools. The structured editor supports exact inputs, outputs, conditions, waits, and subskill references. A keyboard-accessible ordered step list supplements the graph. Saving validates the entire workflow. Reduced-motion CSS disables transitions; no synthetic execution animation is used.

Six unsaved examples are included: Clevaryn prospecting, client onboarding, content pipeline, research, podcast preparation, and morning briefing. Business examples use specialist evidence review followed by Analyst review, without outreach or invented business results. Podcast preparation calls the existing Studio inspection and scene planner; configuring actual devices and executing an exact scene remain separate.

## Automations

Manual and fixed-interval triggers target an exact reviewed Skill version plus typed inputs, or an exact existing Mission revision/spec. New triggers are disabled. Enabling requires owner approval. Editing configuration means creating another disabled trigger; disable the old one explicitly. Enabling does not grant the target tools permissions.

Intervals are UTC epoch windows anchored at `starts_at` (15 minutes to one week), not cron or timezone-aware calendar schedules. Delivery deduplicates by automation UUID and interval bucket; manual delivery uses an explicit invocation ID. Missed intervals coalesce to the current window; there is no catch-up burst. Triggers create new Mission drafts and do not resume the source Mission or auto-start tool execution.

The existing worker can deliver intervals when both flags are explicitly enabled:

```sh
ARY_MISSION_WORKER_ENABLED=true ARY_AUTOMATION_WORKER_ENABLED=true npm run missions:worker
```

The existing user-scoped access token requirements apply outside demo mode. Neither flag is enabled by this milestone. STOP CONTROL and current policies still govern dispatch. Worker hosting, authentication refresh, supervision and hosted checkpoint migrations retain their earlier deployment gates.

## Exact changes

Added:

- `src/domain/skills.ts`: strict workflow/trigger contracts, scalar bindings, six examples.
- `src/services/skill-service.ts`: versioned artifact storage, compiler, approval, launch and trigger delivery.
- `src/infrastructure/tools/skill-tools.ts`: registrations on the existing ToolRegistry.
- `src/components/skills/skill-builder.tsx` and `skills.module.css`: reusable Skills/Automations workshop.
- `tests/skills.test.ts`: isolated service/action/runtime acceptance.
- `scripts/evaluate-skills.ts`: disposable browser/action/approval/real-task acceptance.

Extended:

- `src/domain/permissions.ts`: Skill and automation capability definitions; mandatory version/enable approvals.
- `src/domain/tool-registry.ts`: optional stable request key in the execution context.
- `src/services/action-request-service.ts`: request-key forwarding, explicit real-tool classification and required idempotency keys.
- `src/services/action-service.ts`: Skill/automation lifecycle event families.
- `src/server/context.ts`, `src/server/http.ts`: compose the service and permissioned owner-scoped read endpoint.
- `src/services/orchestration-conversation-service.ts`: narrow reusable-skill intent on the shared conversation path.
- `src/services/nexus-map-service.ts`: saved Skill/trigger projections alongside existing capability nodes.
- `src/components/dashboard.tsx`: replace only the placeholder destinations with lazy-loaded workshop views.
- `scripts/run-missions.ts`: opt-in trigger delivery using the existing per-user worker.
- `.env.example`, `README.md`, `ARY_NEXUS_ROADMAP.md`: configuration/status/docs only.

## Verification

Verified September 9, 2026:

- **1,319 tests / 79 files passed**, including 26 new Skills cases. Original timeouts and assertions retained; the final suite used two workers. An earlier default-concurrency run hit one existing Podcast timing limit; the full final run cleared it.
- TypeScript, repository formatting and the isolated production build passed. No separate lint command is configured.
- **14 isolated browser checks passed**: visible graph controls, Skills navigation, six examples, structured editing, saved versions, rejected/approved review, edits invalidating launch, Mission Control navigation, separate task approval, actual task/outcome, approved automation creating a draft only, reduced motion and no framework overlays.
- Browser source/data/server/session cleanup completed. Final runtime/verification files were hash-compared with the working repository.
- Visual inspection corrected the new panel's retained-scroll/header overlap and a scoped padding conflict in XYFlow zoom controls. Browser assertions now wait for actual checkpoints and route mounts rather than assuming synchronous transitions.

Evidence logs: `/tmp/skills-release-tests.log`, `/tmp/skills-release-types.log`, `/tmp/skills-release-format.log`, `/tmp/skills-release-build.log`, `/tmp/skills-browser-final.log`. Screenshots: `/tmp/ary-skills-builder.png`, `/tmp/ary-skills-reduced.png`.

Tests isolate users/data and contact no external hardware or accounts. Real task creation uses LocalRepository and the production services/actions; the natural-language test substitutes the planner response, not the approval pipeline. Live production-model generation and hosted deployment are not claimed here.

## Bounds and next refinement

Twelve compiled steps, three repetitions, three pinned subskills, and fifty versions per Skill. Subskills must currently have bound inputs (no unresolved input declarations). Loops are bounded expansion, not arbitrary while loops. Named output bindings are exposed in launch receipts and Mission results; there is no separate output database. Interval worker dispatch is bounded to twenty outstanding deliveries per pass; already settled windows are skipped. Failed deliveries remain audited and do not retry repeatedly within the same window. Metadata listing uses the existing owner-scoped list APIs; database-side pagination/indexing is future scale work. Manual/interval triggers are included; cron, webhook/event triggers and automatic Mission activation are not implemented.

Next refinement: hosted acceptance of the existing checkpoint/event migrations and worker lifecycle, then a larger user-authored workflow evaluation set. No next milestone is started automatically.

## Manual acceptance

1. Open Skills, load Client onboarding, inspect both nodes and declared `mission.agent` permission.
2. Edit instructions and inputs, save a version, and reject its review. Confirm it cannot launch.
3. Review/approve the exact version, supply the brief, and create a Mission draft. Start only after reviewing Mission Control.
4. Save another version with a changed tool or instruction. Confirm the prior version remains intact and the new one needs review.
5. Use a task workflow with a real project ID. Confirm task approval is still separate; inspect its resulting task/action/outcome after execution.
6. In Automations select the approved version (or existing Mission), save a disabled trigger, review enabling, and deliver it. Confirm a draft appears without extra tasks or external effects.
7. Repeat the same interval delivery and confirm no second draft for that window. Check reduced-motion mode and keyboard step selection.
