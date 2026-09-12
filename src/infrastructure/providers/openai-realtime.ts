import type {
  RealtimeVoiceEvent,
  RealtimeVoiceInterruption,
  RealtimeVoiceSession,
  RealtimeVoiceSessionConfig,
  RealtimeVoiceSessionProvider,
  RealtimeVoiceCapability,
  RealtimeVoiceAudioFrame,
  RealtimeVoiceUsage,
  RealtimeVoiceFailure,
} from "../../domain/realtime-voice";
import { realtimeVoiceInterruption } from "../../domain/realtime-voice";

type OpenAIRealtimeEvent = {
  type: string;
  session?: { id?: string };
  item_id?: string;
  delta?: string;
  text?: string;
  audio?: string;
  audio_format?: string;
  sample_rate_hz?: number;
  channels?: number;
  usage?: Record<string, unknown>;
  error?: { code?: string; message?: string; type?: string };
};
export interface OpenAIRealtimeTransport {
  connect(onEvent: (event: OpenAIRealtimeEvent) => void): Promise<void>;
  send(command: { type: string; [key: string]: unknown }): void;
  close(): Promise<void>;
}
const capabilities = [
  "audio_input",
  "audio_output",
  "server_vad",
  "interruptions",
  "transcript_deltas",
  "audio_deltas",
  "usage_metadata",
] as const satisfies readonly RealtimeVoiceCapability[];
function failure(error: OpenAIRealtimeEvent["error"]): RealtimeVoiceFailure {
  const code = error?.code ?? error?.type ?? "provider_error";
  return {
    code,
    message: error?.message ?? "Realtime voice provider error",
    retryable: /timeout|tempor|unavailable|disconnect|rate/i.test(code),
  };
}
function usage(raw: Record<string, unknown>): RealtimeVoiceUsage {
  const n = (v: unknown) => (typeof v === "number" ? v : undefined);
  return {
    input_audio_ms: n(raw.input_audio_ms ?? raw.input_audio_duration_ms),
    output_audio_ms: n(raw.output_audio_ms ?? raw.output_audio_duration_ms),
    input_tokens: n(raw.input_tokens),
    output_tokens: n(raw.output_tokens),
    estimated_cost_usd: n(raw.estimated_cost_usd),
  };
}
class Session implements RealtimeVoiceSession {
  readonly id: string;
  readonly nexus_conversation_id: string;
  provider_session_id: string | null = null;
  state: RealtimeVoiceSession["state"] = "IDLE";
  private closed = false;
  private listeners = new Set<(e: RealtimeVoiceEvent) => void>();
  constructor(
    private config: RealtimeVoiceSessionConfig,
    private transport: OpenAIRealtimeTransport,
  ) {
    this.id = crypto.randomUUID();
    this.nexus_conversation_id = config.conversation_id;
  }
  private emit(e: RealtimeVoiceEvent) {
    if (!this.closed) {
      if (e.type === "state") this.state = e.state;
      this.listeners.forEach((fn) => fn(e));
    }
  }
  async connect() {
    await this.transport.connect((e) => this.receive(e));
  }
  private receive(e: OpenAIRealtimeEvent) {
    if (this.closed) return;
    if (e.type === "session.created" || e.type === "session.ready") {
      this.provider_session_id = e.session?.id ?? null;
      this.emit({ type: "state", state: "IDLE" });
      return;
    }
    if (e.type === "input_audio_buffer.speech_started") {
      this.emit({ type: "speech_start", turn_id: e.item_id ?? "unknown" });
      this.emit({ type: "state", state: "USER_SPEAKING" });
      return;
    }
    if (e.type === "input_audio_buffer.speech_stopped") {
      this.emit({ type: "speech_end", turn_id: e.item_id ?? "unknown" });
      this.emit({ type: "state", state: "PROCESSING" });
      return;
    }
    if (e.type.includes("transcript") && e.delta !== undefined) {
      this.emit({
        type: "transcript_delta",
        turn_id: e.item_id ?? "unknown",
        text: e.delta,
      });
      return;
    }
    if (e.type.includes("transcript") && e.text !== undefined) {
      this.emit({
        type: "transcript_final",
        turn_id: e.item_id ?? "unknown",
        text: e.text,
        persisted_message_id: null,
      });
      return;
    }
    if (e.type === "response.audio.delta" && e.audio) {
      const frame: RealtimeVoiceAudioFrame = {
        encoding: e.audio_format ?? "base64",
        sample_rate_hz: e.sample_rate_hz ?? 24000,
        channels: e.channels ?? 1,
        data: Uint8Array.from(Buffer.from(e.audio, "base64")),
      };
      if (
        !Number.isFinite(frame.sample_rate_hz) ||
        frame.sample_rate_hz < 8000 ||
        frame.sample_rate_hz > 96000
      ) {
        this.emit({
          type: "failure",
          failure: {
            code: "invalid_audio_metadata",
            message: "Provider audio metadata is invalid",
            retryable: false,
            provider: "openai-realtime",
          },
        });
        return;
      }
      this.emit({
        type: "assistant_audio_delta",
        turn_id: e.item_id ?? "unknown",
        frame,
      });
      this.emit({ type: "state", state: "ASSISTANT_SPEAKING" });
      return;
    }
    if (
      e.type === "response.audio_transcript.delta" ||
      e.type === "response.text.delta"
    ) {
      this.emit({
        type: "assistant_text_delta",
        turn_id: e.item_id ?? "unknown",
        text: e.delta ?? "",
      });
      return;
    }
    if (e.type === "response.done") {
      if (e.usage) this.emit({ type: "usage", usage: usage(e.usage) });
      this.emit({ type: "state", state: "IDLE" });
      return;
    }
    if (e.type === "error") {
      this.emit({ type: "failure", failure: failure(e.error) });
      this.emit({ type: "state", state: "FAILED" });
      return;
    }
    if (e.type === "connection.closed") {
      this.emit({ type: "state", state: "CLOSED" });
      this.closed = true;
      this.listeners.clear();
    }
  }
  sendAudio(frame: RealtimeVoiceAudioFrame) {
    if (this.closed) throw new Error("Realtime voice session is closed");
    if (frame.encoding !== "pcm16" || frame.channels !== 1)
      throw new Error("Unsupported audio frame format");
    if (
      !Number.isFinite(frame.sample_rate_hz) ||
      frame.sample_rate_hz < 8000 ||
      frame.sample_rate_hz > 96000 ||
      frame.channels < 1 ||
      frame.sample_rate_hz !== 24000
    )
      throw new Error("Invalid audio frame metadata");
  }
  interrupt(kind: RealtimeVoiceInterruption["kind"]) {
    if (this.closed) return;
    const i = realtimeVoiceInterruption.parse({
      turn_id: "current",
      kind,
      at: new Date().toISOString(),
      cancel_external_effect: false,
    });
    if (kind === "STOP_AUDIO" || kind === "BOTH")
      this.transport.send({ type: "response.cancel" });
    this.emit({ type: "interruption", interruption: i });
    this.emit({ type: "state", state: "INTERRUPTED" });
  }
  onEvent(h: (e: RealtimeVoiceEvent) => void) {
    this.listeners.add(h);
    return () => this.listeners.delete(h);
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    this.listeners.clear();
    await this.transport.close();
  }
}
export class OpenAIRealtimeSessionProvider implements RealtimeVoiceSessionProvider {
  readonly id = "openai-realtime";
  capabilities() {
    return capabilities;
  }
  availability() {
    return "UNAVAILABLE" as const;
  }
  constructor(private transportFactory?: () => OpenAIRealtimeTransport) {}
  async createSession(config: RealtimeVoiceSessionConfig) {
    if (!this.transportFactory)
      throw new Error("Realtime transport is not configured");
    const s = new Session(config, this.transportFactory());
    await s.connect();
    return s;
  }
}
export { Session as OpenAIRealtimeSession };
