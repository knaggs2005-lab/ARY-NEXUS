import type { RealtimeVoiceActivator } from "../../services/voice-activation-service";
import { LiveVoiceClient } from "./live-voice-client";
/** Plugs Live into the existing wake/owner-verification state machine. No new wake engine. */
export class LiveVoiceActivator implements RealtimeVoiceActivator {
  private client?: Pick<LiveVoiceClient, "start" | "dispose">;
  private pending?: Promise<void>;
  private handlers = new Set<(failure?: Error) => void>();
  private state = "STOPPED";
  private reject?: (error: Error) => void;
  constructor(
    private changed: (state: string) => void = () => {},
    private create: (
      changed: (state: string) => void,
    ) => Pick<LiveVoiceClient, "start" | "dispose"> = (changed) =>
      new LiveVoiceClient(changed, () => {}),
  ) {}
  onEnded(handler: (failure?: Error) => void) {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }
  snapshot() {
    return { client_capture_state: this.state, mode: "GPT_LIVE" };
  }
  start(input: Parameters<RealtimeVoiceActivator["start"]>[0]): Promise<void> {
    if (this.pending || this.client) return this.pending ?? Promise.resolve();
    if (!input.conversation_id.trim())
      return Promise.reject(new Error("CONVERSATION_REQUIRED"));
    this.state = "STARTING";
    this.pending = new Promise<void>((resolve, reject) => {
      this.reject = reject;
      const client = this.create((state) => {
        this.changed(state);
        if (state === "Connected") {
          this.state = "CAPTURING";
          this.reject = undefined;
          resolve();
          return;
        }
        if (state === "Connecting" || state === "Stopping") return;
        const failed = !state.startsWith("Stopped");
        this.state = failed ? "FAILED" : "STOPPED";
        if (this.client !== client) return;
        this.client = undefined;
        if (this.reject) {
          this.reject(new Error("LIVE_ACTIVATION_FAILED"));
          this.reject = undefined;
        }
        this.handlers.forEach((h) =>
          h(failed ? new Error("LIVE_SESSION_FAILED") : undefined),
        );
      });
      this.client = client;
      void client.start(input.conversation_id);
    }).finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }
  async stop() {
    const client = this.client;
    this.client = undefined;
    this.state = "STOPPED";
    this.reject?.(new Error("LIVE_ACTIVATION_CANCELLED"));
    this.reject = undefined;
    client?.dispose();
    await this.pending?.catch(() => {});
  }
}
