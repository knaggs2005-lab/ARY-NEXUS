import type { RealtimeVoiceSession } from "../domain/realtime-voice";
/** Short canonical fragments + bounded server pacing. No model reasoning or tool access. */
export class RealtimeSpeechQueue {
  constructor(
    private session: RealtimeVoiceSession,
    private drained: () => Promise<void>,
  ) {}
  async speak(text: string, signal: AbortSignal) {
    const words = text.trim().split(/\s+/);
    const chunks: string[] = [];
    let chunk = "";
    for (const word of words) {
      if (word.length > 40) throw new Error("UNSPEAKABLE_FRAGMENT");
      if (chunk && chunk.length + word.length + 1 > 24) {
        chunks.push(chunk);
        chunk = "";
      }
      chunk += (chunk ? " " : "") + word;
    }
    if (chunk) chunks.push(chunk);
    for (const text of chunks) {
      if (signal.aborted) return;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let off = () => {};
      let abort = () => {};
      try {
        await new Promise<void>((resolve, reject) => {
          abort = () => resolve();
          signal.addEventListener("abort", abort, { once: true });
          off = this.session.onEvent((event) => {
            if (event.type === "failure")
              reject(new Error("SPEECH_PROVIDER_FAILED"));
            if (event.type === "state" && event.state === "CLOSED")
              reject(new Error("SPEECH_PROVIDER_CLOSED"));
            if (event.type === "state" && event.state === "IDLE") resolve();
          });
          timer = setTimeout(
            () => reject(new Error("SPEECH_FRAGMENT_TIMEOUT")),
            15000,
          );
          this.session.speakText!(text);
        });
        if (signal.aborted) return;
        await this.drained(); // provider generation and delivery both finish before the next fragment
      } finally {
        clearTimeout(timer);
        off();
        signal.removeEventListener("abort", abort);
      }
    }
  }
}
