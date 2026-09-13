# GPT-Live frontend (in progress)

Legacy baseline: `52e93ef`, preserved by `voice-legacy-baseline-52e93ef`.

## Verified contract, September 13, 2026

Official sources inspected before implementation:
- https://developers.openai.com/api/docs/guides/voice-webrtc?api=live
- https://developers.openai.com/api/docs/guides/live-conversations
- https://developers.openai.com/api/docs/guides/live-delegation
- https://developers.openai.com/api/docs/guides/voice-server-controls?api=live
- https://developers.openai.com/api/docs/guides/live-migration

The repository has no installed OpenAI SDK. Existing providers use fetch/ws; keep that pattern rather than adding a second SDK. Existing credential model-access check for `gpt-live-1`: HTTP 200. This does not prove session or microphone acceptance.

Use POST https://api.openai.com/v1/live/sessions with server Bearer authentication, session model gpt-live-1, client delegation, and transport `{type: "webrtc", sdp}`. Read JSON session.id and transport.sdp. Browser creates oai-events data channel BEFORE its offer, applies answer, then waits for session.started. No legacy session.update/start handshake. Media travels as WebRTC tracks.

Attach server ws to /v1/live/sessions/{opaque_id}/attach using the same project credential. Only this server owns delegation execution. Transcripts arrive as session.input_transcript.delta and session.output_transcript.delta (delta/start_ms/end_ms); these are fragments, NOT final turns. session.delegation.created contains metadata/id/offset_ms, NOT arguments. Build bounded context from received transcripts. Return brief results with session.commentary.append (content, delegation_id); acknowledgements do not prove speech or action success. Never send Realtime response.create, input_audio_buffer, or cancellation syntax.

The model is full duplex. Spoken interruption does NOT cancel application work. Fence late delegation results separately. Audio playback must be observed locally; Live has no authoritative end-of-speech/response.done event. Browser audio measurements are estimates, not proof of sound at physical speakers.

Graceful session.close must drain session.closed/final usage; transport failure leaves usage unconfirmed. Remote storage is disabled. Canonical transcripts stay in Nexus. No automatic reconnect/replay of actions. A replacement session must explicitly use existing Nexus context; provider fork requires stored remote sessions and is not enabled.

## Plan

Add a provider interface and fetch/ws adapter, owner-scoped lifecycle/delegation service using existing Brain/repository/reconciliation, authenticated development routes, and an explicit-start WebRTC view beside the legacy harness. Keep ARY_VOICE_MODE=legacy by default. No legacy voice deletions, schema change, provider change for Brain, or permission changes.

Physical A/B acceptance remains required before promoting Live. Compare direct, memory, tools, long reasoning, interruption, and ten turns on the same microphone. No claimed p50/p95 without samples. Keep wake/prewarm acceptance separate from click-start readiness.

## Actual protocol correction and probe

The real create request rejected `session.type` with HTTP 400 / `unknown_parameter`, param `session.type`. The current WebRTC quickstart omits that field. The adapter therefore omits it; it does not substitute the older Realtime API. A corrected real probe passed create, sideband attach, `session.started`, and `session.closed`. Combined creation/attachment/close took **1,716 ms in one headless no-microphone probe**. This is NOT first-audio latency and NOT wake-to-ready latency.

Run `npx tsx scripts/evaluate-live-webrtc.ts` for that bounded transport-only diagnostic. It uses existing server environment credentials and an isolated Chrome instance, never a physical microphone. No OpenAI SDK was installed; fetch/ws remain the provider boundary.

## Implementation checkpoint

- `src/domain/live-voice.ts`: frontend provider/control port and Ary instructions.
- `src/infrastructure/providers/openai-live.ts`: verified Live WebRTC create and server sideband. Discards reflected PCM; no logging/recording of audio or SDP. Errors expose HTTP classification only.
- `src/services/live-voice-service.ts`: owner/conversation session lease, bounded transcript evidence, client delegation to the existing Brain, duplicate-delegation protection, interruption generation fences, 45-second backend timeout, 120-second idle and ten-minute absolute session limits. Canonical message + extraction job are committed together. Existing reconciliation runs behind `memory.extract`; interrupted/unfinalized session evidence is retained without automatic extraction. Provider duration is retained when supplied; unknown price remains null.
- `src/services/live-command-bridge.ts`: narrow app-launch fast path through the existing command index/dispatcher and ActionRequestService. Installed-app scan and unique match required; no adapter bypass. Approval remains exact and visible in Nexus. It can acknowledge while the request runs. Other requests use the canonical Brain.
- `src/server/http.ts`: authenticated development-only setup/status/interrupt/stop. Existing voice permissions cover startup; same-origin writes required. Session descriptions are excluded from action result auditing. No API key reaches the renderer. Controls are owner-bound; status requests also verify ownership.
- `src/components/voice/live-voice-client.ts`: explicit-gesture media tracks and data channel, shared microphone lease, WebRTC audio output, local mute on interruption, server control heartbeat, startup/stop/unmount cleanup. No per-utterance recording or upload. No automatic fallback that could open a second microphone; legacy remains explicitly available.
- `src/components/voice/live-voice-activator.ts`, `hey-ary-runtime.ts`, `hey-ary-test.tsx`: reuse the existing activation port and owner-verification/wake coordination; wait for Live readiness. This does not supply the missing licensed wake model.
- `src/components/voice/live-voice-test.tsx`, `live-timing.ts`, `src/app/mic-test/page.tsx`: experimental A/B surface and bounded timing summaries, beside all retained legacy controls.
- `.env.example`: `ARY_VOICE_MODE=legacy`. Neither local credentials nor default voice mode were changed.
- `tests/live-voice.test.ts`: 16 focused protocol, privacy, owner isolation, deduplication, stale-result, evidence/extraction, timing, approval, app ambiguity and activation lifecycle tests.

