import {
  relayOutput,
  outputFrame,
  type RelayOutput,
} from "../../domain/realtime-output";
import type { RelayRequest } from "./realtime-mic-relay-client";
import type { RealtimePlayback } from "./realtime-playback";

export class RealtimeOutputClient {
  private abort = new AbortController();
  private reader?: ReadableStreamDefaultReader<Uint8Array>;
  private ending = false;
  private sequence = 0;
  private task?: Promise<void>;
  constructor(
    private readonly request: RelayRequest,
    private readonly playback: RealtimePlayback,
    private readonly failure: (code: string) => void,
    private readonly event: (event: RelayOutput) => void = () => {},
  ) {}
  async open(id: string) {
    const response = await this.request(`realtime/session/${id}/output`, {
      method: "POST",
      signal: this.abort.signal,
    });
    if (!response.ok || !response.body) throw new Error("OUTPUT_UNAVAILABLE");
    this.reader = response.body.getReader();
    let ready!: () => void, reject!: (error: Error) => void;
    const connected = new Promise<void>((yes, no) => {
      ready = yes;
      reject = no;
    });
    const timer = setTimeout(() => {
      reject(new Error("OUTPUT_TIMEOUT"));
      this.abort.abort();
    }, 5000);
    this.task = this.consume(ready)
      .catch(() => {
        reject(new Error("OUTPUT_FAILED"));
        if (!this.ending) this.failure("OUTPUT_FAILED");
      })
      .finally(() => clearTimeout(timer));
    await connected;
    clearTimeout(timer);
  }
  private async consume(ready: () => void) {
    const decoder = new TextDecoder();
    let pending = "",
      connected = false;
    while (!this.ending) {
      const part = await this.reader!.read();
      if (part.done) {
        if (!this.ending) throw new Error("OUTPUT_DISCONNECTED");
        break;
      }
      if (part.value.length > 1048576) throw new Error("OUTPUT_TOO_LARGE");
      pending += decoder.decode(part.value, { stream: true });
      let newline: number;
      while ((newline = pending.indexOf("\n")) >= 0) {
        if (newline > 66000) throw new Error("OUTPUT_TOO_LARGE");
        const event = relayOutput.parse(JSON.parse(pending.slice(0, newline)));
        pending = pending.slice(newline + 1);
        if (event.type === "ready") {
          if (connected) throw new Error("DUPLICATE_READY");
          connected = true;
          ready();
        } else if (!connected) throw new Error("OUTPUT_NOT_READY");
        else if (event.type === "audio") {
          if (event.sequence !== this.sequence++)
            throw new Error("OUTPUT_ORDER");
          this.playback.accept(outputFrame(event));
        } else if (event.type === "interrupted") this.playback.stop();
        else if (event.type === "closed") {
          this.ending = true;
          await this.playback.close();
        }
        this.event(event);
      }
      if (pending.length > 66000) throw new Error("OUTPUT_TOO_LARGE");
    }
  }
  async close() {
    this.ending = true;
    this.abort.abort();
    await this.reader?.cancel().catch(() => {});
    await this.task;
    await this.playback.close();
  }
}
