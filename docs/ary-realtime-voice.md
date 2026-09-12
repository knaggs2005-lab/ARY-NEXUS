# Ary realtime voice — overnight checkpoints

Starting commit: `2bd942c470bb5a98368b031de97f20e7e61cdee9`. Scope is the existing voice stack only. No unattended physical microphone, camera, speaker use or owner biometric enrollment.

## Baseline acceptance

Owner-reported physical input acceptance (supplied September 12): 439 frames captured and forwarded, 421,440 bytes, 30 batches, 24,000 Hz mono PCM16 with 960-byte frames, speech_start/speech_end both true, no provider/client failure, relay CLOSED and cleanup confirmed. This supersedes the earlier pending input gate. It is owner-supplied evidence, not a new unattended hardware test.

## Stage 2F — playback

IMPLEMENTED / SYNTHETICALLY VERIFIED / LIVE PROVIDER OUTPUT VERIFIED. OWNER_PLAYBACK_ACCEPTANCE_PENDING.

The existing authenticated, same-origin development relay now exposes one POST NDJSON output subscriber. Audio is ephemeral base64 on that stream only, never database/audit/memory content. Its 96 KB queued-byte bound fails the relay if a client cannot keep up; disconnect closes the original provider session. No new OpenAI connection. Status metadata remains audio-free.

Current `response.output_audio.delta` events carry base64 in `delta`. The adapter only emits canonical PCM after accepted session metadata confirms `audio/pcm` at 24,000 Hz. Assistant transcript events cannot enter the owner-transcript branch. Nested response usage is recognized. Realtime voice inherits `OPENAI_REALTIME_VOICE`, then existing `OPENAI_TTS_VOICE`, then Ary's existing `marin` default. Classic configuration is unchanged.

A dedicated output AudioContext uses the system output rate. Each source buffer is correctly tagged 24 kHz for browser resampling; it never shares the microphone context. Ordered scheduling has a 1,000 ms queued-audio cap and reports chunk/byte counts, underruns, queued duration and first scheduled-audio latency. Oversized/faster-than-playback bursts fail visibly; sustained natural speech and device latency remain physical gates. No output device was opened during tests.

Validation: 1,640 tests / 100 files passed, typecheck and isolated production build passed. A bounded live output request returned 5 chunks / 86,400 bytes, verified PCM16 mono 24 kHz, first chunk at 640 ms. This measures provider reception, not audible latency or physical playback. The `/mic-test` button START VOICE WITH PLAYBACK requires an owner gesture and discloses microphone upload and speakers.

Protocol references: [OpenAI client events](https://platform.openai.com/docs/api-reference/realtime-client-events/conversation/item/create), [OpenAI server events](https://platform.openai.com/docs/api-reference/realtime-server-events/input_audio_buffer/committed). Only current non-beta event names are used for new output handling.

## Stage 2G — barge-in

IMPLEMENTED / SYNTHETICALLY VERIFIED; OWNER_BARGE_IN_ACCEPTANCE_PENDING. Each new provider speech-start turn requests canonical BOTH interruption on the existing session. Active response IDs fence cancellation and reject late audio/completion events from cancelled responses; duplicate speech IDs are bounded and suppressed. Cancellation preserves `cancel_external_effect: false`. The output client immediately clears its scheduled PCM on the interruption event; capture remains active. Browser capture requests echoCancellation and noiseSuppression. This uses OS/browser processing, not a claim of perfect acoustic echo rejection. Loud speakers, room echo and device permission behavior require owner tests. Wake suppression is wired with the unified runtime in the later stage.

Focused interruption/output/capture tests passed. Full regression: 1,641 tests / 100 files; typecheck and isolated build passed. No physical audio devices or extra paid provider diagnostics used in this stage.

## Stage 2H — local wake boundary

PARTIAL / SYNTHETIC LIFECYCLE VERIFIED / WAKE_MODEL_OWNER_SETUP_REQUIRED. Selected openWakeWord-compatible local ONNX boundary; custom Hey Ary model and tested engine packaging are missing. Exact asset/hash loading, shared-mic release/reacquire, startup/cooldown/playback suppression, engine failures and disabled-default configuration are implemented. No model was fabricated or installed under unsuitable licensing. The setup panel is explicit about the missing inference factory. No acoustic accuracy or idle resource claim. See [wake setup](wake-word.md).
