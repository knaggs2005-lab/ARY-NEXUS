/** Browser speech ports: tests and alternative transports need no OpenAI knowledge. */
export interface SpeechOutput {
  synthesize(text: string, signal: AbortSignal): Promise<Blob>;
  play(audio: Blob, signal: AbortSignal): Promise<void>;
}
export function takeSpeechSegments(buffer: string, flush = false) {
  const segments: string[] = [];
  while (buffer.length) {
    const boundary = /[.!?](?:[\s\n]|$)/.exec(buffer);
    let end = boundary ? boundary.index + boundary[0].length : 0;
    if (!end && buffer.length >= 500)
      end =
        buffer.lastIndexOf(" ", 500) > 0 ? buffer.lastIndexOf(" ", 500) : 500;
    if (!end && flush) end = buffer.length;
    if (!end) break;
    end = Math.min(end, 600);
    const text = buffer
      .slice(0, end)
      .replace(/\[\d+\]/g, "")
      .replace(/[*#`]/g, "")
      .trim();
    if (text) segments.push(text);
    buffer = buffer.slice(end);
  }
  return { segments, rest: buffer };
}
/** Prefetch one segment ahead of playback. Abort invalidates all queued and late audio. */
export class SpeechQueue {
  private controller = new AbortController();
  private pending: string[] = [];
  private buffer = "";
  private running = false;
  private accepted = 0;
  private prefetched: Promise<{ blob: Blob | null; error: unknown }> | null =
    null;
  private prefetch() {
    if (this.prefetched || this.controller.signal.aborted) return;
    let text = this.pending.shift();
    if (!text) return;
    // Keep already-available sentences in one utterance. Separate synthesis
    // calls can vary in delivery even with the same configured voice.
    // Never wait for more text: the first streamed sentence still starts early.
    while (
      this.pending.length &&
      text.length + 1 + this.pending[0].length <= 600
    ) {
      text += ` ${this.pending.shift()!}`;
    }
    try {
      this.prefetched = this.output
        .synthesize(text, this.controller.signal)
        .then(
          (blob) => ({ blob, error: null }),
          (error) => ({ blob: null, error }),
        );
    } catch (error) {
      this.prefetched = Promise.resolve({ blob: null, error });
    }
  }

  constructor(
    private output: SpeechOutput,
    private state: (state: "idle" | "buffering" | "speaking") => void,
    private error: (error: Error) => void,
  ) {}
  add(delta: string, flush = false) {
    if (this.controller.signal.aborted) return;
    const room = Math.max(0, 10000 - this.accepted);
    this.buffer += delta.slice(0, room);
    this.accepted += Math.min(room, delta.length);
    const next = takeSpeechSegments(this.buffer, flush);
    this.buffer = next.rest;
    this.pending.push(...next.segments);
    this.prefetch();
    void this.drain();
  }
  stop() {
    this.controller.abort();
    this.pending = [];
    this.buffer = "";
    this.prefetched = null;
    this.state("idle");
  }
  private async drain() {
    if (this.running || !this.prefetched || this.controller.signal.aborted)
      return;
    this.running = true;
    const signal = this.controller.signal;
    try {
      while (this.prefetched && !signal.aborted) {
        const next = this.prefetched;
        this.prefetched = null;
        this.state("buffering");
        const result = await next;
        signal.throwIfAborted();
        if (result.error || !result.blob)
          throw result.error ?? new Error("Empty speech audio");
        this.prefetch();
        this.state("speaking");
        await this.output.play(result.blob, signal);
        this.prefetch();
      }
    } catch (error) {
      if (!signal.aborted) {
        this.stop();
        this.error(error instanceof Error ? error : new Error("Speech failed"));
      }
    } finally {
      this.running = false;
      if (!signal.aborted) this.state("idle");
    }
  }
}
export function playBrowserAudio(
  blob: Blob,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    function cleanup() {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      URL.revokeObjectURL(url);
      signal.removeEventListener("abort", abort);
    }
    function abort() {
      cleanup();
      reject(new DOMException("Stopped", "AbortError"));
    }
    signal.addEventListener("abort", abort, { once: true });
    audio.onended = () => {
      cleanup();
      resolve();
    };
    audio.onerror = () => {
      cleanup();
      reject(
        new Error(
          "Audio could not play. Check your browser’s audio permission.",
        ),
      );
    };
    void audio.play().catch(() => {
      cleanup();
      reject(
        new Error("Your browser blocked audio. Use Read aloud to try again."),
      );
    });
  });
}
