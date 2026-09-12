import type { WakeWordDetection } from "../domain/wake-word";
import type { WakeWordService } from "./wake-word-service";
export type VoiceActivationState =
  | "SLEEPING"
  | "VERIFYING_OWNER"
  | "WAKING"
  | "ACTIVE"
  | "RETURNING_TO_SLEEP"
  | "FAILED";
export interface RealtimeVoiceActivator {
  start(input: {
    wake: WakeWordDetection;
    conversation_id: string;
  }): Promise<void>;
  stop(): Promise<void>;
  onEnded(handler: (failure?: Error) => void): () => void;
}
export interface VoiceActivationEvent {
  type:
    | "voice.activation.requested"
    | "voice.owner.verifying"
    | "voice.owner.rejected"
    | "voice.activation.started"
    | "voice.activation.failed"
    | "voice.activation.ended"
    | "voice.sleep.resumed";
  state: VoiceActivationState;
}
/** Coordinates existing wake/capture/session services; creates no identities or conversations. */
export class VoiceActivationService {
  private current: VoiceActivationState = "SLEEPING";
  private listeners = new Set<(event: VoiceActivationEvent) => void>();
  private offWake: () => void;
  private offEnded: () => void;
  private epoch = 0;
  private disposed = false;
  private pending?: Promise<void>;
  private stopping?: Promise<void>;
  constructor(
    private readonly wake: Pick<
      WakeWordService,
      "onEvent" | "pause" | "resume"
    > & { health(): { state: string } },
    private readonly activator: RealtimeVoiceActivator,
    private readonly conversationId: string,
    private readonly verifyOwner?: () => Promise<boolean>,
  ) {
    this.offWake = wake.onEvent((event) => {
      if (event.type === "wake.failed") {
        void this.end(new Error("WAKE_ENGINE_FAILED"), true);
        return;
      }
      if (!this.disposed && this.current === "SLEEPING")
        this.pending = this.handleWake(event.detection);
    });
    this.offEnded = activator.onEnded((failure) => {
      void this.end(failure);
    });
  }
  state() {
    return this.current;
  }
  onEvent(handler: (event: VoiceActivationEvent) => void) {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }
  private publish(type: VoiceActivationEvent["type"]) {
    this.listeners.forEach((h) => h({ type, state: this.current }));
  }
  private async handleWake(detection: WakeWordDetection) {
    if (
      this.disposed ||
      !["LISTENING", "WAKE_DETECTED"].includes(this.wake.health().state)
    )
      return;
    const epoch = ++this.epoch;
    this.current = "WAKING";
    this.publish("voice.activation.requested");
    try {
      await this.wake.pause(); // release the single microphone lease before verification/active capture
      if (this.disposed || epoch !== this.epoch) return;
      if (this.verifyOwner) {
        this.current = "VERIFYING_OWNER";
        this.publish("voice.owner.verifying");
        const accepted = await this.verifyOwner();
        if (this.disposed || epoch !== this.epoch) return;
        if (!accepted) {
          this.publish("voice.owner.rejected");
          await this.resumeSleep();
          return;
        }
      }
      this.current = "WAKING";
      await this.activator.start({
        wake: detection,
        conversation_id: this.conversationId,
      });
      if (this.disposed || epoch !== this.epoch) return;
      this.current = "ACTIVE";
      this.publish("voice.activation.started");
    } catch {
      if (this.disposed || epoch !== this.epoch) return;
      this.current = "FAILED";
      this.publish("voice.activation.failed");
      await this.activator.stop().catch(() => {});
      await this.resumeSleep();
    }
  }
  private async end(failure?: Error, wakeFailed = false) {
    if (
      this.disposed ||
      (!wakeFailed &&
        !["ACTIVE", "WAKING", "VERIFYING_OWNER"].includes(this.current))
    )
      return;
    ++this.epoch;
    this.current = failure ? "FAILED" : "RETURNING_TO_SLEEP";
    this.publish(
      failure ? "voice.activation.failed" : "voice.activation.ended",
    );
    await this.activator.stop().catch(() => {});
    if (!wakeFailed) await this.resumeSleep();
  }
  private async resumeSleep() {
    if (this.disposed) return;
    try {
      await this.wake.resume();
      if (this.disposed) return;
      if (this.wake.health().state !== "LISTENING")
        throw new Error("WAKE_RESUME_FAILED");
      this.current = "SLEEPING";
      this.publish("voice.sleep.resumed");
    } catch {
      this.current = "FAILED";
      this.publish("voice.activation.failed");
    }
  }
  stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.disposed = true;
    ++this.epoch;
    this.offWake();
    this.offEnded();
    return (this.stopping = (async () => {
      await this.activator.stop();
      await this.pending;
      this.current = "SLEEPING";
      // Runtime shutdown stops wake separately. Never reacquire hardware during page close.
    })());
  }
}
