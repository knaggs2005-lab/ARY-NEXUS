# Hand tracking improvement pass — 2026-09-07

## Audit findings

- `desktop/security.cjs` explicitly accepted audio only, so the installed app rejected video capture. `desktop/main.cjs` always asked macOS for microphone access, even for camera requests.
- The installed launcher loads the desktop source from this repository on launch. Its existing Info.plist already has a camera usage description. The installed app was quit/reopened through its normal lifecycle to load the corrected policy; no saved session, database, or existing web server was removed.
- Tracking used CPU inference, waited an additional full frame interval after inference, restarted capture when quality changed, and did not skip duplicate video frames.
- Pinch and depth navigation accepted single-frame changes. Cursor position was an unsmoothed palm centroid. Missing a target selected the previously focused module. No-hand results still displayed a centered cursor.

## Changes

- `desktop/security.cjs`: allow known audio/video requests only at Ary's exact origin; route requested devices individually to native permission requests. Unknown/unrelated permissions remain denied.
- `desktop/main.cjs`: retain the own-window boundary and ask for camera versus microphone appropriately.
- `desktop/build.mjs`: explicit local-processing camera description for future packaged builds.
- `src/components/spatial/hand-worker.ts`: GPU inference, CPU fallback on startup errors or lost contexts; explicit CPU initialization for recovery; conservative single-hand detection with 0.5 thresholds.
- `src/components/spatial/hand-tracking.ts`: one in-flight frame, cadence adjusted for inference duration, duplicate frame suppression, rate changes without camera restarts, more useful errors, frozen-frame/capture deadlines, and one bounded CPU worker replacement if GPU startup/inference stalls. Old worker results are discarded.
- `src/components/spatial/gesture-engine.ts`: time-based fingertip smoothing, reachable screen edges, pinch/release hysteresis plus dwell, stable depth-gesture dwell, immediate release and cursor removal on tracking loss.
- `src/components/spatial/use-gestures.ts`: persistent session across rate changes, fingertip hit-testing, harmless misses, target feedback, navigation-only dispatch; no gestures can click approvals or execute actions.
- `src/components/spatial/spatial-shell.tsx` and `spatial.module.css`: target/pinch cursor states, tracking guide and Stop camera control.
- `src/components/spatial/performance.ts`: requested tracking rates 24/20/12, still limited by actual inference time.
- `tests/desktop.test.ts`, `tests/spatial-tracking.test.ts`, `tests/spatial-gestures.test.ts`, new `tests/hand-worker.test.ts`: permission/device mapping, deny cases, smoothing/debounce, GPU/CPU recovery, cleanup, stale results and backpressure.
- New `scripts/evaluate-desktop-tracking.cjs`; `package.json` adds `test:desktop-tracking`. README updated.

No memory, entities, retrieval, providers, business actions, approvals, graph/vgpu, schemas or external integration changes. No dependency changes. Four identical duplicate generated `.next/types/* 2.ts` files were removed after they caused duplicate-type errors; their originals were retained.

## Verification

- Final regression: **457 tests passed across 34 files**. Typecheck, formatting and production build passed.

- Existing browser integration test ran the real local MediaPipe model with a synthetic camera, verified camera/worker cleanup and preserved mouse/keyboard/classic navigation. Final run: 5 observed frames, mean inference 44 ms, 60 FPS spatial motion, no browser errors.
- Isolated Electron 44.2.0 test: video request accepted through the desktop policy and routed to `camera`; 17 real inference frames; GPU selected; 18 ms mean including warm-up and 9 ms average across the final eight frames. Exactly one worker created/terminated and camera tracks ended after disabling.
- Earlier GPU runs stalled; timeout recovery was added and covered by deterministic tests. GPU errors retry on CPU; an unresponsive GPU worker is replaced once on the same camera session. An unresponsive CPU worker fails closed and releases capture.
- The synthetic video contains no real hand. These checks prove capture, model operation, permission routing and cleanup, not physical-hand accuracy or universal frame rates.
- Real installed-app camera prompt and hands-on gesture validation remain pending because macOS was locked. No real webcam recording was made or user privacy setting bypassed.

## Manual check when unlocked

1. In Ary Nexus, return to orbit → View controls → Enable hand tracking. Allow the camera prompt if presented.
2. Show one hand in good light. The cursor should appear when detected and disappear when your hand leaves view.
3. Aim your index finger at a module. Confirm the guide names the intended target; hold a thumb/index pinch to select. Pinching empty space must do nothing.
4. Keep pinching and bring the hand closer to open the selected module. Release normally; open-palm swipes rotate the orbit. These remain heuristics, not measured depth.
5. Stop camera. The macOS camera indicator should turn off. Change effect quality and confirm an active camera does not restart.
6. Report whether the remaining problem is detection, cursor drift, accidental selection, or opening a module so the next calibration pass targets the right issue.

Native permission behavior follows [Electron's systemPreferences API](https://github.com/electron/electron/blob/main/docs/api/system-preferences.md) and [session permission APIs](https://github.com/electron/electron/blob/main/docs/api/session.md). Local detector integration uses the installed MediaPipe API declarations; worker inference follows [Google's Hand Landmarker guidance](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker/web_js).
