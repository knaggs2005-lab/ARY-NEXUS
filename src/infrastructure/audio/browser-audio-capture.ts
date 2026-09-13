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
export function frameMetadata(frame: AudioCaptureFrame) {
  return {
    frame_index: frame.frame_index,
    sample_rate_hz: frame.sample_rate_hz,
    channels: frame.channels,
    byte_length: frame.data.byteLength,
  };
}
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
    const lifetime = new AbortController();
    const callerSignal = config.signal;
    const forwardAbort = () => lifetime.abort();
    callerSignal?.addEventListener("abort", forwardAbort, { once: true });
    if (callerSignal?.aborted) lifetime.abort();
    let release: (() => void) | undefined,
      stopCapture: (() => void) | undefined,
      stream: MediaStream | undefined,
      stopped = false,
      terminal = false,
      paused = false,
      failureSent = false;
    const health: AudioCaptureHealth = {
      state: "STARTING",
      sample_rate_hz: RATE,
      channels: 1,
      frame_count: 0,
      microphone_active: false,
    };
    const packetizer = new Pcm16Packetizer((frame) => {
      if (!terminal && !paused) {
        health.frame_count++;
        onFrame(frame);
      }
    });
    const failOnce = (code: string, message: string) => {
      if (failureSent || stopped) return;
      failureSent = true;
      terminal = true;
      health.state = "FAILED";
      health.reason = message;
      health.microphone_active = false;
      onFailure({ code, message });
    };
    const cleanup = async (state: "STOPPED" | "FAILED") => {
      if (stopped) return;
      stopped = true;
      terminal = true;
      packetizer.clear();
      lifetime.abort();
      stopCapture?.();
      stopCapture = undefined;
      stream?.getTracks().forEach((track) => {
        track.removeEventListener?.("ended", onTrackEnded);
        track.stop();
      });
      release?.();
      release = undefined;
      callerSignal?.removeEventListener("abort", forwardAbort);
      health.state = state;
      health.microphone_active = false;
    };
    const onTrackEnded = () => {
      failOnce("TRACK_ENDED", "Microphone track ended unexpectedly");
      void cleanup("FAILED");
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
      stop: () => cleanup("STOPPED"),
    };
    lifetime.signal.addEventListener(
      "abort",
      () => {
        if (!stopped) void cleanup("STOPPED");
      },
      { once: true },
    );
    try {
      lifetime.signal.throwIfAborted();
      release = await (this.deps.lease ?? microphoneLease)(lifetime.signal);
      lifetime.signal.throwIfAborted();
      const gum =
        this.deps.getUserMedia ??
        ((constraints: MediaStreamConstraints) =>
          navigator.mediaDevices.getUserMedia(constraints));
      stream = await gum({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          // Avoid automatically amplifying room noise during quiet pauses.
          autoGainControl: false,
          channelCount: { exact: 1 },
          sampleRate: { ideal: RATE },
        },
      });
      // Acquisition is the point at which the physical microphone is active.
      // Keep this truthful while capture setup is still completing.
      health.microphone_active = true;
      stream
        .getTracks()
        .forEach((track) => track.addEventListener?.("ended", onTrackEnded));
      if (lifetime.signal.aborted) {
        await cleanup("STOPPED");
        throw new DOMException("Cancelled", "AbortError");
      }
      const capture = this.deps.capture ?? capturePCM;
      const cleanupCapture = await capture(
        stream,
        lifetime.signal,
        (samples, actualRate) => {
          if (actualRate !== RATE) {
            failOnce(
              "UNSUPPORTED_SAMPLE_RATE",
              `AudioContext provided ${actualRate} Hz`,
            );
            void cleanup("FAILED");
            return;
          }
          packetizer.push(samples);
        },
        { sampleRate: RATE, channelCount: 1 },
      );
      stopCapture = cleanupCapture;
      if (terminal) stopCapture();
      if (failureSent) throw new Error("Unsupported capture sample rate");
      if (lifetime.signal.aborted) {
        await cleanup("STOPPED");
        throw new DOMException("Cancelled", "AbortError");
      }
      health.state = "CAPTURING";
      health.microphone_active = true;
      return session;
    } catch (error) {
      const cancelled =
        error instanceof DOMException && error.name === "AbortError";
      if (!cancelled && !failureSent)
        failOnce(
          error instanceof Error && /sample/i.test(error.message)
            ? "UNSUPPORTED_SAMPLE_RATE"
            : "CAPTURE_FAILED",
          error instanceof Error ? error.message : "Microphone capture failed",
        );
      await cleanup(cancelled ? "STOPPED" : "FAILED");
      throw error;
    }
  }
}
