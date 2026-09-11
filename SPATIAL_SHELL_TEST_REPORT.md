# Ary Nexus Spatial Shell — implementation and verification

Date: September 7, 2026. Scope: the spatial navigation shell only.

## Audit before implementation

The repository already had a working Next.js Dashboard, authenticated Supabase
storage, Brain/retrieval/memory services, entity aliases and temporal facts,
provider interfaces, task/project models, permissions, approvals, action history,
transactional internal tools, tests, voice components, and an Electron wrapper.
The current premium Brain Graph uses its existing Canvas2D interaction renderer
plus the vgpu effects layer. Despite earlier references to xyflow in the task
history, the installed application does not have an xyflow dependency. Neither
renderer nor graph model was replaced.

The audit found no orbital shell or hand-navigation engine. Before editing, the
plan identified the page/Dashboard bridge, new modular spatial directory, one
MediaPipe dependency, tests and local asset preparation. No replacement services,
APIs, tables, repositories or provider integrations were needed.

All files were already untracked in the supplied repository; this inventory is
milestone-specific, not a claim that every untracked file was created here.

## Reuse and compatibility

One existing Dashboard instance remains mounted behind the shell. It retains its
conversation state and publishes a small summary of its already-fetched data.
Its memoized bridge isolates existing views from frequent landmark/HUD renders.
Opening a module requests an existing Dashboard tab. Hiding the workspace calls
existing response/capture cleanup methods so an invisible workspace does not keep
speaking or recording. No voice implementation or provider was extended.

Home → Chat, Brain → Graph, Projects → Entities/project cards, Tasks → Activity's
task view, Activity → Action History, System → Settings, Finance → existing ROI.
Calendar, Communications and Agents are unavailable placeholders. Approvals remain
in the current workspace navigation, with the same permission checks and forms.
The shell does not execute actions. Original workspace themes are deliberately
retained for readability; the shell supplies the spatial frame around them.

The summary displays actual open-task/project/memory/entity counts. Action counts
are labeled recent because the existing endpoint returns at most 30 records.
Recorded blocked project status drives warnings. No pending-approval count is
inferred from old action status records.

## Added behavior

- Ten deterministic orbital cards; front-card hierarchy and inaccessible rear
  cards removed from keyboard interaction until rotated forward. All ten remain
  reachable through shortcuts and the 2D mode.
- Idle, hover, selected, focused, expanded, dragging, warning and unavailable
  states; named spring vocabulary; bounded dragging and exact settling.
- Shared frame loop synchronizes orbit, focus depth, approach and light. Input
  retargets springs immediately. Revision checks prevent stale completion from
  reopening a dismissed workspace. No permanent animation loop after settling.
- CSS 3D depth, soft haze/light beams, restrained dust and focus lighting. These
  are compositor effects, not a new WebGL renderer or true volumetric simulation.
- Hideable HUD, measured frame cadence/p95, clock/date, tracking status and local
  navigation log. On small screens diagnostics stay in View controls.
- Adaptive/manual quality, particle limits, reduced motion, native 2D and classic
  workspace, plus an error boundary falling back to the existing Dashboard.
- Optional worker-based MediaPipe hand tracking with local assets, no audio and
  one in-flight frame. Tracks/worker/video/timers are released on stop, failure,
  tab hide, Classic or unmount; late permission grants and frames are discarded.
- Navigation gestures: swipes, pinch/release, palm-size pull/push, steady palm;
  open/closed-hand states and fingertips. Circle is reserved. Gestures have no
  access to tool execution, approval decisions, API requests or business writes.

Native CSS and shared springs were sufficient. No Three.js, R3F, physics engine,
GSAP, Rive, global store, second chat engine or external service was added.

## Exact files modified

| Existing file                  | Necessary change                                                                    |
| ------------------------------ | ----------------------------------------------------------------------------------- |
| `src/app/page.tsx`             | Mount spatial shell at the existing entry point.                                    |
| `src/components/dashboard.tsx` | Optional summary/navigation/visibility bridge; retains standalone interface.        |
| `package.json`                 | Pin MediaPipe dependency; add asset and isolated browser-test commands.             |
| `package-lock.json`            | Lock the dependency.                                                                |
| `README.md`                    | Setup, module mappings, controls, fallback, privacy and verification documentation. |

## Exact files added

All paths below are relative to `ary-nexus/`.

