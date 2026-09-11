import type {
  SpeechToTextProvider,
  TextToSpeechProvider,
} from "../../domain/voice";
import { OpenAIProviderError } from "./openai";
import { AppError } from "../../domain/validation";
import { readTranscriptionStream } from "./transcription-stream";

async function audioRequest(
  path: string,
  body: BodyInit,
  signal?: AbortSignal,
) {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) throw new OpenAIProviderError("missing_api_key", 503);
  const response = await fetch(`https://api.openai.com/v1/audio/${path}`, {
    method: "POST",
    body,
    headers: {
      Authorization: `Bearer ${key}`,
      ...(typeof body === "string"
        ? { "Content-Type": "application/json" }
        : {}),
      ...(process.env.OPENAI_PROJECT_ID
        ? { "OpenAI-Project": process.env.OPENAI_PROJECT_ID }
        : {}),
      ...(process.env.OPENAI_ORGANIZATION_ID
        ? { "OpenAI-Organization": process.env.OPENAI_ORGANIZATION_ID }
        : {}),
    },
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(45000)])
      : AbortSignal.timeout(45000),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    if (response.status === 403 && payload?.error?.code === "model_not_found")
      throw new AppError(
        "The configured speech model is not allowed in this OpenAI project. Enable it under Project settings → Limits → Allowed models.",
        503,
      );
    throw new OpenAIProviderError(`audio_http_${response.status}`);
  }
  return response;
}
export class OpenAISpeechToText implements SpeechToTextProvider {
  readonly id = "openai";
  constructor(
    readonly model = process.env.OPENAI_STT_MODEL || "gpt-4o-mini-transcribe",
  ) {}
  async transcribe(
    audio: Blob,
    signal?: AbortSignal,
    onDelta?: (text: string) => void,
  ) {
    const ext = audio.type.includes("mp4")
      ? "mp4"
      : audio.type.includes("wav")
        ? "wav"
        : audio.type.includes("mpeg")
          ? "mp3"
          : audio.type.includes("ogg")
            ? "ogg"
            : "webm";
    const form = new FormData();
    form.set("model", this.model);
    form.set("file", audio, `recording.${ext}`);
    if (onDelta) form.set("stream", "true");
    const response = await audioRequest("transcriptions", form, signal);
    const result = onDelta
      ? await readTranscriptionStream(response, onDelta, signal)
      : await response.json();
    if (typeof result.text !== "string" || result.text.length > 10000)
      throw new OpenAIProviderError("invalid_transcription");
    return { text: result.text.trim() };
  }
}
export class OpenAITextToSpeech implements TextToSpeechProvider {
  readonly id = "openai";
  constructor(
    readonly model = process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts",
    private voice = process.env.OPENAI_TTS_VOICE || "marin",
  ) {}
  async synthesize(text: string, signal?: AbortSignal) {
    return (
      await audioRequest(
        "speech",
        JSON.stringify({
          model: this.model,
          voice: this.voice,
          input: text,
          response_format: "mp3",
        }),
        signal,
      )
    ).blob();
  }
}
