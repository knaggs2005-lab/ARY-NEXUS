/** Server-side speech ports. Audio is ephemeral; only confirmed text enters Ary Brain. */
export interface SpeechToTextProvider {
  readonly id: string;
  readonly model: string;
  transcribe(
    audio: Blob,
    signal?: AbortSignal,
    onDelta?: (text: string) => void,
  ): Promise<{ text: string }>;
}
export interface TextToSpeechProvider {
  readonly id: string;
  readonly model: string;
  synthesize(text: string, signal?: AbortSignal): Promise<Blob>;
}
export interface ReasoningOptions {
  signal?: AbortSignal;
  onDelta?: (text: string) => void;
}
export const VOICE_MAX_BYTES = 5 * 1024 * 1024;
export const VOICE_MAX_SECONDS = 60;
