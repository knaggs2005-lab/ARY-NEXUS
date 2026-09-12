import type { SpeakerVerificationProvider } from "../../domain/owner-voice";
/** A calibrated, licensed WeSpeaker ONNX frontend/model has not been packaged. */
export class LocalSpeakerVerificationProvider implements SpeakerVerificationProvider {
  readonly id = "wespeaker-local";
  readonly version = "unconfigured";
  readonly modelHash = "";
  readonly localOnly = true as const;
  available() {
    return false;
  }
  async embed(
    _samples: Float32Array,
    _sampleRate: 16000,
  ): Promise<Float32Array> {
    throw new Error("SPEAKER_MODEL_SETUP_REQUIRED");
  }
}
