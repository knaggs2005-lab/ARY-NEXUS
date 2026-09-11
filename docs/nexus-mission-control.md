# Nexus Mission Control

September 9, 2026. Presentation over existing durable missions and legacy execution plans.

## Audit and scope

The repository already had a durable `MissionEngine`, `OrchestratorService`, canonical message checkpoints, action receipts, exact approvals, outcomes, Economics cost records, the Nexus Event Bus and an execution-plan screen. The screen listed steps and checkpoints but had no execution graph or combined mission inspector. History was limited to the most recent 30 plans. Existing Brain Graph interaction uses Canvas2D/vgpu; it is unchanged.

This implementation adds one read-only projection and a Mission Control surface inside **MISSIONS → Execution Plans**. Existing lifecycle controls, legacy execution controls, approval review, revision history, detailed steps and separately reviewed outcome memory remain available. No mission state, execution algorithm, schema, worker, provider or permission rule was changed.

## Experience

- **Why:** the canonical objective and source conversation/mission IDs.
- **What is planned:** a dependency graph of actual steps, declared conditions, evidence waits and verification criteria. Expected outcomes are labeled as planned criteria rather than achieved results.
- **Who:** the ARY coordinator, registered tool, and explicitly assigned Board role for `mission.agent`; no invented agent activity.
- **Now:** recorded executing/verifying states and pending-approval counts. Paused, failed, cancelled and completed missions do not pulse.
- **Already happened:** the last five checkpoint summaries, full existing checkpoint history, action attempts, approvals, read-back results and outcome records.
- **Waiting/failure:** direct attention links, actual errors, existing recovery guidance, dependencies, wait deadlines, submitted evidence and retry time/attempt.
- **Cost:** mission-linked model calls and existing Economics cost revisions, including corrected actual/estimated amounts, separate tool/compute components and unknown coverage. The inspector shows source cost/usage/latency records. No budget, forecast, revenue or monetary outcome is fabricated.
- **Approval:** an inspector button opens the existing `ary:approval` exact-action dialog. Existing grouped approval review is preserved. Selecting graph nodes never authorizes or executes anything.

Open any accessible mission by its stable ID, including one outside recent history. The selected older mission continues refreshing so its controls use current checkpoints. A removed/unauthorized mission fails the existing owner/policy checks.

## Graph boundary

Published **`@xyflow/react` 12.11.6** is pinned in `package.json` and the lockfile, and installed into the working checkout. Only the renderer package and its published dependencies are adopted; no reference application was copied. The existing Brain Graph and vgpu layer are untouched.

`src/domain/mission-control.ts` creates an Ary-owned graph projection with stable `step:kind` identities, dependencies and explicit activity. The client adapter maps these to XYFlow nodes/edges. All graph editing, connection editing, dragging and deletion are disabled; pan, zoom, selection, focus and keyboard/HTML navigation remain available. The source plan is never mutated by layout.

