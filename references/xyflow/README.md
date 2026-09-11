# xyflow: Brain Graph interactions

Reference source: [xyflow-main](/Users/austin/Downloads/xyflow-main/). Upstream: [xyflow](https://github.com/xyflow/xyflow).

Observed package: `@xyflow/react` · snapshot version `12.11.6` · root license `MIT`. Version evidence: `packages/react/package.json`. These are local snapshot values, not recommended installation pins.

## Relevant source files

- [packages/react/src/hooks/useReactFlow.ts](/Users/austin/Downloads/xyflow-main/packages/react/src/hooks/useReactFlow.ts)
- [packages/react/src/container/NodeRenderer/index.tsx](/Users/austin/Downloads/xyflow-main/packages/react/src/container/NodeRenderer/index.tsx)
- [packages/react/src/types/component-props.ts](/Users/austin/Downloads/xyflow-main/packages/react/src/types/component-props.ts)

## Ary boundary and adoption decision

Relevant package components: `ReactFlow`, custom node/edge renderers, controlled selection, viewport helpers such as `fitView`, memoized node rendering, and optional visible-element rendering. These could solve a concrete accessibility or interaction-maintenance problem in a future graph renderer.

Ary ownership: `src/domain/brain-graph.ts` and `GraphQueryService` retain the graph response contract; `src/components/brain/brain-canvas.tsx` currently renders the canvas, while `graph-engine.ts` owns layout/selection helpers. A package adapter would map canonical `node.id` and `edge.id` directly to UI IDs. It would consume the existing bounded API responses, never query or write Supabase directly.

Decision: candidate for a focused renderer comparison, not an automatic replacement. Ary already has a canvas graph with a 240-node/900-edge display bound. A DOM/SVG renderer is not inherently faster. Preserve the current premium styling, contextual side panel, importance sizing, blockers, reduced motion, and smooth expansion while comparing implementations.

Adopt the published `@xyflow/react` package only if a demonstrated interaction/accessibility gain passes a side-by-side performance check. Pin the evaluated package in the lockfile. Do not import the monorepo's demos, workspace packages, build tooling, or Svelte renderer. Do not enable node/edge editing unless it is routed through Ary's permissions and API.

Acceptance: stable IDs/positions after expansion, search-to-node camera movement, connected-path highlighting, keyboard/touch behavior, reduced motion, and pan/zoom timings at 50, 150, and 240 nodes with up to 900 edges. Compare to the current canvas; measure rather than claim a larger-dataset speedup.

Primary guidance checked: [React Flow performance](https://reactflow.dev/learn/advanced-use/performance). Its memoization and narrow subscriptions are useful patterns independently of adopting the renderer.

## September 9: Mission Control adoption

`@xyflow/react` **12.11.6** is now pinned and installed specifically for the bounded, read-only mission execution graph. `mission-execution-graph.tsx` consumes an Ary-owned projection of canonical mission steps and receipts; it has no execution or storage authority. Custom nodes, pan/zoom/focus, selection and keyboard/HTML navigation address the requested operator workflow. The existing Brain Graph Canvas2D/vgpu renderer remains unchanged; this is not its replacement. See [Mission Control report](../../docs/nexus-mission-control.md) for tests, exact scope and limits.
