import { z } from "zod";

export type RealtimeVoiceSessionState =
  | "IDLE"
  | "LISTENING"
  | "USER_SPEAKING"
  | "PROCESSING"
  | "ASSISTANT_SPEAKING"
  | "INTERRUPTED"
  | "RECONNECTING"
  | "FAILED"
  | "CLOSED";
export type RealtimeVoiceCapability =
  | "audio_input"
  | "audio_output"
  | "server_vad"
  | "client_vad"
  | "interruptions"
  | "transcript_deltas"
  | "audio_deltas"
  | "reconnect"
  | "usage_metadata"
  | "telephony_audio";
export type RealtimeVoiceInterruptionKind =
  "STOP_AUDIO" | "ABORT_BRAIN_REQUEST" | "BOTH";
export interface RealtimeVoiceAudioFrame {
  readonly encoding: string;
  readonly sample_rate_hz: number;
  readonly channels: number;
  readonly data: ArrayBuffer | Uint8Array;
  readonly timestamp_ms?: number;
}
export interface RealtimeVoiceTurn {
  readonly id: string;
  readonly session_id: string;
  readonly kind: "user" | "assistant";
  readonly transcript?: {
    readonly text: string;
    readonly phase: "EPHEMERAL" | "FINAL";
    readonly persisted_message_id?: string | null;
  };
  readonly state: RealtimeVoiceSessionState;
  readonly started_at: string;
  readonly ended_at?: string;
}
export interface RealtimeVoiceInterruption {
  readonly turn_id: string;
  readonly kind: RealtimeVoiceInterruptionKind;
  readonly at: string;
  readonly cancel_external_effect: false;
}
export interface RealtimeVoiceUsage {
  readonly input_audio_ms?: number;
  readonly output_audio_ms?: number;
  readonly input_tokens?: number;
  readonly output_tokens?: number;
  readonly estimated_cost_usd?: number;
}
export interface RealtimeVoiceFailure {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly provider?: string;
}
export type RealtimeVoiceEvent =
  | { type: "state"; state: RealtimeVoiceSessionState }
  | { type: "speech_start" | "speech_end"; turn_id: string }
  | { type: "transcript_delta"; turn_id: string; text: string }
  | {
      type: "transcript_final";
      turn_id: string;
      text: string;
      persisted_message_id?: string | null;
    }
  | { type: "assistant_text_delta"; turn_id: string; text: string }
  | {
      type: "assistant_audio_delta";
      turn_id: string;
      frame: RealtimeVoiceAudioFrame;
    }
  | { type: "interruption"; interruption: RealtimeVoiceInterruption }
  | { type: "usage"; usage: RealtimeVoiceUsage }
  | { type: "failure"; failure: RealtimeVoiceFailure };
export interface RealtimeVoiceSessionConfig {
  readonly user_id: string;
  readonly conversation_id: string;
  readonly capabilities?: readonly RealtimeVoiceCapability[];
  readonly classic_fallback_available: boolean;
}
export interface RealtimeVoiceSession {
  readonly id: string;
  readonly nexus_conversation_id: string;
  readonly provider_session_id?: string | null;
  readonly state: RealtimeVoiceSessionState;
  sendAudio(frame: RealtimeVoiceAudioFrame): void;
  interrupt(kind: RealtimeVoiceInterruptionKind): void;
  close(): Promise<void>;
  onEvent(handler: (event: RealtimeVoiceEvent) => void): () => void;
}
export interface RealtimeVoiceSessionProvider {
  readonly id: string;
  capabilities(): readonly RealtimeVoiceCapability[];
  availability(): "AVAILABLE" | "UNAVAILABLE" | "DEGRADED";
  createSession(
    config: RealtimeVoiceSessionConfig,
  ): Promise<RealtimeVoiceSession>;
}
export const realtimeVoiceInterruption = z
  .object({
    turn_id: z.string().min(1),
    kind: z.enum(["STOP_AUDIO", "ABORT_BRAIN_REQUEST", "BOTH"]),
    at: z.string().datetime(),
    cancel_external_effect: z.literal(false),
  })
  .strict();