Custom node rendering follows the official [custom-node guidance](https://reactflow.dev/learn/customization/custom-nodes); memoized nodes/callbacks, lazy loading and visible-element rendering follow the [performance guidance](https://reactflow.dev/learn/advanced-use/performance). The HTML node navigator provides a straightforward alternative to spatial interaction, alongside [React Flow keyboard accessibility](https://reactflow.dev/learn/advanced-use/accessibility).

Actual node kinds are tool, agent, decision, approval, wait and output. Independent dependency paths express potential branches, not a claim that all branches execute concurrently. Retry attempts are shown from existing receipts/timers. The engine does not support arbitrary loops or child missions, so no fake loop/sub-mission nodes were added. A future engine capability can extend the presentation contract when real records exist.

The current engine caps a plan at 12 steps; projection is at most 60 nodes plus dependency edges. There is no force simulation, new layout dependency or all-missions graph. Memoized components and stable viewport preserve pan/selection during ordinary state refresh. New gate nodes or reviewed plan changes may alter layout; users can refit/focus explicitly. This is not a benchmark for an unbounded workflow editor.

## API, evidence and authority

`GET /api/orchestrator/plans/:id` uses the existing authenticated catch-all router and `OrchestratorService.inspect`, including conversation/activity permission checks and owner-scoped lookup, before returning anything.

`MissionControlService` joins canonical action IDs, internal coordinator execution keys (including prior attempts) and explicit mission-control action references. A caller-selected key alone cannot attribute another action to a mission. No unrelated conversation action or unlinked model call is guessed into costs. Receipts contain their real input/output, requester, reason, timestamps, immutable approval decisions, outcomes and linked model calls.

Economics visibility checks the existing `roi.read` permission. A denial leaves mission context available while withholding the Economics projection. The existing `calculateRoi` implementation determines cost precedence and current revisions; reported actual costs replace overlapping estimates. Partial sums are explicitly partial and unknown stays unknown, including no-cost-data cases. Historic/unlinked planning telemetry may be unavailable and is never inferred from model names.

The API returns the most recent 200 mission receipts and their total count, with cost summaries over known mission records. Older receipts remain in Action history. Existing repository `list` methods still materialize owner histories server-side; this milestone bounds presentation, not underlying multi-tenant query cost. Indexed mission-scoped history queries remain future scaling work.

## Realtime and presentation reliability

The existing authenticated Nexus Event Bus invalidates the selected mission when correlated backend events arrive. The UI refetches canonical records; event text cannot overwrite state. A three-second polling fallback remains available where hosted event migration 014 is pending. Hidden tabs stop detail polling; fetches have timeouts, cancellation and an in-flight guard. Failures visibly mark receipts stale and suppress animated activity. Parent history retains its existing two-second polling behavior.

The graph uses dark working surfaces, quiet borders, compact state labels and a contextual side inspector. The inspector stacks beneath the map in smaller windows. Only active nodes/paths animate; reduced-motion disables those effects and focus animation. Inputs/results render as escaped text, with bounded scroll regions. No additional model calls or execution are triggered by opening Mission Control (existing audited read checks still run).

## Exact changes

Added:

- `src/domain/mission-control.ts`: presentation types, graph/attention projection and receipt attribution.
- `src/services/mission-control-service.ts`: read-only owner/policy-checked mission details and existing Economics aggregation.
- `src/components/orchestrator/mission-control.tsx`: mission brief, event/poll refresh, attention, inspector and evidence timeline.
- `src/components/orchestrator/mission-execution-graph.tsx`: lazy XYFlow renderer adapter.
- `src/components/orchestrator/mission-control.module.css`: scoped surfaces, graph nodes, responsive/reduced-motion styling.
- `tests/mission-control.test.ts`: projection, isolation, permissions, attribution and cost-revision cases.
- This report.

Extended:

- `src/server/http.ts`: one additive GET route, no mutation API change.
- `src/components/orchestrator/orchestrator-panel.tsx`: mount Mission Control, collapse creation/details when appropriate, open by ID and refresh older selections. Component keys are distinct from the existing approval panel, preventing duplicate UI mounts during updates.
- `scripts/evaluate-nexus-shell.ts`: graph, inspector, exact approval, reload, resulting task ID, direct ID opening, single-mount, reduced-motion and responsive assertions.
- `package.json`, `package-lock.json`: pinned XYFlow dependency only.
- README, roadmap and XYFlow reference note: usage and adoption/deployment status.

Intentionally untouched: Brain/memory/retrieval/entities, graph/vgpu, mission execution and durable storage, permissions/approval consumption, actions/idempotency/outcomes, model providers, external tools and desktop configuration. No migration was added or applied. Hosted Missions still require the previously documented migrations 014/015 and explicitly configured worker.

## Verification

**1,054 tests / 66 files passed**, including 14 new Mission Control tests and all existing restart/recovery tests. Typecheck, configured repository formatting and production build passed; no separate lint command is configured. The exact-lock verification checkout `/tmp/ary-shell-dependencies` was reused because of the earlier documented iCloud dependency issues; **387 source/test/script/migration/desktop/configuration files matched byte for byte** against the working repository. Isolated browser and Mission Control fixture directories were verified removed. The new pinned dependency is also installed in the actual repository.

Standard and reduced-motion browser acceptance passed with no browser errors; responsive 900 px and desktop 1440 px captures were inspected. The browser check found a duplicate React-key collision with the adjacent existing review panel; the new component received a distinct key and acceptance now asserts exactly one Mission Control surface across updates. Cost/identity tests cover permission denial, owner isolation, actual-versus-estimate revisions, unknown amounts, previous attempts and exclusion of unrelated or caller-key-spoofed actions.

Evidence: `/tmp/mission-control-all-tests.log`, `/tmp/mission-control-types.log`, `/tmp/mission-control-format.log`, `/tmp/mission-control-build.log`, `/tmp/mission-control-browser.log`, `/tmp/mission-control-browser-reduced.log`; screenshots `/tmp/ary-mission-control.png` and `/tmp/ary-mission-control-reduced.png`.

 Acceptance uses a disposable LocalRepository, explicit development model and real internal task transaction; no production user, external provider, email or financial action is used.

The realistic browser flow creates a durable task mission, plans/starts it, inspects its graph and approval, reloads without losing that approval, approves through the existing queue, creates one actual task, verifies it, and drills down to its recorded task ID/outcome. It also checks direct mission-ID opening, single graph mount and responsive/reduced-motion behavior. Temporary fixture/server/browser resources are cleaned up.

Manual check: open MISSIONS → Execution Plans, select a mission, inspect the objective/current state/cost coverage, choose a graph node or its HTML navigation button, expand Calls & results, review any exact approval, then use existing lifecycle controls. Pause/resume or wait for an external checkpoint and confirm selection persists while status changes. Use Focus selection or the built-in fit/zoom controls. Reduced-motion should remain static while labels continue updating.

Next useful refinement: validate operator comprehension on multi-branch real missions and add indexed mission-scoped receipt queries when history volume warrants it. No subsequent milestone is started automatically.
