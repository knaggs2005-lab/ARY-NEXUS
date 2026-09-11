# livekit-agents: Streaming speech and interruption

Reference source: [livekit-agents-main](/Users/austin/Downloads/livekit-agents-main/). Upstream: [agents](https://github.com/livekit/agents).

Observed package: `livekit-agents` · snapshot version `0.7.1` · root license `Apache-2.0`. Version evidence: `livekit-agents/livekit/agents/version.py`. These are local snapshot values, not recommended installation pins.

## Relevant source files

- [livekit-agents/livekit/agents/stt/stt.py](/Users/austin/Downloads/livekit-agents-main/livekit-agents/livekit/agents/stt/stt.py)
- [livekit-agents/livekit/agents/tts/tts.py](/Users/austin/Downloads/livekit-agents-main/livekit-agents/livekit/agents/tts/tts.py)
- [livekit-agents/livekit/agents/voice_assistant/assistant.py](/Users/austin/Downloads/livekit-agents-main/livekit-agents/livekit/agents/voice_assistant/assistant.py)
- [README.md](/Users/austin/Downloads/livekit-agents-main/README.md)

## Ary boundary and adoption decision

The supplied snapshot reports **0.7.1** in `version.py`; its README labels the SDK a developer preview. These are properties of this download, not a claim about the current LiveKit release. It uses `VoiceAssistant`; do not assume modern session APIs exist in this snapshot.

Relevant components: STT start/interim/final/end events; streaming synthesis with segment boundaries; stream closure; speech interruption and lifecycle callbacks. These address the concrete gap between Ary's current recorded-blob STT/TTS ports and future bidirectional low-latency audio.

Ary ownership: `src/domain/voice.ts`, `VoiceService`, and `src/components/voice/use-ary-voice.ts`. A future transport/session adapter may add streaming event interfaces alongside the existing provider ports. Final accepted transcripts enter Ary Brain with the same conversation identity; interim text must not become durable facts. Interrupted assistant speech must not be recorded as fully delivered. Transcript retries need stable message IDs so memory extraction runs once.

Decision: pattern reference now. Evaluate a maintained LiveKit Agents package only when WebRTC sessions, barge-in, and stream lifecycle requirements justify a separate worker and signaling/media infrastructure. That would be a deliberate voice transport addition, not an in-process Next.js import of this Python repository. The transport must not bypass Ary's Brain, permissions, provider telemetry, or ROI accounting, and must not introduce a second reasoning/memory loop.

Acceptance: time to first transcript/audio, cancellation that actually stops generation/playback, no stale audio after interruption, reconnect without duplicate turns, final-only extraction, and separate model-versus-transport cost coverage. Do not invent pricing for media infrastructure.

Current architecture documentation checked separately from the old snapshot: [LiveKit Agents introduction](https://docs.livekit.io/agents/). No credentials, workers, rooms, wake words, or voice integrations are added by this catalog.