| File                                                   | Responsibility                                                         |
| ------------------------------------------------------ | ---------------------------------------------------------------------- |
| `src/components/spatial/spatial-shell.tsx`             | Compose shell and existing Dashboard; navigation and focus completion. |
| `src/components/spatial/spatial-scene.tsx`             | Modular spatial scene composition.                                     |
| `src/components/spatial/module-orbit.tsx`              | Module orbit/card composition.                                         |
| `src/components/spatial/module-card.tsx`               | Accessible cards and bounded pointer interactions.                     |
| `src/components/spatial/modules.ts`                    | Existing module destinations and summary bridge types.                 |
| `src/components/spatial/camera.ts`                     | Pure orbit/focus pose calculations.                                    |
| `src/components/spatial/use-camera-system.ts`          | One master spring loop, metrics and resize lifecycle.                  |
| `src/components/spatial/motion.ts`                     | Named curves, stable springs, nearest orbit and settling.              |
| `src/components/spatial/interaction-state.ts`          | Spatial-only reducer and card states.                                  |
| `src/components/spatial/postprocessing.tsx`            | Inexpensive CSS atmospheric cues.                                      |
| `src/components/spatial/performance.ts`                | Capability checks, quality tiers and measured cadence.                 |
| `src/components/spatial/performance-controls.tsx`      | Fallback, quality, tracking and motion controls.                       |
| `src/components/spatial/hud.tsx`                       | Minimal system/navigation HUD.                                         |
| `src/components/spatial/fallback-ui.tsx`               | Error boundary restoring the original workspace.                       |
| `src/components/spatial/gesture-engine.ts`             | Deterministic landmark-to-gesture heuristics.                          |
| `src/components/spatial/hand-tracking.ts`              | Camera/frame/worker ownership and recovery.                            |
| `src/components/spatial/hand-worker.ts`                | Lazy MediaPipe model initialization and inference.                     |
| `src/components/spatial/use-gestures.ts`               | Gesture-to-spatial-event adapter and tab lifecycle.                    |
| `src/components/spatial/spatial.module.css`            | Scoped spatial design and compatibility frame.                         |
| `scripts/prepare-spatial-assets.mjs`                   | Local WASM copy and checksum-verified model preparation.               |
| `scripts/evaluate-spatial.mjs`                         | Isolated browser test using a synthetic camera.                        |
| `tests/spatial-state.test.ts`                          | Orbit, card state, interruption, springs and quality tests.            |
| `tests/spatial-gestures.test.ts`                       | Gesture recognition, hysteresis, cooldown and invalid inputs.          |
| `tests/spatial-tracking.test.ts`                       | Camera/worker shutdown, late grants/frames, denial and timeouts.       |
| `public/spatial/hand_landmarker.task`                  | Official float16 v1 model asset.                                       |
| `public/spatial/manifest.json`                         | Model provenance, checksum and runtime version.                        |
| `public/spatial/wasm/vision_wasm_internal.js`          | Official reusable runtime asset.                                       |
| `public/spatial/wasm/vision_wasm_internal.wasm`        | Official reusable runtime asset.                                       |
| `public/spatial/wasm/vision_wasm_module_internal.js`   | Official reusable runtime asset.                                       |
| `public/spatial/wasm/vision_wasm_module_internal.wasm` | Official reusable runtime asset.                                       |
| `public/spatial/wasm/vision_wasm_nosimd_internal.js`   | Official reusable runtime asset.                                       |
| `public/spatial/wasm/vision_wasm_nosimd_internal.wasm` | Official reusable runtime asset.                                       |
| `public/spatial/LICENSE.mediapipe.txt`                 | Upstream runtime license/notices.                                      |
| `public/spatial/README.md`                             | Asset setup, sources and distribution notes.                           |
| `SPATIAL_SHELL_TEST_REPORT.md`                         | This audit and verification report.                                    |

## Dependency and asset preparation

Only new package: `@mediapipe/tasks-vision@1.0.1`, pinned exactly. The package is
loaded through a worker only when tracking is enabled. `npm run spatial:assets`
prepares approximately 41 MB of local assets; only the browser's needed runtime
variant is loaded. Re-running the command retains and verifies the existing model.
No camera data is uploaded. Existing npm audit reported zero vulnerabilities at
installation; this is not a full dependency security audit.

The implementation follows the official [MediaPipe web guide](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker/web_js),
including moving synchronous inference off the main UI thread. Local model
provenance and the SHA-256 are in the manifest; upstream licensing is preserved.

## Verification results

| Check                         | Result                                                                                                              |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Full automated test suite     | **388 passed**, 29 test files; 361 existing tests plus 27 spatial tests.                                            |
| New state tests               | 14 passed, including named springs, bounded drag, interruption and exact settling.                                  |
| Gesture tests                 | 7 passed, including pinch hysteresis, both swipes, cooldown, pull/push, steady/invalid hands.                       |
| Tracking lifecycle tests      | 6 passed, including permission denial, startup/frame timeouts, late grants and stale frames.                        |
| Typecheck                     | `npm run typecheck` passed.                                                                                         |
| Formatting                    | `npm run format:check` passed; no separate lint command is configured.                                              |
| Production build              | `npm run build` passed, including worker compilation.                                                               |
| Dev browser smoke test        | 9 assertions passed; no browser errors.                                                                             |
| Production browser smoke test | 9 assertions passed against isolated port 3197; no browser errors.                                                  |
| Actual MediaPipe inference    | Local model initialized and processed synthetic-camera frames in both builds.                                       |
| Actual camera cleanup         | Instrumented synthetic tracks all ended; all created workers terminated after Disable.                              |
| Mouse navigation              | Rotate selects Brain; all modules accessible in 2D.                                                                 |
| Focus interruption            | Mid-sequence Escape leaves workspace closed and scene settled.                                                      |
| OS reduced motion             | Browser-emulated preference respected; 2D transforms absent.                                                        |
| Existing authenticated views  | Opened Brain and Projects through the shell; live graph GPU indicator active, project records/task rollups visible. |
| Asset rerun                   | Local model checksum verified without downloading a replacement.                                                    |

