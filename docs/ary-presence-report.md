# ARY visual presence v1

Implemented September 8, 2026. This is a read-only presentation layer over existing execution, voice, conversation and Board systems. No new brain, graph, memory, permissions system or agent framework.

## Audit and rendering choice

The Stage 3 shell already provided a compact `AryPresence` seam, a shared voice lifecycle/input meter, an approval queue projection and reusable dark surfaces. Brain NDJSON carried text/entities/results but no precise retrieval/reasoning phases. Board already streamed actual advisory-role stages. ActionService already checked permissions, enforced exact approvals and committed results/outcomes transactionally. Orchestration already executed through that service. The existing graph used Canvas2D plus optional vgpu 0.4.0; no Three.js, R3F, Drei, Motion or GSAP packages were installed.

| Option evaluated                     | Decision                                                                                                                                                                                                                                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Three.js                             | Useful for scene geometry/cameras. This bounded light field needs neither; adding a renderer and post-processing pipeline is unnecessary. [Official post-processing guide](https://threejs.org/manual/en/post-processing.html).                                                             |
| React Three Fiber                    | Good declarative Three scene lifecycle; its on-demand rendering pattern informs this implementation, but no Three scene exists to justify the dependency. [Performance guide](https://r3f.docs.pmnd.rs/advanced/scaling-performance).                                                       |
| Drei                                 | Scene/performance helpers for R3F, without a role in this single-effect implementation. [Official documentation](https://drei.docs.pmnd.rs/).                                                                                                                                               |
| GPU-efficient shader / existing vgpu | Selected: one full-screen triangle, eight bounded filaments, two uniforms, fixed 640×240 buffer, no textures/particles/noise/post-processing passes. Reuses the installed package and graph renderer’s lifecycle conventions; graph files stay untouched.                                   |
| Framer Motion / GSAP                 | Neither is needed for one bounded shape transition. Native RAF handles the shader; existing CSS handles presentation. No timeline dependency added. Transform/opacity and avoiding layout work remain the useful guidance. [Motion performance guide](https://motion.dev/docs/performance). |

No dependency or lockfile changes.

## What the object communicates

A folded, layered light field appears above the Chat conversation. A compact static rendition and readable state remain in the shell footer. Shape and color encode semantic state; light travels only during an active phase. Idle remains a composed still object. There are no random activity values, fabricated completion percentages, simulated agents or idle “thinking.”

| State         | Actual source                                                                                                                                                      |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Listening     | Existing microphone capture state and input-meter amplitude (only while listening).                                                                                |
| Understanding | Existing STT lifecycle; backend entry to entity resolution / intent identification.                                                                                |
| Retrieving    | Backend entry to `MemoryService.getRelevantMemories`.                                                                                                              |
| Thinking      | Backend entry to model reasoning, with the actual bounded retrieved-memory count.                                                                                  |
| Remembering   | Backend reconciliation job execution.                                                                                                                              |
| Acting        | ActionService after validation, permission/approval checks, immediately before the operation.                                                                      |
| Delegating    | Existing Board `stage` events; advisory roles, not separate autonomous agents.                                                                                     |
| Mission       | Existing `orchestrator.*` actions executing through ActionService. This indicates coordinator work, not independent verification of every plan step.               |
| Waiting       | A request was dispatched, STT/TTS is preparing, transcript needs review, or an interrupted operation may still be saving.                                          |
| Approval      | Persisted approval-required action from the existing prompt or refreshed pending queue. No execution is implied.                                                   |
| Speaking      | Actual existing audio playback state. Light flow is a state treatment, not a fabricated audio-amplitude waveform.                                                  |
| Complete      | Brain reports saved completion, Board reports a saved brief, or action/result transaction succeeds. A brief 2.4-second receipt then clears only its own operation. |
| Error         | Existing voice errors, action failure/denial, failed transport, or incomplete Brain/Board result. Existing detailed error/approval views remain authoritative.     |

Fast stages are allowed to pass quickly; no artificial delays make them look more substantial. Concurrent requests own separate scopes. Late callbacks after a scope closes are ignored. Finishing one operation cannot clear another. The projection retains no conversation text, tool inputs, media, secrets or memory content; it is not persisted.

## Exact changes

Added:

- `src/domain/presence.ts`: typed presentation event/state vocabulary and transparent priority selection.
- `src/services/presence-telemetry.ts`: request-scoped AsyncLocalStorage observer; subscriber errors cannot affect execution.
- `src/server/presence-stream.ts`: opt-in action response envelope carrying telemetry and the unchanged final JSON result/error.
- `src/components/presence/{store.ts,appearance.ts,ary-object.tsx,renderer.ts,shader.ts,presence.module.css}`: independent request scopes, deterministic state appearance, accessible object, lazy GPU renderer and static SVG fallback.
- `tests/{presence.test.ts,presence-renderer.test.ts}`: 16 new behavior/lifecycle cases.
- `scripts/evaluate-presence-gpu.ts`: actual GPU compilation/render/readback across all 14 states.
- This report and `docs/evidence/ary-presence/` captures.

Extended:

- `src/services/ary-brain-service.ts`: optional non-authoritative phase callback at existing service operation boundaries; additive Brain event variant.
- `src/services/action-service.ts`: observed execution/failure/approval and post-transaction completion. Existing validation, policies, callbacks, audit, rollback and replay logic preserved.
- `src/server/http.ts`: opt-in stream at existing `actions/request`; old JSON callers remain supported. Existing Brain transport forwards precise phases and nested tool telemetry. No new route.
- `src/components/api.ts`: negotiates/unpacks the action envelope back into the existing Response interface. Existing approval retry behavior preserved. Settled action/review invalidates the existing pending-count projection.
- `src/components/dashboard.tsx`: owns conversation presence scope, consumes real phases, handles completion/cancellation/error, places the larger object above messages.
- `src/components/board/board-view.tsx`: projects existing stage/role/completion events; clears scope on stop/error.
- `src/components/approval-dialog.tsx`: exposes the persisted pending action as presence; clears it when the prompt leaves. Approval decisions unchanged.
- `src/components/nexus/primitives.tsx`: preserves AryPresence import/API through the reusable new object.
- `src/components/nexus/nexus-shell.tsx`: pending-count presentation and invalidation event; compact object stays in reserved footer space.
- `src/components/voice/{voice-presence.tsx,voice-controls.tsx,voice-state.ts}`: reusable large presence; optional `showPresence` avoids rendering a second large object under the composer; generic in-flight labels stop claiming retrieval/extraction before backend evidence.
- `scripts/evaluate-nexus-shell.ts`: real Brain/approval presence observation; focused, reduced-motion and WebGPU options for the existing disposable test harness.
- `ARY_NEXUS_ROADMAP.md`, `README.md`: milestone/evidence links. Existing NEXT ordering unchanged.

## Performance and accessibility

GPU code is imported only for the large object, with WebGPU available, motion allowed, and more than two logical cores. The compact object never allocates a GPU context. The buffer is capped at 153,600 pixels independently of screen DPR. Active drawing is limited to 24 fps; shape transitions settle within a bounded interval. Idle/approval/error/completion have no continuous render loop. Hidden/offscreen rendering pauses. Abort, unmount, failed compilation, device loss and sustained missed frames release resources and expose the static shape. Reduced motion and forced colors disable GPU animation. Text labels and shape differences carry state without relying on motion/color. No camera/microphone is activated by rendering.

## Verification

- **928 tests / 60 files passed**, including the existing 912 tests plus 16 new presence cases.
- Typecheck, repository formatting check and production build passed with the final source and unchanged lockfile dependencies in `/tmp/ary-shell-dependencies`. This isolated dependency directory avoids the checkout’s previously documented iCloud/dataless-module errors; no production environment files were copied.
- Native **Metal GPU** compilation, rendering and pixel readback passed for all **14** states. Initial sandbox-only run could not access an adapter; the authorized native run succeeded.
- Focused browser → HTTP → local repository flow passed with **WebGPU active**, **GPU disabled/static fallback**, and **reduced motion/static fallback**. It sent a real conversation through the development provider, observed server-driven presence, requested a real internal task, verified approval before creation, approved it, navigated to the resulting task, and checked action/outcome/consumed-approval linkage. No browser errors in these successful runs.
- GPU browser capture: [idle field](evidence/ary-presence/idle-webgpu.png). Other captures: [conversation receipt](evidence/ary-presence/conversation-complete.png), [approval queue](evidence/ary-presence/approval.png).
- A broader legacy shell/orbit run timed out in the browser automation client after reaching approval. It is **not counted as a pass**; its mode screenshot comparison also differed with long conversation/scroll/focus state. The isolated presence/action flow passed independently. These captures are visual inspection evidence, not a zero-difference regression guarantee.
- Disposable accounts were not needed; all browser fixtures used isolated LocalRepository data, were deleted by the harness, and no external effects or real model calls were performed.

Commands (from a healthy dependency checkout):

```sh
npm test
npm run typecheck
npm run format:check
npm run build
node --import tsx scripts/evaluate-presence-gpu.ts
ARY_PRESENCE_ONLY=1 node --import tsx scripts/evaluate-nexus-shell.ts
ARY_PRESENCE_ONLY=1 ARY_PRESENCE_REDUCED=1 node --import tsx scripts/evaluate-nexus-shell.ts
ARY_PRESENCE_ONLY=1 ARY_PRESENCE_GPU=1 node --import tsx scripts/evaluate-nexus-shell.ts
```

## Limits and manual check

This is live request telemetry, not an account-wide durable event subscription. Operations started in another browser, detached workers or a closed stream do not invent ongoing animation. The existing pending queue remains polled/refreshed; mission-step verification remains in the execution plan, not inferred from the presence. Physical microphone/TTS acceptance and installed Electron performance were not repeated. Existing native/provider gates remain open. The graph, schemas, stored facts, providers, action authority and external integrations were intentionally untouched.

Manual check: open ARY, ask about a known project, inspect the retrieved count and processing labels, use the microphone to see real input response, interrupt playback, request a task and inspect its approval, then approve and confirm the task in Action History. Start a Board Meeting to see actual advisory stages. Enable OS reduced motion and confirm the same readable states remain without animation.

Stop at this milestone; no subsequent integration or graph overhaul has been started.
