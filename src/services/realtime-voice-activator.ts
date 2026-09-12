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
    if (this.current === "CONNECTING" || this.current === "ACTIVE")
      return this.inFlight ?? Promise.resolve();
    this.current = "CONNECTING";
    this.notified = false;
    this.inFlight = (async () => {
      try {
        const session = await this.provider.createSession({
          user_id: this.userId,
          conversation_id: input.conversation_id,
          classic_fallback_available: false,
        });
        this.active = session;
        this.current = "ACTIVE";
        session.onEvent((event) => {
          if (event.type === "failure")
            void this.finish(new Error(event.failure.message));
          else if (event.type === "state" && event.state === "CLOSED")
            void this.finish();
        });
      } catch (error) {
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
  async stop() {
    const session = this.active;
    if (!session) return;
    this.active = null;
    this.current = "IDLE";
    await session.close();
    this.notify();
  }
  private async finish(error?: Error) {
    if (!this.active) return;
    this.active = null;
    this.current = error ? "FAILED" : "IDLE";
    this.notify(error);
  }
  private notify(error?: Error) {
    if (this.notified) return;
    this.notified = true;
    this.ended.forEach((handler) => handler(error));
  }
}
