# Local Hey Ary wake boundary

Status: **PARTIAL — WAKE_MODEL_OWNER_SETUP_REQUIRED; ENGINE_PACKAGING_REQUIRED.** No production acoustic recognition or physical wake acceptance is claimed.

Selected: openWakeWord's three-stage ONNX pipeline. Its source is Apache-2.0, but bundled pretrained wake models are CC-BY-NC-SA; a custom Hey Ary model with appropriate licensing is required. Porcupine was evaluated but requires a vendor AccessKey/custom keyword generation. Neither vendor key nor a questionable pretrained model was silently introduced. [openWakeWord source/model licenses](https://github.com/dscripka/openWakeWord/blob/main/README.md), [Porcupine Web setup](https://github.com/Picovoice/porcupine/blob/master/binding/web/README.md).

The real inference factory is intentionally absent until its model/frontend contract can be validated. The production boundary fails before acquiring the microphone when no engine factory exists. There is no energy threshold, speech recognizer or development-stub substitute for the acoustic engine. No runtime dependency was added without usable models.

Exact assets: `public/models/ary-wake/manifest.json`; version 1, engine `openwakeword-onnx`, phrase `HEY_ARY`, model_version, license, and exactly three assets (`melspectrogram.onnx`, `embedding_model.onnx`, `hey_ary.onnx`), each with a lowercase SHA-256 hash. Loader accepts only these same-origin filenames, bounds each model to 32 MB, checks hashes and never loads executable code from a manifest. The packaged factory must implement the official feature extraction and classifier semantics through `WakeEngineFactory`; synthetic tests inject deterministic inference only.

`ARY_WAKE_WORD_ENABLED=false` is the default. Enabling a flag alone does not install the model/runtime. `/mic-test` has a local asset-check/setup panel; checking files never opens a microphone. A real wake-test control remains unavailable until the runtime is packaged and validated.

Existing WakeWordService/VoiceActivationService remain authoritative. WakeWordService's unused optional repository constructor argument was replaced with an optional normalized event recorder callback so the same lifecycle can run in a browser without importing server crypto/storage. Server composition can inject existing NexusEventBus.record; no second event store was created. Failure events are now explicit and detections are ignored while paused/stopped.

The local provider reuses BrowserAudioCaptureProvider and the sole microphoneLease. Pause stops capture and releases ownership; resume reacquires. It feeds 16 kHz / 1,280-sample blocks to the local engine, with a bounded in-flight inference operation, 1.5-second startup suppression, 0.8 provisional confidence threshold, cooldown and fail-closed errors. That provisional threshold is not calibrated owner performance. Playback suppression is applied by the existing WakeWordService. No sleeping microphone audio is sent to a server/cloud or persisted.

Owner gate: install/validate licensed custom assets and package the inference factory, then explicitly enable wake and test false positives, misses, background behavior and mic handoff. Idle CPU/memory and physical accuracy remain unmeasured without the real engine.
