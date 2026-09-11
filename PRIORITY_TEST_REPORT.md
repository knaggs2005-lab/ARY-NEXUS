# Ary Priority Intelligence — audit and verification

Date: September 7, 2026. Scope: priority read model and view only.

## Audit and reuse

The repository already contained canonical goals and tasks, project entities with
state/health/priority metadata, direct task-goal and project-goal links, temporal
`blocks` relationships, a graph query/rendering layer, append-only ROI attribution,
permission enforcement, and the existing Dashboard/spatial shell. No priority
service or priority screen existed. Effort, strategic assessments and forward
revenue estimates were not consistently recorded.

The implementation reuses those records and interfaces. It does not create a goal,
task, project, memory, revenue, or dependency store. It does not mutate work or
invoke an LLM. The normal authenticated repository and permission/audit pipeline
remain responsible for access. No dependency package or migration was added.

Before editing, the plan named the new read/scoring service, endpoint, lazy view,
navigation additions and tests. Existing root files were already untracked; this
inventory describes this milestone, not all untracked repository contents.

## What changed

### Existing files modified

| File                                        | Why                                                                                           |
| ------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `src/server/http.ts`                        | Add `GET /api/priorities`, guarded by existing activity/entity/ROI read permissions.          |
| `src/components/dashboard.tsx`              | Add Priority tab, title, lazy view and existing graph navigation callback.                    |
| `src/components/spatial/modules.ts`         | Extend the optional workspace destination union with Priority; keep the ten existing modules. |
| `src/components/spatial/spatial-shell.tsx`  | Add a Priority shortcut opening the existing workspace.                                       |
| `src/components/spatial/spatial.module.css` | Style that shortcut without changing the orbit or graph.                                      |
| `package.json`                              | Add `test:priority`; no new package or lockfile change.                                       |
| `README.md`                                 | Explain policy, metadata conventions, controls and verification.                              |

### New files

| File                                          | Responsibility                                                                                       |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `src/domain/priority.ts`                      | Read-model types, versioned weights, deadline bands and deterministic ranking.                       |
| `src/services/priority-service.ts`            | Read canonical work, resolve explicit dependency paths, collect evidence and historical ROI context. |
| `src/components/priority/priority-view.tsx`   | Rank/score explanations, sources, counterfactual controls, deadline view and refresh.                |
| `src/components/priority/use-rank-motion.ts`  | Interruptible FLIP position animation, stable DOM identity and reduced-motion cleanup.               |
| `src/components/priority/priority.module.css` | Scoped dark/glass view, top-rank emphasis, dependency paths and responsive states.                   |
| `tests/priority.test.ts`                      | 23 deterministic scoring, evidence, dependency and scope tests.                                      |
| `tests/priority-http.test.ts`                 | 5 API and permission tests.                                                                          |
| `scripts/evaluate-priority.ts`                | Repeatable isolated browser verification using temporary service-generated fixtures.                 |
| `PRIORITY_TEST_REPORT.md`                     | This audit, exact inventory and validation report.                                                   |

## Scoring and evidence

Policy `priority-v1` scores nine factors with weights totaling 100: deadline 20,
urgency 15, strategic importance 15, active goals 15, dependency leverage 10,
blocker attention 5, explicit expected revenue 10, effort 5 and confidence 5.
Each factor has its normalized value, contribution, explanation, supporting source
IDs/fields/timestamps, and what would change it. Source records are never silently
rewritten. Equal scores use due date then canonical ID, independent of title or
insertion order.

Unknowns receive no benefit. They remain visible as unknown, rather than becoming
invented low effort, high confidence, strategic importance or financial impact.
Weighted evidence coverage is separate from assessment confidence. Scores express
policy preference for attention; they are not probabilities or execution authority.
Blocker points identify work needing attention while readiness remains explicit.

Only active work enters ranking; completed/cancelled/archived/abandoned/paused work
is listed as excluded. Completed prerequisites stop constraining work. Paused or
cancelled prerequisites remain constraints for active consumers. Missing task
references are flagged as incomplete dependency evidence. Project blockers do not
automatically become individual task dependencies. Directed paths are limited to
two hops and 50 unique records per direction; near cycles are flagged.

Revenue contribution requires an explicit evidence-backed forecast and confidence
in existing metadata. Historical ROI remains separate, with attribution status and
source references; it never becomes future revenue. Invalid/unsupported metadata
is ignored. No new assessment editor was added. README documents the optional
`metadata.priority_intelligence` convention; its example is not seeded business
information.

## Visual behavior

The Priority view is lazy loaded within the current Dashboard, with a direct
spatial-shell shortcut. Rank changes move the existing keyed rows rather than
replacing the page. Position animation can retarget during an in-flight change;
score bars, borders and top-priority light respond softly. Native Web Animations
and scoped CSS suffice; no new animation package was needed.

The deadline-order view reuses the same rows and preserves their priority numbers.
Type filtering narrows visible work without redefining global rank. Explanation
selection follows the visible list. Dependency paths identify direction, named
records and source relationships, with a shortcut into the existing Brain Graph.

