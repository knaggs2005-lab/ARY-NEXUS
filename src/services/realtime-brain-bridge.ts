import type { AryBrainService } from "./ary-brain-service";
import type {
  RealtimeVoiceSession,
  RealtimeVoiceEvent,
} from "../domain/realtime-voice";
/** Adapts final speech turns to the ONE existing Brain. Owns no stores/tools/permissions. */
export class RealtimeBrainBridge {
  private seen = new Set<string>();
  private pending = 0;
  private generation = 0;
  private tail = Promise.resolve();
  private active?: AbortController;
  private closed = false;
  private off: () => void;
  constructor(
    private session: RealtimeVoiceSession,
    private brain: Pick<AryBrainService, "respond">,
    private conversationId: string,
    private publish: (event: RealtimeVoiceEvent) => void,
    private endSession?: () => void,
    private speech?: (text: string, signal: AbortSignal) => Promise<void>,
  ) {
    if (!session.speakText) throw new Error("CANONICAL_SPEECH_UNAVAILABLE");
    this.off = session.onEvent((event) => {
      if (event.type === "transcript_final")
        this.accept(event.turn_id, event.text);
      if (event.type === "speech_start" || event.type === "interruption") {
        this.generation++;
        this.active?.abort();
      }
      if (
        event.type === "failure" ||
        (event.type === "state" &&
          (event.state === "CLOSED" || event.state === "FAILED"))
      )
        this.close();
    });
  }
  private fail(code: string) {
    if (this.closed) return;
    this.publish({
      type: "failure",
      failure: {
        code,
        message: "Canonical voice turn failed",
        retryable: false,
      },
    });
    this.close();
  }
  private accept(id: string, text: string) {
    if (this.closed || this.seen.has(id)) return;
    if (
      !id ||
      id === "unknown" ||
      id.length > 200 ||
      !text.trim() ||
      text.length > 8000
    ) {
      this.fail("INVALID_FINAL_TRANSCRIPT");
      return;
    }
    if (this.seen.size >= 128 || this.pending >= 2) {
      this.fail("VOICE_TURN_LIMIT");
      return;
    }
    this.seen.add(id);
    // Only exact terminal utterances; arbitrary sentences containing 'stop' are not commands.
    if (
      this.endSession &&
      /^(?:ary[, ]+stop|go to sleep|that['’]s all)[.!?]*$/i.test(text.trim())
    ) {
      this.active?.abort();
      this.endSession();
      return;
    }
    this.active?.abort();
    const generation = ++this.generation;
    this.pending++;
    this.tail = this.tail
      .then(() => {
        if (generation === this.generation) return this.run(text);
      })
      .catch(() => this.fail("BRAIN_VOICE_FAILED"))
      .finally(() => {
        this.pending--;
      });
  }
  private async run(text: string) {
    if (this.closed) return;
    const abort = new AbortController();
    this.active = abort;
    const timer = setTimeout(() => {
      abort.abort();
      this.fail("BRAIN_VOICE_TIMEOUT");
    }, 45000);
    let canonical: string | undefined,
      failed = false;
    this.publish({ type: "state", state: "PROCESSING" });
    try {
      for await (const event of this.brain.respond(
        {
          input: text,
          conversation_id: this.conversationId,
          modality: "voice",
        },
        {
          signal: abort.signal,
          onPresence: (event) => {
            if (!this.closed && event.state)
              this.publish({ type: "state", state: "PROCESSING" });
          },
        },
      )) {
        if (event.type === "response") canonical = event.message.content;
        if (event.type === "error") failed = true;
        // Brain remains responsible for its delta/response/complete order, message writes and extraction.
      }
      if (this.closed || abort.signal.aborted) return;
      if (failed || !canonical?.trim()) {
        this.fail("BRAIN_VOICE_FAILED");
        return;
      }
      if (canonical.length > 4000) {
        this.fail("CANONICAL_SPEECH_TOO_LONG");
        return;
      }
      clearTimeout(timer); // Brain deadline ends here; speech has its own bounded per-fragment deadline.
      if (this.speech) await this.speech(canonical, abort.signal);
      else this.session.speakText!(canonical);
    } catch {
      if (!abort.signal.aborted && !this.closed)
        this.fail("BRAIN_VOICE_FAILED");
    } finally {
      clearTimeout(timer);
      if (this.active === abort) this.active = undefined;
    }
  }
  async idle() {
    await this.tail;
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.active?.abort();
    this.off();
  }
}
