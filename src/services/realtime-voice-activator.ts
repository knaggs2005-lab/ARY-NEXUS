import { randomUUID } from "node:crypto";
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
  async start(input: { wake: WakeWordDetection }): Promise<void> {
    if (this.active) return;
    this.current = "CONNECTING";
    this.notified = false;
    try {
      const session = await this.provider.createSession({
        user_id: this.userId,
        conversation_id: randomUUID(),
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
    }
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
