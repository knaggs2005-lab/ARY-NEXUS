import type { RealtimeVoiceActivator } from "../../services/voice-activation-service";
import type { RealtimeMicRelayClient } from "./realtime-mic-relay-client";
import type { RealtimePlayback } from "./realtime-playback";
/** Browser implementation of the existing activator port. The relay owns the sole provider connection. */
export class RelayVoiceActivator implements RealtimeVoiceActivator {
  private active?: RealtimeMicRelayClient;
  private starting?: Promise<void>;
  private stopping?: Promise<void>;
  private watch?: ReturnType<typeof setInterval>;
  private ended = new Set<(failure?: Error) => void>();
  private epoch = 0;
  constructor(
    private create: () => RealtimeMicRelayClient,
    private playback: RealtimePlayback,
  ) {}
  onEnded(handler: (failure?: Error) => void) {
    this.ended.add(handler);
    return () => {
      this.ended.delete(handler);
    };
  }
  start(input: Parameters<RealtimeVoiceActivator["start"]>[0]): Promise<void> {
    if (this.stopping) return Promise.reject(new Error("VOICE_STOPPING"));
    if (this.starting || this.active) return this.starting ?? Promise.resolve();
    if (!input.conversation_id.trim())
      return Promise.reject(new Error("CONVERSATION_REQUIRED"));
    const epoch = ++this.epoch;
    const client = this.create();
    this.active = client;
    return (this.starting = (async () => {
      await this.playback.start(); // context was unlocked in owner's runtime Start gesture
      await client.start(input.conversation_id, true);
      if (epoch !== this.epoch) {
        await client.stop();
        return;
      }
      if (client.snapshot().client_capture_state !== "CAPTURING")
        throw new Error("VOICE_ACTIVATION_FAILED");
      this.watch = setInterval(() => {
        if (
          ["STOPPED", "FAILED"].includes(client.snapshot().client_capture_state)
        ) {
          const code = client.snapshot().failure_code;
          void this.finish(
            code ? new Error("VOICE_SESSION_FAILED") : undefined,
          );
        }
      }, 100);
    })()
      .catch(async (error) => {
        await client.stop();
        this.active = undefined;
        throw error;
      })
      .finally(() => {
        this.starting = undefined;
      }));
  }
  snapshot() {
    return this.active?.snapshot();
  }
  private async finish(failure?: Error) {
    if (!this.active) return;
    await this.stop();
    this.ended.forEach((h) => h(failure));
  }
  stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    ++this.epoch;
    clearInterval(this.watch);
    this.playback.stop();
    return (this.stopping = (async () => {
      const client = this.active;
      await client?.stop();
      await this.starting?.catch(() => {});
      this.active = undefined;
    })().finally(() => {
      this.stopping = undefined;
    }));
  }
}
