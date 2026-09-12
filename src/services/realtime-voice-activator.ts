import type {
  RealtimeVoiceSession,
  RealtimeVoiceSessionProvider,
} from "../domain/realtime-voice";
import type { RealtimeVoiceActivator } from "./voice-activation-service";
import type { WakeWordDetection } from "../domain/wake-word";

export type RealtimeActivatorState =
  "IDLE" | "CONNECTING" | "ACTIVE" | "FAILED";
export class OpenAIRealtimeVoiceActivator implements RealtimeVoiceActivator {
  private active: RealtimeVoiceSession | null = null;
  private current: RealtimeActivatorState = "IDLE";
  private ended = new Set<(failure?: Error) => void>();
  private notified = false;
  private epoch = 0;
  private unsubscribe?: () => void;
  constructor(
    private readonly provider: RealtimeVoiceSessionProvider,
    private readonly userId: string,
  ) {}
  state() {
    return this.current;
  }
  onEnded(handler: (failure?: Error) => void) {
    this.ended.add(handler);
    return () => {
      this.ended.delete(handler);
    };
  }
  private inFlight: Promise<void> | null = null;
  async start(input: {
    wake: WakeWordDetection;
    conversation_id: string;
  }): Promise<void> {
    if (!input.conversation_id.trim())
      throw new Error("A Nexus conversation_id is required");
    if (this.stopping) throw new Error("Realtime activation is stopping");
    if (this.current === "CONNECTING" || this.current === "ACTIVE")
      return this.inFlight ?? Promise.resolve();
    const epoch = ++this.epoch;
    this.current = "CONNECTING";
    this.notified = false;
    this.inFlight = (async () => {
      try {
        const session = await this.provider.createSession({
          user_id: this.userId,
          conversation_id: input.conversation_id,
          classic_fallback_available: false,
        });
        if (epoch !== this.epoch) {
          await session.close();
          return;
        }
        this.active = session;
        this.current = "ACTIVE";
        this.unsubscribe = session.onEvent((event) => {
          if (event.type === "failure")
            void this.finish(new Error(event.failure.message));
          else if (event.type === "state" && event.state === "CLOSED")
            void this.finish();
        });
      } catch (error) {
        if (epoch !== this.epoch) return;
        this.current = "FAILED";
        this.notify(
          error instanceof Error
            ? error
            : new Error("Realtime activation failed"),
        );
        throw error;
      } finally {
        this.inFlight = null;
      }
    })();
    return this.inFlight;
  }
  private stopping?: Promise<void>;
  stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    ++this.epoch;
    this.stopping = (async () => {
      await this.inFlight;
      await this.finish();
      this.current = "IDLE";
    })().finally(() => {
      this.stopping = undefined;
    });
    return this.stopping;
  }
  private async finish(error?: Error) {
    const session = this.active;
    if (!session) return;
    this.active = null;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.current = error ? "FAILED" : "IDLE";
    try {
      await session.close();
    } finally {
      this.notify(error);
    }
  }
  private notify(error?: Error) {
    if (this.notified) return;
    this.notified = true;
    this.ended.forEach((handler) => handler(error));
  }
}
