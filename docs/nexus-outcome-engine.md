# Nexus Outcome Engine v1

## Audit and preservation

Read `ARY_NEXUS_ROADMAP.md` and repository instructions before implementation. Existing canonical `outcomes` already retain action ID, goal ID, execution status, summary, metrics and metadata. `ActionService` commits staged internal writes with action/outcome receipts. `outcome_versions` captures SQL and local repository changes. Economics already provides revised cost/impact ledgers and token-priced telemetry; Mission Control already links actual action receipts to checkpointed plans. Skills already retain immutable versions and launch receipts. Reflection already proposes reviewed memory changes and evidence-linked lessons from completed tasks/outcomes.

KEEP all of those systems. Extend with an OutcomeEngine projection and reviewed learning on existing outcome records. This does not replace Reflection or automatically duplicate its lessons in memory. No new brain, executor, permission engine, tables, packages, provider or model call. Existing graph, voice, missions, agents, Skills, Automations and unrelated screens remain authoritative.

## Capture and connections

`OutcomeEngine.report()` joins owner-scoped canonical outcomes/actions, mission artifacts, Skill launch receipts, entities, goals and optional existing Economics costs. Each row exposes the original action inputs/output/error, requesting agent, plan/steps, goal, execution result, observed metrics, explicit user assessments, corrections, lessons, links and elapsed action-to-outcome time. The original execution status is never relabeled as goal achievement.

- Goal achievement: unknown, success, partial or failure, with user-assessed confidence.
- Cost: existing Economics precedence and revision rules, including estimated vs reported actual, unknown calls and overlap exclusions. No amount is invented or inferred from a successful action. No time monetization or financial-attribution changes.
- Duration: elapsed wall time from action record creation to outcome record creation, including persistence. Not a model latency benchmark.
- Explicit connections: existing people, companies, projects and strategy entities (`metadata.entity_facet = "strategy"`), agent artifact IDs, exact Skill IDs/versions. All referenced IDs must belong to the authenticated owner; entity types and artifact/version markers are validated.
- Derived connections: exact mission receipt membership, recorded entity IDs and successful Skill launch receipts. Missing links remain missing; no name-only guesses.
- Evidence: bounded typed source references plus snapshots/hashes, source revision guards, reviewer identity/time and the actual review action ID. User assessments are attributed assertions, not independently measured facts.

Assessments append to `outcomes.metadata.nexus_outcome_engine_v1`. Prior assessment revisions and original action/outcome receipts remain intact. A correction is another reviewed assessment; restoring an earlier assessment also requires a new review. Existing outcome-version triggers provide an additional durable record history.

## Repeated evidence and reversible recommendations

`outcome.propose` accepts three to eight selected outcomes for one tool. It requires distinct recorded runs with failures or explicit corrections. Outcomes in one mission or conversation count as one run. Idempotent replay receipts and the Outcome Engine's own/read audits are excluded, preventing self-training and replay inflation.

Rule v1 proposes a bounded preflight/verification experiment, carrying exact outcome/action snapshots, hashes, run IDs and the source corrections. Identical evidence sets deduplicate independent of order. Simulation and selection bias are disclosed. Repetition is an association, not causal proof or proof of production effectiveness. This is a transparent deterministic rule; it does not use a new LLM or generate arbitrary behavioral instructions.

Proposal history: proposed → accepted or rejected; accepted → withdrawn. Every meaningful review requires exact existing approval, even at permission level 5. Rejection is terminal for that proposal. Withdrawal reverses its advisory acceptance and preserves every event. A changed source or assessment makes previously accepted advice inactive; acceptance checks live provenance again and uses transactional compare-and-swap guards.

**Acceptance never edits core instructions, system prompts, permissions, agent configuration, existing Skills or learned memory.** `outcome.inspect` exposes selected evidence/advice for controlled discovery. Applying a lesson to a workflow is a separate reviewed Skill version and still requires all runtime tool approvals. No automatic lesson injection, self-modifying prompt or autonomous behavior rollout was added.

## Interfaces and permissions

- `GET /api/outcome-engine`: authenticated comparison projection behind `outcome.read` plus existing activity/conversation/entity/Skill read policies. Cost access separately checks `roi.read`; denial leaves cost unavailable.
- `outcome.inspect`: selected outcome IDs, up to 20; exposes receipts and advisory recommendations through existing ToolRegistry/action dispatch.
- `outcome.assess`: outcome ID, current revision, observed result, achievement, confidence, typed metrics, correction, lessons, links and evidence. Requires exact approval.
- `outcome.propose`: three to eight outcome IDs; drafts a repeated-evidence proposal.
- `outcome.review`: outcome ID, recommendation ID, accepted/rejected/withdrawn and reason; requires exact approval.

