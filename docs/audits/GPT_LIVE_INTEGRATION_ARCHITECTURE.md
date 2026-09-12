# Executive Summary

GPT Live should be a replaceable realtime audio transport, never a second Ary. The existing local path already captures microphone PCM, performs EnergyVAD, streams OpenAI STT through `VoiceService`/`ActionService`, sends text through the canonical Chat endpoint and `AryBrainService`, then chunks assistant text to OpenAI TTS for browser playback. Twilio is a separate fixed-script approved-call adapter, not a realtime media session, and is currently blocked by Trust Hub KYC.

# Current Voice Architecture

`pcm-capture.ts` and `conversation-session.ts` own microphone PCM, VAD, pre-roll, silence boundaries and cancellation. `use-ary-voice.ts` owns microphone lease, state, interruption, transcript preview, playback and Nexus events. `/api/voice/transcribe` → `voice-stream.ts` → `VoiceService` → `OpenAISpeechToText`; transcript text joins `/api/chat`, whose `AryBrainService.respond()` persists messages, resolves entities, retrieves hybrid memory, routes reasoning, streams deltas, and runs extraction/reflection. `speech-queue.ts` → `/api/voice/speak` → `OpenAITextToSpeech`. Phone uses `PhoneService` and `TwilioPhoneProvider` behind ToolRegistry/ActionService with fixed TwiML and no bidirectional audio.

# Proposed GPT Live Role

Live owns ephemeral audio ingress/egress, turn detection and interruption UX. Nexus owns identity, conversation IDs, memory, entity context, reasoning, ModelRouter, tools, permissions, approvals, missions, outcomes and audit. Existing STT → Brain → TTS remains fallback.

# Canonical Realtime Flow

```text
microphone or future Twilio media
 -> RealtimeVoiceSession provider adapter
 -> Nexus voice-session adapter (conversation_id, auth, bounded context)
 -> AryBrainService.respond()
 -> entity/memory/model/action pipeline
 -> text/events to Live or existing TTS
 -> persisted messages, extraction, actions and outcomes
```

Live may answer only context-free acknowledgments. Context, memory, tool, mission and durable-memory turns delegate to Brain.

# Brain Boundary

Use a thin server-owned session adapter; do not call model providers or tools directly from Live. AryBrainService remains the only reasoning/action escalation owner. ModelRouter retains Luna/Astra/privacy/cost policy. Live receives bounded turn/context and approved results only.

# Session + Memory

Map each ephemeral Live session to one Nexus `conversation_id`. Completed turns become normal `messages`; working context is bounded history plus Brain retrieval. Permanent memory is written only by existing extraction/reconciliation with provenance. Live history is never canonical. Approvals and action IDs remain server-side and exact-input bound.

# Tool Escalation

All requests route Live → Brain → domain adapter/ToolDiscovery → ActionRequestService → ActionService → PermissionService/approval → registered tool → outcome/audit. Missions/Orchestrator are used for durable multi-step work. Live cannot execute, approve, or write memory directly.

# Interruption Model

Live stops audio; Nexus aborts Brain requests. Pending approvals remain pending. Already-dispatched external effects are reconciled with existing receipts/idempotency and are never falsely reported cancelled. Partial speech/transcript is ephemeral; resume starts a new turn on the same conversation.

# Backend Model Routing

Only transport acknowledgments may be Live-local. Context and reasoning use the existing ModelRouter through Brain. No direct Live access to router policy or provider credentials.

# Local Voice

Add a provider-agnostic realtime session port and select it in the existing voice hook with explicit fallback. Preserve microphone permissions, mute, stop-speaking, reduced-motion and current state UI.

# Twilio Voice

Local and phone surfaces may share the session interface, but Twilio requires a separate bidirectional media/WebSocket adapter, μ-law 8 kHz handling and codec transcoding. Current Twilio fixed-TwiML provider cannot support this. Trust Hub/KYC remains blocked.

# Failure/Fallback

Live failure falls back to current STT → Brain → TTS. Socket drops mark interruption; model/tool/TTS failures retain honest existing errors. Bounded reconnect and idempotent turn keys prevent duplicate work. No provider failure becomes mock success.

# Telemetry

Reuse existing VoiceService/model-call telemetry, Nexus events, ActionService receipts, retrieval counts, token/cost metrics, interruption events and Twilio receipts. Do not add a second accounting or memory system.

# Exact File Plan

**Add:** `src/domain/realtime-voice.ts` (ports/events), `src/services/realtime-voice-session-service.ts` (Brain bridge), `src/infrastructure/providers/openai-realtime.ts` (provider adapter), `tests/realtime-voice-session.test.ts` (contract tests).

**Modify:** `src/server/http.ts` (authenticated session negotiation), `src/server/context.ts` (composition), `src/components/voice/use-ary-voice.ts` (Live selection/fallback), `voice-state.ts`/`voice-controls.tsx` (state mapping), existing telemetry/event path (session evidence), and `VOICE_TEST_REPORT.md` after live acceptance.

