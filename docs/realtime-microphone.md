# Realtime microphone capture and acceptance

Capture contracts and pure conversion utilities are local-only. Canonical frames are mono PCM16 at 24 kHz. Frames use a bounded 20 ms duration (480 samples). Float32 samples are clamped, NaN becomes silence, and linear interpolation performs deterministic sample-rate conversion. The standalone local capture test keeps audio on the device and never logs or persists samples. The separate explicitly started Realtime test sends PCM through the authenticated server relay to OpenAI.

Lifecycle supports capturing, pause/resume, and idempotent stop. Browser/Electron capture and bounded Realtime forwarding are now connected; see [current voice architecture and acceptance](ary-realtime-voice.md).

The concrete `BrowserAudioCaptureProvider` acquires the existing microphone lease and requests a mono 24 kHz `AudioContext`. Once `getUserMedia` returns a live stream, `microphone_active` is true while capture setup completes and remains true in `CAPTURING` and `PAUSED`. The provider verifies the actual context rate and packetizes worklet blocks into exact 480-sample/960-byte little-endian frames. Physical microphone acceptance is not run automatically; `npm run test:mic-live` reports `SKIPPED` in Node because it cannot prove browser hardware capture.

The live browser path does not use the standalone linear-interpolation helper for sample-rate conversion. It requests a 24 kHz `AudioContext` and fails truthfully if the actual context reports another rate.

## Stage 2E-A.1 lifecycle correction

Capture now uses one internally owned abort lifetime and one idempotent cleanup path. `PAUSED` keeps the microphone acquired, stops frame emission, and discards any buffered partial frame. `STOPPED` and `FAILED` stop tracks, clean up the AudioWorklet/audio context, release the lease, discard buffered audio, detach listeners, and set `microphone_active: false`. Caller cancellation, setup failure, unsupported sample rate, unexpected track end, and explicit stop all use that same cleanup path and prevent late callbacks from emitting or restoring capture.

## Physical acceptance harness

Open `http://127.0.0.1:3000/mic-test` in the desktop/browser app. Click **START MIC TEST** explicitly, speak briefly, then click **STOP MIC TEST**. The page displays only state and bounded frame metadata (never samples or frame bytes). A passing run requires `CAPTURING`, 24,000 Hz, mono, at least one 960-byte frame, then `STOPPED` with `microphone_active: false` and no later frame count increase.

## Current input evidence and cloud boundary

The owner reported real input PASS at the starting checkpoint: 439 captured and
forwarded frames, 421,440 bytes, 30 batches, 24 kHz mono, 960-byte frames, both VAD
flags, no failures, CLOSED and cleanup confirmed. No physical test was rerun overnight.

`START MIC TEST` remains LOCAL ONLY. `START REALTIME MIC TEST` sends owner microphone
PCM to OpenAI, with no Brain or speaker output. `START ARY BRAIN VOICE + PLAYBACK`
additionally routes final transcripts through the existing Brain/memory and renders
canonical replies through a dedicated output AudioContext. These are distinct,
explicit Start interactions. No biometric enrollment occurs in these controls.

Input batches are 15 frames / 300 ms, with a 30-frame / 600 ms total client cap including
the request in flight. Delivery is ordered, single-flight and never silently retried.
Stop flushes complete pending frames where the relay is still available. A confirmed
server end discards unsent closing audio and releases capture. Failures are visible.
The normal development/native Node process retains `WS_NO_BUFFER_UTIL=1`.

`/mic-test` is development-only; an isolated production HTTP check returned 404.
Classic Chat voice is unchanged. For morning playback/barge-in/memory tests and the
remaining wake/model/enrollment gates, follow [the acceptance package](ary-realtime-voice.md#morning-owner-acceptance).
