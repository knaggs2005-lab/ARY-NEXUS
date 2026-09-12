import type { WakeWordDetection } from "../domain/wake-word";
import type { WakeWordService } from "./wake-word-service";

export type VoiceActivationState =
  "SLEEPING" | "WAKING" | "ACTIVE" | "RETURNING_TO_SLEEP" | "FAILED";
export interface RealtimeVoiceActivator {
  start(input: { wake: WakeWordDetection }): Promise<void>;
  stop(): Promise<void>;
  onEnded(handler: (failure?: Error) => void): () => void;
}
export interface VoiceActivationEvent {
  type:
    | "voice.activation.requested"
    | "voice.activation.started"
    | "voice.activation.failed"
    | "voice.activation.ended"
    | "voice.sleep.resumed";
  state: VoiceActivationState;
}
export class VoiceActivationService {
  private current: VoiceActivationState = "SLEEPING";
  private offWake: (() => void) | null = null;
  private offEnded: (() => void) | null = null;
  private listeners = new Set<(event: VoiceActivationEvent) => void>();
  constructor(
    private readonly wake: {
      onEvent: WakeWordService["onEvent"];
      pause: WakeWordService["pause"];
      resume: WakeWordService["resume"];
      health: () => { state: string };
    },
    private readonly activator: RealtimeVoiceActivator,
  ) {
    this.offWake = wake.onEvent((event) => {
      void this.handleWake(event.detection);
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
    const event = { type, state: this.current };
    this.listeners.forEach((h) => h(event));
  }
  private async handleWake(detection: WakeWordDetection) {
    if (this.current !== "SLEEPING" || this.wake.health().state === "STOPPED")
      return;
    this.current = "WAKING";
    this.publish("voice.activation.requested");
    try {
      await this.wake.pause();
      await this.activator.start({ wake: detection });
      this.current = "ACTIVE";
      this.publish("voice.activation.started");
    } catch (error) {
      this.current = "FAILED";
      this.publish("voice.activation.failed");
      await this.resumeSleep();
    }
  }
  private async end(failure?: Error) {
    if (this.current !== "ACTIVE") return;
    this.current = failure ? "FAILED" : "RETURNING_TO_SLEEP";
    this.publish(
      failure ? "voice.activation.failed" : "voice.activation.ended",
    );
    await this.resumeSleep();
  }
  private async resumeSleep() {
    await this.wake.resume();
    this.current = "SLEEPING";
    this.publish("voice.sleep.resumed");
  }
  async stop() {
    this.offWake?.();
    this.offEnded?.();
    this.offWake = null;
    this.offEnded = null;
    if (this.current === "ACTIVE" || this.current === "WAKING")
      await this.activator.stop();
    if (this.current !== "SLEEPING") await this.resumeSleep();
  }
}