**Leave untouched initially:** `ary-brain-service.ts`, memory, actions, permissions, ToolRegistry, ModelRouter policy, missions, agents, Hermes, Twilio service/provider, schemas and current STT/TTS implementations.

# Staged Implementation Plan

1. Interfaces/types — **SAFE_FOR_SMALL_MODEL**.
2. Server provider/session adapter — **REQUIRES_STRONG_REASONING**.
3. Local transport integration — **REQUIRES_STRONG_REASONING**.
4. Brain delegation and exact action receipts — **REQUIRES_STRONG_REASONING**.
5. Interruption/reconnect acceptance — **REQUIRES_STRONG_REASONING**.
6. Fallback and observability — **SAFE_FOR_SMALL_MODEL** after interfaces.
7. Twilio media transport — **BLOCKED_BY_EXTERNAL_PROVIDER**.
8. Real-device/live acceptance — **REQUIRES_OWNER_INPUT** and provider readiness.

# Risks

Provider function calling could bypass permissions; ephemeral history could diverge from Nexus; codecs and browser permissions can increase latency; “connected” Live must not imply Brain success; Twilio media is materially different from current fixed scripts.

# External Blockers

GPT Live project/model access must be enabled and verified. Twilio KYC/compliance and bidirectional media capability are unresolved. Real microphone/network testing requires owner hardware and consent.

## Stage 1 — contracts only

Added `src/domain/realtime-voice.ts` with provider-agnostic session, turn, event, interruption, audio, usage, failure, capability, availability, and fallback contracts. Nexus conversation identity is distinct from provider session identity; interruption explicitly cannot cancel external effects; partial transcripts can remain ephemeral. Added pure contract tests in `tests/realtime-voice-contract.test.ts`. No provider, socket, endpoint, codec, UI, environment, or existing voice behavior was changed.

## Stage 2A — offline OpenAI adapter skeleton

Added `src/infrastructure/providers/openai-realtime.ts`. It contains an injected fake transport boundary, OpenAI-specific event translation kept inside infrastructure, canonical state/transcript/audio/interruption/usage/failure mapping, ID separation, validation, and idempotent cleanup. The provider reports unavailable unless an injected transport is supplied. No network, credentials, sockets, UI, Brain, actions, permissions, Twilio, or fallback behavior were added.

## Stage 2A.1 correction

Removed serialization of the Nexus-only brain-abort command, made `response.done` always return the canonical session to `IDLE`, made remote connection closure terminal and idempotent, and removed the unimplemented reconnect capability. Focused adapter tests cover these boundaries. No network or provider call was introduced.

## Stage 2B — server transport

Added an authenticated server-side WebSocket transport with minimal `session.update` (PCM16 mono 24 kHz, server VAD, text/audio modalities, empty tools). It is composed server-side only when `OPENAI_REALTIME_MODEL` and the existing `OPENAI_API_KEY` are present. Browser, Brain delegation, current STT/TTS, Twilio, UI, actions and memory remain disconnected.

## Stage 2B.1 — runtime auth and handshake

Replaced the unsupported WHATWG header overload with the server-side `ws` implementation. Readiness now requires `session.created`; a bounded timeout reports `HANDSHAKE_TIMEOUT`, and only then is minimal `session.update` sent with empty tools. Added explicit `npm run test:realtime-live`, which prints PASS/FAIL/SKIPPED and performs no audio, tools, Brain, memory, or external actions.

## Stage 2B.2 — realtime close diagnosis

Live diagnostic reached OpenAI and received `error.type=invalid_request_error`, `error.code=invalid_model`, with message that model `gpt-live-1` is unsupported in realtime mode. The socket then closed with code `4000` and reason `invalid_request_error.invalid_model`. Transport diagnostics now preserve sanitized close code/reason, socket/session/update milestones, and last event; provider errors win over generic close errors. No protocol field was changed because the evidence identified the configured model as the root cause. Current local environment therefore requires an owner-selected supported realtime model; no environment value was changed by this audit.

## Stage 2C — local wake-word layer

Added provider-agnostic local wake-word contracts and `WakeWordService` lifecycle boundary. Detection is disabled by default, local-only, bounded to phrase metadata, debounced, and suppressible during playback. The development provider is a lifecycle stub and makes no production recognition claim. Realtime session wiring and automatic Brain startup remain deferred to Stage 2D.

## Stage 2D-A — wake to realtime activation bridge

Added `VoiceActivationService` as a narrow orchestration boundary. It pauses local wake listening before requesting an injected realtime activator, ignores duplicate wakes, tracks sleeping/waking/active/failure states, and resumes local listening after activation failure or session end. It has no provider, audio, Brain, tool, memory, or external-system knowledge.