Legacy Brain streaming, speech queue, STT/TTS, realtime relay/provider, tools, model selection, memories, schemas, permissions and existing tests remain. No dependency was added. No production deployment.

## Acceptance: NOT COMPLETE / legacy remains default

The development route is `/mic-test`. Live startup is disabled unless the server is explicitly started with `ARY_VOICE_MODE=live`. Select an existing authenticated conversation and explicitly click **Start GPT-Live microphone**. Stop releases capture. The normal app remains on its existing voice path; this is an experimental integration, not a global replacement.

| Measure | Legacy baseline | Live |
| --- | --- | --- |
| Simple first audio | 3.1–3.2 seconds, synthetic transcript only | Physical test NOT RUN |
| Physical direct p50 / p95 / worst | Not established | NOT RUN |
| Physical memory / tool / deep-answer timing | Not established | NOT RUN |
| Physical barge-in to audible stop | Not established | NOT RUN |
| Transport create + sideband + close | Not comparable | 1,716 ms, one no-mic probe |

The UI's local energy thresholds and audio element state are estimates. They cannot prove actual sound at the owner's speakers, distinguish the owner's voice from every room sound, or expose hidden model processing. Its speech-end time uses the last detected input energy rather than including the 250-ms silence confirmation delay. Local mute timing does not prove a sub-100-ms acoustic interruption. `session.commentary.appended` is context acceptance, not playback completion. Server delegation/tool timestamps are separately labeled; do not mix server timestamps with browser elapsed-time measurements.

Physical acceptance still requires the same microphone/network and the seven requested cases: greeting, joke, Wag Trails memory, approved Premiere launch, longer question, spoken interruption, and ten turns without repeating a wake word. Inspect actual action receipt/approval and subsequent text memory recall. Collect repeated samples by direct/memory/tool/deep category; do not pool an acknowledgment with the final delegated answer.

Remaining gates: owner physical microphone/Electron acceptance; acoustic timing and room-noise tuning; actual delegated memory and approved app execution in Live; ten-turn continuity; cold-wake versus bounded prewarm comparison. The wake model/runtime was already unavailable, so neither wake strategy has been physically measured. No always-running cloud prewarm was enabled. No automatic reconnect/replay; a lost control connection closes the experimental client. Active voice sessions are process-local; canonical action retries and memory evidence stay in existing stores. Very long returned content is bounded, and raw provider transcripts are evidence fragments, not authoritative semantic turn boundaries.

**Not ready to become the default.** The real transport works, but that alone does not meet the user's subjective and measurable acceptance criterion.

## Fresh validation for this checkpoint

- `npm test`: **1,732 passed / 108 files** (baseline 1,716; 16 added).
- `npm run typecheck`: PASS.
- `npm run build`: PASS in an isolated copy to preserve the running development bundle. Production `/mic-test` returned 404; cross-origin voice POST returned 403; bundled public JavaScript contained no server credential symbols.
- `npm run format:check`: fails only on the four pre-existing files: `src/components/calls/calls-panel.tsx`, `src/domain/permissions.ts`, `src/infrastructure/phone/twilio-phone.ts`, `src/services/phone-service.ts`. None changed in this checkpoint.
- Browser smoke: new harness visible, Live Start disabled under legacy default, no microphone started.
- Real provider probe: model access HTTP 200, Live creation PASS, sideband OPEN, `session.started` and graceful `session.closed`. No microphone or audible acceptance in that probe.
- Physical microphone, subjective responsiveness, p50/p95, Live memory/task results and acoustic interruption: **NOT RUN**. No claim of sub-second conversation or default readiness.
