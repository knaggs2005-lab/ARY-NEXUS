# Local wake word

Wake detection is a provider-agnostic local boundary. It never sends microphone audio to OpenAI, persists raw audio, or requires credentials. It is disabled by default with `ARY_WAKE_WORD_ENABLED=false`.

The current development provider establishes lifecycle and privacy contracts; it does not claim production acoustic recognition. Supported canonical phrases are **Ary**, **Hey Ary**, and **Nexus**. A future packaged local engine (evaluated separately) can implement the same interface without changing Brain or realtime transport.

`WakeWordService` owns start, stop, pause, resume, cooldown/debounce, playback suppression, bounded events, and microphone failure reporting. It must pause while an active voice session owns the microphone and resume afterward; realtime integration is intentionally deferred to Stage 2D. Events are `wake.listener.*` and `wake.detected` and contain no audio.

For device acceptance, use a dedicated local harness once a real engine is selected. Standard tests use deterministic fake providers and never require microphone hardware.
