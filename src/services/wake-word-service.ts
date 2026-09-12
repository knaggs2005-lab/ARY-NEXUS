import type { EventDraft } from "../domain/nexus-events";
import type {
  WakeWordConfig,
  WakeWordDetection,
  WakeWordEvent,
  WakeWordHealth,
  WakeWordProvider,
  WakeWordSession,
  WakeWordState,
} from "../domain/wake-word";

export class WakeWordService {
  private session: WakeWordSession | null = null;
  private healthState: WakeWordHealth = {
    state: "STOPPED",
    providerId: "none",
    localOnly: true,
    microphoneActive: false,
  };
  private lastDetection = 0;
  private unsubscribe: (() => void) | null = null;
  private playback = false;
  private listeners = new Set<(event: WakeWordEvent) => void>();
  onEvent(handler: (event: WakeWordEvent) => void) {
    this.listeners.add(handler);
    return () => {
      this.listeners.delete(handler);
    };
  }
  constructor(
    private readonly provider: WakeWordProvider,
    private readonly recordEvent?: (event: EventDraft) => Promise<unknown>,
  ) {}
  health(): WakeWordHealth {
    return this.healthState;
  }
  setPlaybackActive(active: boolean) {
    this.playback = active;
  }
  async start(config: WakeWordConfig): Promise<WakeWordHealth> {
    if (config.enabled === false) return this.healthState;
    if (this.session) return this.healthState;
    this.healthState = {
      state: "STARTING",
      providerId: this.provider.id,
      localOnly: true,
      microphoneActive: false,
    };
    try {
      this.session = await this.provider.start(config);
      this.healthState = {
        state: "LISTENING",
        providerId: this.provider.id,
        localOnly: true,
        microphoneActive: true,
      };
      this.unsubscribe = this.session.onEvent((event) => {
        void this.handle(event, config.cooldownMs ?? 1500);
      });
      await this.emit("wake.listener.started", {});
    } catch (error) {
      this.healthState = {
        state: "FAILED",
        providerId: this.provider.id,
        localOnly: true,
        microphoneActive: false,
        reason:
          error instanceof Error ? error.message : "Microphone unavailable",
      };
      await this.emit("wake.listener.failed", {
        reason_code: "MICROPHONE_PERMISSION",
      });
    }
    return this.healthState;
  }
  async pause() {
    if (!this.session) return;
    await this.session.pause();
    this.healthState = {
      ...this.healthState,
      state: "PAUSED",
      microphoneActive: false,
    };
    await this.emit("wake.listener.paused", {});
  }
  async resume() {
    if (!this.session) return;
    await this.session.resume();
    this.healthState = {
      ...this.healthState,
      state: "LISTENING",
      microphoneActive: true,
    };
    await this.emit("wake.listener.resumed", {});
  }
  async stop() {
    if (!this.session) return;
    this.unsubscribe?.();
    this.unsubscribe = null;
    const s = this.session;
    this.session = null;
    await s.stop();
    this.healthState = {
      ...this.healthState,
      state: "STOPPED",
      microphoneActive: false,
    };
    await this.emit("wake.listener.stopped", {});
  }
  private async handle(event: WakeWordEvent, cooldown: number) {
    if (event.type === "wake.failed") {
      this.healthState = {
        ...this.healthState,
        state: "FAILED",
        microphoneActive: false,
        reason: event.code,
      };
      this.listeners.forEach((listener) => listener(event));
      return;
    }
    if (!["LISTENING", "WAKE_DETECTED"].includes(this.healthState.state))
      return;
    const now = Date.now();
    if (this.playback || now - this.lastDetection < cooldown) return;
    this.lastDetection = now;
    this.healthState = { ...this.healthState, state: "WAKE_DETECTED" };
    this.listeners.forEach((listener) => listener(event));
    await this.emit("wake.detected", { label: event.detection.wakePhrase });
    setTimeout(() => {
      if (this.healthState.state === "WAKE_DETECTED")
        this.healthState = { ...this.healthState, state: "LISTENING" };
    }, 0);
  }
  private async emit(
    type: `wake.${string}`,
    payload: { label?: string; reason_code?: string },
  ) {
    if (!this.recordEvent) return;
    await this.recordEvent({
      type,
      source: { kind: "backend", name: "wake-word-service" },
      severity: type.endsWith("failed") ? "warning" : "info",
      visibility: "ambient",
      payload,
    });
  }
}
export class DevelopmentWakeWordProvider implements WakeWordProvider {
  readonly id = "development-local" as const;
  readonly localOnly = true as const;
  async start(_config: WakeWordConfig): Promise<WakeWordSession> {
    const listeners = new Set<(e: WakeWordEvent) => void>();
    let state: WakeWordState = "LISTENING";
    const id = crypto.randomUUID();
    return {
      id,
      get state() {
        return state;
      },
      pause: async () => {
        state = "PAUSED";
      },
      resume: async () => {
        state = "LISTENING";
      },
      stop: async () => {
        state = "STOPPED";
        listeners.clear();
      },
      onEvent: (h) => {
        listeners.add(h);
        return () => listeners.delete(h);
      },
    };
  }
}