The browser smoke script is unauthenticated and makes no business writes. Existing
service behavior is covered by the retained automated suite; this milestone did
not rerun paid OpenAI calls or modify production records. The authenticated visual
checks used the user's existing app session only to view screens.

## Measured performance

On this machine, during one orbit rotation:

- Production Chromium, 1440 × 1000: **60 FPS**, **16.7 ms p95 frame interval**.
- Development headless Chromium: 53 FPS, 16.8 ms p95 in the recorded smoke run.
- Existing in-app browser on its high-refresh display: 120 FPS, 8.4 ms p95 in the
  recorded manual rotation.
- Production synthetic camera: six observed results, **27 ms mean model inference**.
  This excludes camera setup, model download/initialization, scheduling and user
  gesture dwell. It is not end-to-end hand latency.

These are requestAnimationFrame cadence samples, not a GPU profiler or broad
hardware benchmark. The idle transform sample remained unchanged over 400 ms and
the scene reported its loop settled. There is no promise of 60 FPS on all hardware.

DPR control is retained where it already exists: Brain Canvas2D caps at 2; vgpu
caps at 1.25 normally, 0.75 at low quality, plus a two-million-pixel budget. The new
CSS scene has no owned framebuffer, so its raster resolution is browser-managed;
no misleading shell DPR slider was added. Shell quality adjusts particles, haze
and requested tracking rate. It does not change the graph's existing controls.

## Fallback and known limitations

- Mouse/keyboard, 2D mode and Classic work without a camera or WebGPU. CSS 3D does
  not require a WebGL context. Lack of CSS perspective selects 2D automatically.
- Missing/denied camera, model failure or slow worker shuts tracking down with
  visible status; navigation remains available. Browser secure-context camera
  rules still apply (localhost or HTTPS).
- Physical-hand gestures were **not** tested on the user's actual camera. Lighting,
  hand orientation, disability accommodations, hand size and camera perspective
  need device validation and possibly calibrated thresholds.
- Pull/push use apparent palm scale; they are not depth-camera measurements.
  Confidence is heuristic. Steady-palm holding affects ambient state, while the
  already restrained scene settles at idle. Intentional focus is still usable.
- The scene is native CSS 3D, not immersive XR, true volumetric fog or 3D geometry.
  Unavailable modules are deliberate boundaries, not functioning integrations.
- Quality and HUD preferences are session-local. Reduced-motion honors OS choice.
  The module deck is fixed at ten cards, so this is not a large-card benchmark.
- Browser capability detection reports whether WebGPU is exposed, not whether
  every possible adapter/device request will succeed; the graph keeps its own
  established runtime fallback.
- No new database mutations or model calls were needed. No migration was added.

## Short manual test plan

1. On the shell, use arrows and module shortcuts. Drag a focused card and release;
   verify its slot is restored. Open a module then return. Press Escape during
   alignment and verify no late workspace opens.
2. Open Brain; search/select a real entity, pan and zoom, and verify the existing
   graph effects and inspector. Open Projects/Tasks and inspect current records.
3. Open System and Approvals using existing navigation. Verify requests still
   require their normal approval. Hand gestures must never activate those forms.
4. Enable reduced motion and 2D mode; navigate all modules with keyboard/mouse.
   Hide HUD, then use View controls diagnostics. Try Classic and Return to orbit.
5. If desired, enable the physical camera. Test swipe, pinch/release and gradual
   pull/push under good lighting. Disable and confirm the browser camera indicator
   turns off. Deny permission or hide the tab and confirm normal navigation remains.
6. Leave the scene alone: cards settle, FPS is a last-motion sample, and no endless
   floating/animation loop remains. Repeat on a lower-end device before release.

## Intentionally untouched and next milestone

Brain reasoning, persistent memory, extraction/reconciliation, aliases/entity
resolution, hybrid retrieval, temporal facts, graph/vgpu source, providers/OpenAI,
permissions, approvals, actions/audit/idempotency, real task/project tools, database
schemas/migrations, existing APIs/tests, voice, Electron and reference repositories
were not rebuilt or extended. No external tool or autonomous action was added.

Recommended next milestone: physical-hand calibration and device/accessibility
validation of this shell, including low-end/mobile performance. Stop here before
adding voice, external integrations or desktop control.
