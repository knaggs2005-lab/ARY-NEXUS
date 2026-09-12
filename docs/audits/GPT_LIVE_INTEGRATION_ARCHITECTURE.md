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
