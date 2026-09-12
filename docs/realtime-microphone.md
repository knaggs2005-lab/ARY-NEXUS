# Realtime microphone capture (Stage 2E-A)

Capture contracts and pure conversion utilities are local-only. Canonical frames are mono PCM16 at 24 kHz. Frames use a bounded 20 ms duration (480 samples). Float32 samples are clamped, NaN becomes silence, and linear interpolation performs deterministic sample-rate conversion. Audio remains in memory and is never logged, persisted, audited, or sent over the network in this stage.

Lifecycle supports capturing, pause/resume, and idempotent stop. Browser/Electron wiring and realtime forwarding remain disconnected for Stage 2E-B.

The concrete `BrowserAudioCaptureProvider` now acquires the existing microphone lease, requests a mono 24 kHz `AudioContext`, verifies the actual context rate, packetizes worklet blocks into exact 480-sample/960-byte little-endian frames, and releases tracks, nodes, context, and lease on pause/stop/failure. Physical microphone acceptance is not run automatically; `npm run test:mic-live` reports `SKIPPED` in Node because it cannot prove browser hardware capture.

## Stage 2E-A.1 lifecycle correction

Capture now uses one internally owned abort lifetime and one idempotent cleanup path. Caller cancellation, setup failure, unsupported sample rate, unexpected track end, and explicit stop all release the lease and tracks, discard buffered audio, detach listeners, and prevent late callbacks from emitting or restoring capture. `PAUSED` suppresses and discards frames while the microphone remains acquired (`microphone_active: true`); terminal states report it as inactive.
