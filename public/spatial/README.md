# Local hand-tracking assets

These files support optional, on-device hand navigation. No camera frames are
uploaded. Runtime asset URLs are on the same origin as Ary Nexus.

Run `npm run spatial:assets` after `npm ci` to prepare this directory. It copies
WASM/JavaScript variants from the pinned `@mediapipe/tasks-vision` package and
fetches the official hand-landmarker float16 model v1 only if missing. The model
checksum is verified on every run. `manifest.json` records the source, package
version and checksum. An invalid existing model is rejected; remove only that
invalid model and rerun to recover. Approximately 41 MB are deployed; a browser
loads the needed WASM variant and model only after tracking is enabled.

MediaPipe Tasks Vision 1.0.1 declares Apache-2.0 in its package metadata.
`LICENSE.mediapipe.txt` contains the upstream license and bundled notices.
Upstream: https://github.com/google-ai-edge/mediapipe
Guide: https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker/web_js
Model source: https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task

These are reusable runtime assets, not an imported MediaPipe application. Do not
remove notices when distributing the assets. No API key is needed.