What-if controls adjust deadline/strategy emphasis and deadline evaluation up to
30 days ahead. Every preview is labeled and reversible. It does not edit deadlines,
priority, assessments, task state or relationships. Weights are renormalized to
100; actual rank can change when competing work changes. OS reduced motion removes
rank animation and emphasis transitions. Keyboard focus remains attached to the
same keyed work row during movement.

Refresh fetches in place. Entry, browser focus/tab return and the Refresh button
read new evidence. Requests are cancelled when superseded/unmounted. Failed or
denied refresh clears prior evidence rather than leaving a revoked snapshot on
screen. No hard page reload or realtime subscription was introduced.

## Verification

- Full suite: **416 tests passed in 31 files**. All 388 baseline tests remain;
  28 new tests cover Priority behavior.
- Typecheck: passed after the production build regenerated transient duplicate
  `.next/types` output. No source/config workaround was needed.
- Formatting: `npm run format:check` passed; no separate lint command configured.
- Production build: passed, including lazy Priority chunks.
- Dev client browser test: passed using isolated, explicitly labeled fixtures.
- Production client browser test: **12 checks passed**, including denied-refresh cleanup; no browser errors.
- Real authenticated workspace: opened Priority and verified five existing work
  items, canonical IDs, current ranks and unknown revenue. No work was edited.

Automated tests cover empty data, exact point sums, stable ties, UTC deadline
bands, malformed dates, inactive exclusions, direct goal alignment, two-hop task
paths, cancelled/paused prerequisites, cycle bounds, relationship direction and
validity, project-versus-task constraints, missing references, assessment evidence,
confidence-discounted revenue, historical ROI separation, scenario non-mutation,
user isolation, source-read failure, invalid weights, authentication and denial of
each required read permission before work evidence is loaded.

The browser script obtains fixtures from the actual `PriorityService` against a
temporary LocalRepository, then intercepts API responses only in its isolated
browser. It verifies initial canonical ranking, actual reordering/animation from
weight changes, visible what-if labeling, unknown revenue, deadline order, reduced
motion, refresh without navigation, no mutation requests, preserved tasks, denied
refresh cleanup and no browser errors. It is a client integration test, not a claim
of production database mutation testing. API permission/service tests and the live
read complement it. No camera or paid model calls are used.

## Observed live result

At the checked snapshot, Priority showed two tasks, one goal and two projects.
The Wag Trails tracking fix ranked first at **26 points**: 16 deadline points plus
10 urgency points. The retrieval-validation task had 20, the active memory goal
15, Ary Nexus project 5, and the unassessed Wag Trails project 0. All five displayed
revenue unassessed. This was read from existing work; no business impact or sample
records were inserted. Scores may change as deadlines advance or records change.

## Limits and manual test plan

The initial policy is deliberately transparent, but its weights are product
judgments, not a learned guarantee of optimal business outcomes. Missing estimates
can lower a score; inspect coverage before treating the order as authoritative.
Work overlaps across tasks/goals/projects, so scores and historical revenue context
must not be summed. There is no persistent rank history, new assessment editing
workflow, autonomous scheduling, or automatic action execution. Priority reasoning
is presented by the read service/view; this milestone does not change Chat's Brain
prompt or add a second reasoning engine.

The service reads the existing user-scoped work tables in full. Dependency paths
are bounded and maps are reused, but large-workspace query pagination and list
virtualization should be measured before scaling far beyond the current dataset.
Cycle detection is limited to the inspected two-hop neighborhood. A future-date
preview only updates deadline bands against today's records; it does not simulate
future task completion or reconstruct historical state.

1. Open Priority. Select a task, expand Deadline/Urgency and verify canonical IDs,
   dates and recorded priority. Expand Expected revenue and verify Unknown when
   evidence is absent.
2. Open what-if planning. Change deadline emphasis, compare the new ranks with
   “was #” markers, then Reset. Confirm underlying work fields are unchanged.
3. Toggle Deadline order and work type. Verify explanations follow visible work
   and no page reload occurs. Enable OS reduced motion and repeat.
4. Inspect dependency paths for records that actually contain links. Follow the
   Brain Graph shortcut; return to Priority through existing navigation.
5. Update a task via the existing reviewed action workflow, then Refresh evidence.
   Inspect its new rank/source timestamp. Completed work should move to exclusions.
6. If a read permission is denied, Priority should show an error and clear evidence.
   Restore it through existing Settings and refresh.

Recommended next milestone: a reviewed, evidence-preserving assessment workflow
for effort, strategic importance, forecast assumptions and confidence through the
existing action/approval infrastructure. No new goal/task/project system is needed.

Brain, memory/retrieval, temporal facts, entity resolution, graph/vgpu source,
providers, real action implementations, permissions/approvals, schemas, existing
APIs/tests, voice, desktop and external integrations were intentionally untouched.