All executable tools use the existing request-key pipeline. Staged metadata writes, successful action receipts and resulting outcomes commit together. Errors keep the failed attempt audit, with no partial learning change. A successful repeated key replays the existing result. A transient failed attempt follows the existing new-key retry contract; evidence/revisions and permissions are revalidated.

## Visual experience

Open **WORLD → Economics → Outcome learning** (or ⌘K → Economics). Search recorded outcomes; select up to four for side-by-side result, achievement, confidence, cost, duration, goal/plan, correction and entity comparison. Open an outcome to review an assessment. Advanced metrics/links use structured JSON in this first version. Source receipts/history are expandable. Repeated lessons expose their evidence, rationale and reversible review states, including older recommendations beyond the recent-outcome window.

The new surface is lazy loaded within Economics and reuses existing shell, controls, approval dialog and action presence. Restrained depth/light, brief entrances, tabular numbers, visible focus and reduced-motion overrides preserve readability. No graph or navigation redesign.

## Exact files

Added:

- `src/domain/outcome-engine.ts`
- `src/services/outcome-engine.ts`
- `src/infrastructure/tools/outcome-tools.ts`
- `src/components/outcomes/outcome-comparison.tsx`
- `src/components/outcomes/outcomes.module.css`
- `tests/outcome-engine.test.ts`
- `tests/outcome-engine-database.test.ts`
- `scripts/evaluate-outcomes.ts`
- `docs/nexus-outcome-engine.md`

Extended:

- `src/domain/permissions.ts`: declarations for the four executable capabilities and comparison read policy.
- `src/services/action-request-service.ts`: real internal-tool classification and required idempotency keys for the new namespace.
- `src/server/context.ts`: compose the engine and register tools.
- `src/server/http.ts`: guarded comparison endpoint.
- `src/components/roi-dashboard.tsx`: lazy Outcome learning perspective, retaining the existing Economics ledger.
- `README.md`, `ARY_NEXUS_ROADMAP.md`: usage and milestone status.

No schema or dependency migration. Existing migration 005 outcome versions/batch and subsequent current batch/RLS contracts support these writes. Tests exercise all installed migrations in disposable PGlite PostgreSQL; no hosted account, schema or credential was touched.

## Verification

Final verification passed: **1,347 tests across 81 files**, standalone TypeScript, configured Prettier formatting check and an isolated production build. No separate lint command is configured. The stable dependency mirror matched all 14 changed runtime/test/script/README files in the actual repository; the live desktop dependency symlink and build output were preserved.

- 25 focused service tests: attribution, permissions, exact/rejected approvals, correction history, replay, rollback/retry, owner isolation, entity/Skill/agent/strategy links, independent-run requirements, deduplication, stale evidence, source changes, concurrent writes and reversible advice.
- 3 PostgreSQL tests: existing batch metadata writes/version capture/RLS, partial-failure rollback and stale compare-and-swap rejection.
- 12 isolated browser checks: actual approved internal task, three audited mock failures, navigation, assessment rejection/approval, comparison, proposal, exact acceptance, withdrawal, audit history, reduced motion and no framework overlays. Temporary sources, browser, server and repository fixtures were deleted afterward. No external effects or live models.
- The initial browser harness needed its required project fixture and existing HTTP 201 expectation corrected; the final complete browser flow passed. These were harness errors, not changes to the task API.

## Limits and next refinement

The comparison returns the most recent 200 eligible outcomes; repository list reads are still the existing owner-scoped adapter reads, not a new paginated SQL analytics query. No scalability claim beyond this bounded UI. Histories are capped at 100 assessments and 50 recommendations per anchor outcome; eight-source proposals stay within the existing transactional batch ceiling. Advance to indexed/paginated aggregates only when measured scale requires it.

No automatic Reflection scheduling, causal inference, autonomous workflow revision or production effectiveness claim. Missing business metrics, costs and links remain unknown. Provider/hardware execution and hosted deployment acceptance are separate. The useful future extension is an explicitly reviewed Skill experiment tied to before/after outcome cohorts, without automatic permission gains. The canonical NEXT 3 and earlier hosted/native gates remain unchanged; no next milestone started.
