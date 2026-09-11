/** Audio transport and turn detection have no Brain, tools, credentials or persistent store. */
export interface VoiceActivityDetector {
  readonly id: string;
  speech(samples: Float32Array, sampleRate: number): boolean;
  reset(): void;
}
export interface WakeWordDetector {
  readonly id: string;
  /** Local-only inference. Raw idle audio must never leave the device. */
  detected(samples: Float32Array, sampleRate: number): boolean;
  reset(): void;
}
/** Lightweight fallback; deliberately not advertised as neural speech recognition. */
export class EnergyVAD implements VoiceActivityDetector {
  readonly id = "local-energy-v1";
  private floor = 0.002;
  reset() {
    this.floor = 0.002;
  }
  speech(samples: Float32Array) {
    const rms = Math.sqrt(
      samples.reduce((sum, x) => sum + x * x, 0) / Math.max(1, samples.length),
    );
    const threshold = Math.max(0.012, this.floor * 3.5);
    if (rms < threshold) this.floor = this.floor * 0.98 + rms * 0.02;
    return rms >= threshold;
  }
}
export function pcmWave(frames: Float32Array[], sampleRate: number) {
  const count = frames.reduce((n, frame) => n + frame.length, 0);
  const data = new ArrayBuffer(44 + count * 2),
    view = new DataView(data);
  const text = (at: number, s: string) =>
    [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + count * 2, true);
  text(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, count * 2, true);
  let at = 44;
  for (const frame of frames)
    for (const value of frame) {
      const x = Math.max(-1, Math.min(1, value));
      view.setInt16(at, x * (x < 0 ? 32768 : 32767), true);
      at += 2;
    }
  return new Blob([data], { type: "audio/wav" });
}
export interface SessionCallbacks {
  speechStart(): void;
  state(state: "armed" | "listening" | "transcribing" | "paused" | "off"): void;
  transcribe(audio: Blob, signal: AbortSignal): Promise<string>;
  transcript(text: string): void;
  error(error: Error): void;
}
/** One local session; final-only, latest-turn-wins transcription. Never retries a sent Brain turn. */
export class ConversationSession {
  private stopped = false;
  private paused = false;
  private awake: boolean;
  private speechMs = 0;
  private silenceMs = 0;
  private durationMs = 0;
  private active = false;
  private frames: Float32Array[] = [];
  private pre: Float32Array[] = [];
  private preMs = 0;
  private pending: AbortController | null = null;
  private revision = 0;
  constructor(
    private callbacks: SessionCallbacks,
    private vad: VoiceActivityDetector = new EnergyVAD(),
    private wake?: WakeWordDetector,
  ) {
    this.awake = !wake;
    callbacks.state("armed");
  }
  private clear() {
    this.frames = [];
    this.pre = [];
    this.preMs = 0;
    this.speechMs = 0;
    this.silenceMs = 0;
    this.durationMs = 0;
    this.active = false;
  }
  pause(value: boolean) {
    if (this.stopped) return;
    this.paused = value;
    this.clear();
    this.vad.reset();
    this.callbacks.state(value ? "paused" : "armed");
  }
  push(samples: Float32Array, sampleRate: number) {
    if (
      this.stopped ||
      this.paused ||
      !samples.length ||
      sampleRate < 8000 ||
      sampleRate > 96000
    )
      return;
    if (!this.awake) {
      if (!this.wake?.detected(samples, sampleRate)) return;
      this.awake = true;
      // The wake frame is not sent to the cloud.
      return;
    }
    const ms = (samples.length / sampleRate) * 1000;
    const speech = this.vad.speech(samples, sampleRate);
    if (!this.active) {
      this.pre.push(samples.slice());
      this.preMs += ms;
      while (this.pre.length > 1 && this.preMs > 360)
        this.preMs -= (this.pre.shift()!.length / sampleRate) * 1000;
      this.speechMs = speech ? this.speechMs + ms : 0;
      if (this.speechMs < 200) return;
      this.active = true;
      this.frames = this.pre;
      this.pre = [];
      this.preMs = 0;
      this.durationMs = this.frames.reduce(
        (n, f) => n + (f.length / sampleRate) * 1000,
        0,
      );
      this.pending?.abort();
      this.revision++;
      this.callbacks.speechStart();
      if (this.stopped || this.paused) return;
      this.callbacks.state("listening");
      return;
    }
    this.frames.push(samples.slice());
    this.durationMs += ms;
    this.silenceMs = speech ? 0 : this.silenceMs + ms;
    if (this.silenceMs < 650 && this.durationMs < 20000) return;
    if (this.durationMs >= 20000 && this.silenceMs < 650) {
      this.callbacks.error(
        new Error(
          "This turn exceeded 20 seconds. Start again with a shorter request, or use the single-message microphone.",
        ),
      );
      this.stop();
      return;
    }
    const audio = pcmWave(this.frames, sampleRate);
    this.clear();
    this.callbacks.state("transcribing");
    const controller = new AbortController(),
      revision = this.revision;
    this.pending = controller;
    void (async () => this.callbacks.transcribe(audio, controller.signal))()
      .then((text) => {
        if (
          this.stopped ||
          controller.signal.aborted ||
          revision !== this.revision
        )
          return;
        if (text.trim()) this.callbacks.transcript(text.trim());
      })
      .catch((error: unknown) => {
        if (
          !this.stopped &&
          !controller.signal.aborted &&
          revision === this.revision
        ) {
          this.callbacks.error(
            error instanceof Error
              ? error
              : new Error("Voice transcription failed"),
          );
          this.stop(); // Avoid an unattended loop of failed/costly requests.
        }
      })
      .finally(() => {
        if (!this.stopped && revision === this.revision && !this.active)
          this.callbacks.state(this.paused ? "paused" : "armed");
      });
  }
  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.revision++;
    this.pending?.abort();
    this.clear();
    this.vad.reset();
    this.wake?.reset();
    this.callbacks.state("off");
  }
}
