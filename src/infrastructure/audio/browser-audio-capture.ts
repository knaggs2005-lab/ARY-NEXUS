import { capturePCM } from "../../components/voice/pcm-capture";
import { microphoneLease } from "../../components/voice/microphone-lease";
import {
  float32ToPcm16,
  type AudioCaptureConfig,
  type AudioCaptureFailure,
  type AudioCaptureFrame,
  type AudioCaptureHealth,
  type AudioCaptureProvider,
  type AudioCaptureSession,
} from "../../domain/audio-capture";

const RATE = 24_000;
const SAMPLES = 480;
export class Pcm16Packetizer {
  private pending = new Float32Array(0);
  private index = 0;
  constructor(private readonly emit: (frame: AudioCaptureFrame) => void) {}
  push(samples: Float32Array) {
    if (!samples.length) return;
    const merged = new Float32Array(this.pending.length + samples.length);
    merged.set(this.pending);
    merged.set(samples, this.pending.length);
    this.pending = merged;
    while (this.pending.length >= SAMPLES) {
      const chunk = this.pending.slice(0, SAMPLES);
      this.pending = this.pending.slice(SAMPLES);
      const pcm = float32ToPcm16(chunk),
        bytes = new Uint8Array(pcm.length * 2);
      const view = new DataView(bytes.buffer);
      for (let i = 0; i < pcm.length; i++) view.setInt16(i * 2, pcm[i], true);
      this.emit({
        encoding: "pcm16",
        sample_rate_hz: RATE,
        channels: 1,
        data: bytes,
        frame_index: this.index++,
      });
    }
  }
  clear() {
    this.pending = new Float32Array(0);
  }
}
export interface BrowserCaptureDeps {
  readonly lease?: typeof microphoneLease;
  readonly capture?: typeof capturePCM;
  readonly getUserMedia?: (
    constraints: MediaStreamConstraints,
  ) => Promise<MediaStream>;
  readonly audioContextFactory?: (
    options?: AudioContextOptions,
  ) => AudioContext;
}
export class BrowserAudioCaptureProvider implements AudioCaptureProvider {
  constructor(private readonly deps: BrowserCaptureDeps = {}) {}
  async start(
    config: AudioCaptureConfig,
    onFrame: (frame: AudioCaptureFrame) => void,
    onFailure: (failure: AudioCaptureFailure) => void,
  ): Promise<AudioCaptureSession> {
    const target = config.targetSampleRateHz ?? RATE,
      duration = config.frameDurationMs ?? 20;
    if (target !== RATE || duration !== 20)
      throw new Error("Capture requires 24 kHz, 20 ms frames");
    const signal = config.signal ?? new AbortController().signal;
    signal.throwIfAborted();
    let release: (() => void) | undefined,
      stopCapture: (() => void) | undefined,
      stopped = false,
      paused = false;
    let unsupportedRate: number | null = null;
    const health: AudioCaptureHealth = {
      state: "STARTING",
      sample_rate_hz: RATE,
      channels: 1,
      frame_count: 0,
    };
    const packetizer = new Pcm16Packetizer((frame) => {
      if (!stopped && !paused) {
        health.frame_count++;
        onFrame(frame);
      }
    });
    const fail = (code: string, message: string) => {
      health.state = "FAILED";
      health.reason = message;
      onFailure({ code, message });
    };
    const session: AudioCaptureSession = {
      health,
      pause: () => {
        if (!stopped) {
          paused = true;
          packetizer.clear();
          health.state = "PAUSED";
        }
      },
      resume: () => {
        if (!stopped) {
          paused = false;
          health.state = "CAPTURING";
        }
      },
      stop: async () => {
        if (stopped) return;
        stopped = true;
        packetizer.clear();
        stopCapture?.();
        stopCapture = undefined;
        release?.();
        release = undefined;
        health.state = "STOPPED";
      },
    };
    try {
      release = await (this.deps.lease ?? microphoneLease)(signal);
      signal.throwIfAborted();
      const gum =
        this.deps.getUserMedia ??
        ((constraints: MediaStreamConstraints) =>
          navigator.mediaDevices.getUserMedia(constraints));
      const stream = await gum({
        audio: { channelCount: { exact: 1 }, sampleRate: { ideal: RATE } },
      });
      if (signal.aborted) {
        stream.getTracks().forEach((t) => t.stop());
        await session.stop();
        throw new DOMException("Cancelled", "AbortError");
      }
      const capture = this.deps.capture ?? capturePCM;
      stopCapture = await capture(
        stream,
        signal,
        (samples, actualRate) => {
          if (actualRate !== RATE) {
            unsupportedRate = actualRate;
            fail(
              "UNSUPPORTED_SAMPLE_RATE",
              `AudioContext provided ${actualRate} Hz`,
            );
            void session.stop();
            return;
          }
          packetizer.push(samples);
        },
        { sampleRate: RATE, channelCount: 1 },
      );
      if (unsupportedRate !== null) {
        await session.stop();
        throw new Error(`AudioContext provided ${unsupportedRate} Hz`);
      }
      health.state = "CAPTURING";
      return session;
    } catch (error) {
      if (!stopped) await session.stop();
      if (!(error instanceof DOMException && error.name === "AbortError"))
        fail(
          error instanceof Error && /sample/i.test(error.message)
            ? "UNSUPPORTED_SAMPLE_RATE"
            : "CAPTURE_FAILED",
          error instanceof Error ? error.message : "Microphone capture failed",
        );
      throw error;
    }
  }
}
