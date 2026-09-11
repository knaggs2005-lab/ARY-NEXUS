import { actionCancellation } from "./action-cancellation";
function cancellation(signal?: AbortSignal) {
  const owner = actionCancellation.getStore();
  return owner ? AbortSignal.any([owner, ...(signal ? [signal] : [])]) : signal;
}
import type {
  SpeechToTextProvider,
  TextToSpeechProvider,
} from "../domain/voice";
import { VOICE_MAX_BYTES } from "../domain/voice";
import { AppError } from "../domain/validation";
import type { Telemetry } from "../domain/telemetry";
export class VoiceService {
  constructor(
    private stt: SpeechToTextProvider,
    private tts: TextToSpeechProvider,
    private telemetry: Telemetry,
  ) {}
  describe() {
    return {
      stt: { provider: this.stt.id, model: this.stt.model },
      tts: { provider: this.tts.id, model: this.tts.model },
    };
  }
  private async measure<T>(
    operation: string,
    model: string,
    work: () => Promise<T>,
  ) {
    const start = performance.now();
    let succeeded = false;
    try {
      const result = await work();
      succeeded = true;
      return result;
    } finally {
      await this.telemetry({
        operation,
        model,
        latency_ms: Math.round(performance.now() - start),
        input_tokens: null,
        cached_input_tokens: null,
        output_tokens: null,
        estimated_cost_usd: null,
        pricing_version: "audio-usage-unavailable",
        retrieval_count: 0,
        memories_extracted: null,
        status: succeeded ? "succeeded" : "failed",
        error_code: succeeded ? null : "audio_request_failed",
      });
    }
  }
  transcribe(
    audio: Blob,
    signal?: AbortSignal,
    onDelta?: (text: string) => void,
  ) {
    if (!audio.size || audio.size > VOICE_MAX_BYTES)
      throw new AppError("Recording must be between 1 byte and 5 MB", 413);
    if (!/^audio\/(webm|mp4|mpeg|wav|x-wav|ogg)(;|$)/i.test(audio.type))
      throw new AppError("Unsupported recording format", 415);
    return this.measure("transcribe", this.stt.model, () =>
      this.stt.transcribe(audio, cancellation(signal), onDelta),
    );
  }
  synthesize(text: string, signal?: AbortSignal) {
    if (!text.trim() || text.length > 700)
      throw new AppError("Speech segment must contain 1–700 characters");
    return this.measure("speak", this.tts.model, () =>
      this.tts.synthesize(text, cancellation(signal)),
    );
  }
}
