# Central NEXUS spatial map

September 9, 2026. Bounded implementation complete; hosted event delivery still requires the previously pending event migration 014.

## Audit and renderer decision

The existing system has `GraphQueryService` and a bounded Supabase neighborhood/search RPC, Canvas2D graph interaction, optional vgpu effects, canonical entities and relationships, original memory/plan records, ToolRegistry, saved inspection receipts and the normalized event bus. It has no installed Three/R3F, Sigma, Cytoscape, Graphology, ELK or React Flow runtime. The earlier “xyflow” prompt is not evidence of an installed renderer. The actual renderer and its original screen were preserved.

| Evaluated technology                                                                                                                                                   | Appropriate use                                                 | Decision for this milestone                                                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Three.js](https://threejs.org/manual/) / [React Three Fiber](https://raw.githubusercontent.com/pmndrs/react-three-fiber/master/docs/advanced/scaling-performance.mdx) | True 3D objects, instancing, demand rendering and geometry LOD  | No new dependency. Existing canvas can project semantic depth and provide orbit without a second renderer. True 3D remains a possible later renderer behind the same projection. |
| [3D Force Graph](https://github.com/vasturiano/3d-force-graph)                                                                                                         | Three/WebGL graph display with force layout and camera controls | Not selected. Continuous physics is unnecessary for a bounded map with stable semantic regions.                                                                                  |
| [Sigma.js](https://www.sigmajs.org/docs/)                                                                                                                              | WebGL rendering of larger 2D graph views                        | Useful if profiling later justifies thousands of simultaneously visible nodes. Current LOD deliberately caps visible records.                                                    |
| [Cytoscape.js](https://js.cytoscape.org/)                                                                                                                              | Interactive graph analysis, layouts and graph algorithms        | No unmet analysis requirement warrants replacing the working interaction layer.                                                                                                  |
| [Graphology](https://graphology.github.io/)                                                                                                                            | In-memory graph structures and graph algorithms                 | Avoid a second graph authority. Current typed read projection and adjacency processing suffice.                                                                                  |
| [ELK](https://eclipse.dev/elk/)                                                                                                                                        | Automatic layout, especially structured diagrams                | Better suited to detailed dependency/mission diagrams than this central semantic overview.                                                                                       |
| [React Flow](https://reactflow.dev/learn)                                                                                                                              | React node-based interactive diagrams and editors               | Retained as a candidate for a future plan editor, not installed as a replacement for the current graph.                                                                          |

This is a **projected spatial canvas**, not a mesh-based Three.js scene. Orbit rotates a deterministic depth layout; depth communicates grouping rather than physical distance. No new packages were installed. Existing vgpu ambient effects remain optional; graph interaction and fallback work without WebGPU.

## What the map represents

`domain/nexus-map.ts` defines an additive read projection. It does not create domain records or change canonical IDs.

- **ARY:** the existing shared AryBrainService, with explicit system identity `system:ary`.
- **Agents:** six actual registered advisory Board roles. “Available” means registered, not running or independently autonomous.
- **Missions:** saved orchestration plans on their existing messages, with real status, revision and entity/memory references. No second mission database.
- **Memory:** current, unarchived memories, using their summary or a bounded excerpt and actual memory_entities links. No embeddings or full conversation are returned to the map.
- **People, companies, projects:** canonical IDs and relationship records from the existing graph RPC. Existing products, goals, decisions and tasks are also supported.
- **Locations, applications, devices, skills and automations recorded as entities:** explicit `metadata.nexus_kind` facets on existing canonical entities. Unmarked names are never guessed to be locations/devices. This adds a read convention, not new entity-type tables or an onboarding editor.
- **Applications/devices observed by tools:** saved successful `desktop.list_apps` and `studio.inspect` receipts. Paths are omitted. Default unconfigured Studio placeholders are omitted. These nodes say “previously observed,” never “currently connected.” Opening the map never scans this Mac or contacts devices.
- **Tools/skills:** actual non-simulated ToolRegistry entries and their registered action capabilities. Permissions remain visible. Skills are capability projections, not a new registry or agent framework.
- **Automations:** explicit recorded facets can appear; no recurring scheduler exists, so an empty category explains that limitation rather than generating synthetic runs.

Projection identities have clear prefixes for system/role/tool/memory/mission/inspection nodes. Existing entity UUIDs remain unchanged. View-group IDs start with `cluster:` and explicitly describe grouping rather than identity merges. Source details and original-record navigation remain visible in the contextual panel.

## Bounded reads and semantics

New `GET /api/nexus-map` accepts `q`, `kind`, optional entity `root`, depth 1 or 2, `after` UUID cursor and a bounded registry/inspection page. Unknown parameters, oversized searches and excessive depth are rejected. Existing authenticated HTTP context, ActionService read logging and PermissionService remain in use. Partial restricted/unavailable sources are labeled instead of silently filled with samples.

The entity branch reuses the existing graph RPC with at most 48 nodes/160 relationships. Additional repository methods select narrow columns, owner-filter and limit memory, saved-plan and facet pages to 24 records plus one lookahead. Memory links are capped at 200; inspection projections use the latest successful receipt per domain and at most 512 observed items, with 24 shown per window. Registry entries are paged in groups of 24. The combined response is capped at 180 nodes/300 edges and removes dangling connections. No migration is required for these read methods.

The renderer draws at most 100 nodes/240 edges. It uses current explicit `part_of`/`belongs_to` links for project/company context, then meaningful record/capability categories. This is deterministic domain-semantic grouping, **not an embedding/community-detection claim**. Similar names never merge identities. Aggregate edges retain original relationship/event evidence. Layout is stable for an unchanged view and does not run a force simulation.

At overview, groups replace individual rows. Zoom changes detail using hysteresis; small groups reveal records, while large groups require expansion. Explicit expansion reveals at most 24 group members at a time. Selected clusters retain their context until opened. A category's **Next window** replaces its bounded page, rather than appending all database rows. One/two-hop focus uses the existing canonical traversal. Counts describe the loaded window, not database-wide totals.

## Interaction and appearance

NEXUS now opens the intelligence map; **Entity Brain Graph** retains the original graph screen. No other workspace navigation or screen was redesigned.

Controls include search, category filters, pan/orbit mode, wheel/pinch zoom, fit, overview reset, directory, selection, group expansion, canonical neighborhood focus/depth and source navigation. Arrow keys move/orbit; +/- zoom and 0 fits. The directory/search provide keyboard-accessible alternatives to canvas hit testing. Tool nodes navigate to the existing approval/action review surface, never invoke a tool directly.

The map uses quiet slate/violet depth, soft light fields, restrained graph materials, distinct group counts, contextual evidence and existing shell typography. Dense technical details stay in Systems Mode. The viewport culls offscreen nodes, reuses the existing camera/hit testing/animation cleanup, caps DPR at 2, stops canvas frames after transitions settle and pauses offscreen/hidden work. Reduced motion disables pulse/travel animation while keeping state and selection visible. No new texture/mesh assets or physics worker are needed.

## Real activity only

The map subscribes to the existing event bus. Fresh non-client events must explicitly reference at least two nodes in the loaded view to produce an `observed_together` path. Those edges mean co-reference in an observed event, not a newly inferred relationship. Board role events can connect the actual registered role to ARY. Each path retains its event ID and expires after eight seconds. Historical, future-skewed, internal, unrelated and client-only events cannot generate execution paths. Selection highlights a relationship for inspection; it does not claim execution.

The canvas receives only the currently active edge set. Existing GPU selected-path energy is suppressed for this new projection; actual activity paths are driven by normalized event evidence. The original Entity Brain Graph retains its previous behavior. High-frequency voice meters and provider streams are not copied into map data.

Activity can illuminate only references present in the bounded view. Event schema/source coverage still limits which devices/applications can be individually identified. Refresh loads newly created records; the map does not automatically traverse unseen data or change the user's camera when an unrelated event arrives. If migration 014 is unavailable, canonical map reads continue and the UI explicitly reports unavailable live activity.

## Files changed

Added:

- `src/domain/nexus-map.ts`: projection schema, provenance and safe source transforms.
- `src/services/nexus-map-service.ts`: bounded, permission-checked composition.
- `src/components/atlas/map-projection.ts`: grouping, LOD, deterministic projected depth and evidence-backed event paths.
- `src/components/atlas/nexus-map.tsx`, `nexus-map.module.css`: central map, controls, contextual details and original-graph switch.
- `tests/nexus-map.test.ts`: 32 new contract, service, isolation, grouping, scaling and activity tests.
- This report.

Extended:

- `src/domain/repository.ts` and `src/infrastructure/repositories/{supabase,local}.ts`: additive bounded map-source reads. Existing operations remain unchanged.
- `src/server/http.ts`: authenticated read endpoint through existing action/permission services.
- `src/components/brain/brain-canvas.tsx`: optional supplied positions, orbit/scale callbacks, atlas material and observed-edge set. Defaults preserve the old graph.
- `src/components/dashboard.tsx`, `src/components/nexus/destinations.ts`: mount and name the new NEXUS view; original entity graph remains accessible.
- `scripts/evaluate-nexus-shell.ts`: opt-in map browser acceptance within the existing isolated harness.
- `tests/communications.test.ts`: one source-specific assertion replaces an unstable `timeline[0]` assumption. The same Calendar-contact expectation is preserved; no Communications production code changed.
- README and roadmap.

Intentionally untouched: memory extraction/reconciliation/retrieval, providers, canonical business schema, entity resolution, permission execution, approvals, idempotency, outcomes, studio/device executors, event persistence migration, original vgpu shaders and the other workspace screens.

## Verification

- **1,001 tests / 63 files passed**, including **32 new map tests**. Covers owner isolation, bounded pagination, permission denial, actual source IDs/links, no fabricated applications/devices/automations, safe inspection projection, current-vs-historical grouping, deterministic orbit coordinates, group focus, node/edge budgets and event freshness/evidence.
- A 10,000-record deterministic fixture collapses to semantic groups; a high-cluster-count fixture verifies no dangling edges beyond the 100-node budget. This tests bounded projection logic, not a production database/GPU service-level objective.
- Typecheck, configured repository Prettier check and production build passed. No separate lint command is configured.
- Standard and reduced-motion browser acceptance passed: real local UI → HTTP → approved task/action/outcome; map read/search; canonical entity context; two-hop focus; orbit keyboard movement; zoom; explicit cluster expansion and Overview reset with every node center verified inside the viewport; honest empty automations; directory bounds; original graph round trip; 1440px and 900px captures. No browser errors. Model answers use the explicit development stub; no paid provider or external execution was used.
- Captures: `/tmp/ary-nexus-map-overview.png` and `/tmp/ary-nexus-map-compact.png`. Browser fixtures are isolated and removed by the existing evaluator.
- Verification uses the prior healthy exact-locked-dependency checkout at `/tmp/ary-shell-dependencies` with matching source, because the original dependency tree has documented iCloud read issues. SHA-256 parity verified across 359 source, test, script, migration and configuration files at completion.

Manual check: open NEXUS, select Projects, find Wag Trails, open its context and two-hop neighborhood. Switch to Entity Brain Graph and back. Expand a group, change zoom, use orbit and return to Overview. Review a tool through its original approval surface; only actual matching event references should light a path. Inspect empty/unavailable sources without creating sample activity.

## Limits and next refinement

No hosted migration, native discovery, device activation, model permission or external provider setting was changed. Hosted event delivery remains pending migration 014. No full 3D mesh scene, automatic embedding clustering, new agent framework or recurring automation was added.

The map endpoint is bounded, but the pre-existing global Dashboard bootstrap still materializes larger owner snapshots for other screens. JSON/substring source filtering and inspection history need database profiling at large tenant sizes; there is no new scale/index migration here. LocalRepository retains its existing single-process file-store limitation. Inspection data can be stale, and categories without canonical/observed sources stay empty. Highly connected memory links are capped. No million-record or physical-device acceptance claim is made.

The next useful refinement is hosted event activation plus measured large-tenant query/viewport profiling and incremental source invalidation. It has not been started automatically.
