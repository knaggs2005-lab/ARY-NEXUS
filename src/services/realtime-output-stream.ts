import type { RealtimeVoiceEvent } from "../domain/realtime-voice";
import type { RelayOutput } from "../domain/realtime-output";
import { AppError } from "../domain/validation";

/** One transient, bounded subscriber. Never a repository or replay log. */
export class RealtimeOutputStream {
  private controller?: ReadableStreamDefaultController<Uint8Array>;
  private claimed = false;
  private terminal = false;
  private sequence = 0;
  private detachAbort?: () => void;
  constructor(private readonly disconnect: () => void) {}
  open(signal: AbortSignal) {
    if (this.claimed || this.terminal || signal.aborted)
      throw new AppError("Output unavailable", 409);
    this.claimed = true;
    const stream = new ReadableStream<Uint8Array>(
      {
        start: (controller) => {
          this.controller = controller;
          const abort = () => this.fail();
          signal.addEventListener("abort", abort, { once: true });
          this.detachAbort = () => signal.removeEventListener("abort", abort);
          this.send({ type: "ready" });
        },
        cancel: () => this.fail(),
      },
      { highWaterMark: 96000, size: (chunk) => chunk.byteLength },
    );
    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson",
        "Cache-Control": "no-store, no-transform",
        "X-Accel-Buffering": "no",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
  publish(event: RealtimeVoiceEvent) {
    if (!this.controller || this.terminal) return;
    if (event.type === "assistant_audio_delta") {
      const f = event.frame;
      const data =
        f.data instanceof Uint8Array ? f.data : new Uint8Array(f.data);
      if (
        f.encoding !== "pcm16" ||
        f.channels !== 1 ||
        f.sample_rate_hz !== 24000 ||
        !data.length ||
        data.length % 2 ||
        data.length > 48000
      )
        return this.fail();
      this.send({
        type: "audio",
        sequence: this.sequence++,
        turn_id: event.turn_id,
        encoding: "pcm16",
        sample_rate_hz: 24000,
        channels: 1,
        audio: Buffer.from(data).toString("base64"),
      });
    } else if (event.type === "state")
      this.send({ type: "state", state: event.state });
    else if (event.type === "interruption")
      this.send({
        type: "interrupted",
        turn_id: event.interruption.turn_id,
        cancel_external_effect: false,
      });
  }
  private send(event: RelayOutput) {
    if (!this.controller || this.terminal) return;
    const bytes = new TextEncoder().encode(JSON.stringify(event) + "\n");
    if ((this.controller.desiredSize ?? 0) < bytes.length) return this.fail();
    this.controller.enqueue(bytes);
  }
  private fail() {
    if (this.terminal) return;
    this.terminal = true;
    this.detachAbort?.();
    try {
      this.controller?.error(new Error("OUTPUT_DISCONNECTED_OR_OVERFLOW"));
    } catch {}
    this.controller = undefined;
    this.disconnect();
  }
  close() {
    if (this.terminal) return;
    this.send({ type: "closed" });
    this.terminal = true;
    this.detachAbort?.();
    try {
      this.controller?.close();
    } catch {}
    this.controller = undefined;
  }
}
