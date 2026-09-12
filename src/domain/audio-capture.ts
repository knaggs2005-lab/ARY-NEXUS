import type { RealtimeVoiceAudioFrame } from "./realtime-voice";
export type AudioCaptureState =
  "STOPPED" | "STARTING" | "CAPTURING" | "PAUSED" | "FAILED";
export interface AudioCaptureConfig {
  readonly targetSampleRateHz?: number;
  readonly frameDurationMs?: number;
}
export interface AudioCaptureFrame extends RealtimeVoiceAudioFrame {
  readonly frame_index: number;
}
export interface AudioCaptureFailure {
  readonly code: string;
  readonly message: string;
}
export interface AudioCaptureHealth {
  readonly state: AudioCaptureState;
  readonly sample_rate_hz: number;
  readonly channels: 1;
  readonly frame_count: number;
  readonly reason?: string;
}
export interface AudioCaptureSession {
  readonly health: AudioCaptureHealth;
  pause(): void;
  resume(): void;
  stop(): Promise<void>;
}
export interface AudioCaptureProvider {
  start(
    config: AudioCaptureConfig,
    onFrame: (frame: AudioCaptureFrame) => void,
    onFailure: (failure: AudioCaptureFailure) => void,
  ): Promise<AudioCaptureSession>;
}
export function float32ToPcm16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const v = Number.isFinite(input[i])
      ? Math.max(-1, Math.min(1, input[i]))
      : 0;
    out[i] = v < 0 ? Math.round(v * 32768) : Math.round(v * 32767);
  }
  return out;
}
export function resampleMono(
  input: Float32Array,
  fromRate: number,
  toRate: number,
): Float32Array {
  if (fromRate === toRate) return new Float32Array(input);
  const n = Math.max(1, Math.round((input.length * toRate) / fromRate));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = (i * fromRate) / toRate,
      a = Math.floor(p),
      b = Math.min(input.length - 1, a + 1),
      t = p - a;
    out[i] = (input[a] ?? 0) * (1 - t) + (input[b] ?? 0) * t;
  }
  return out;
}
