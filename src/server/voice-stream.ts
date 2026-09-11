import type { ActionService } from "../services/action-service";
import type { VoiceService } from "../services/voice-service";
import { AppError } from "../domain/validation";

/** Partials are ephemeral; only emit completion after ActionService finishes its audit. */
export async function transcriptionResponse(
  actions: ActionService,
  voice: VoiceService,
  audio: Blob,
  requestSignal: AbortSignal,
) {
  const cancellation = new AbortController();
  const signal = AbortSignal.any([requestSignal, cancellation.signal]);
  const encoder = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(value) {
      controller = value;
    },
    cancel() {
      cancellation.abort();
    },
  });
  let begin!: () => void, fail!: (error: unknown) => void;
  const authorized = new Promise<void>((resolve, reject) => {
    begin = resolve;
    fail = reject;
  });
  const start = performance.now();
  let firstText: number | null = null;
  const send = (event: unknown) => {
    if (signal.aborted) return;
    try {
      controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
    } catch {
      cancellation.abort();
    }
  };
  const work = actions
    .run("voice.transcribe", null, () => {
      signal.throwIfAborted();
      begin();
      return voice.transcribe(audio, signal, (text) => {
        firstText ??= Math.round(performance.now() - start);
        send({ type: "delta", text });
      });
    })
    .then((result) => {
      send({ type: "complete", text: result.text });
    })
    .catch((error: unknown) => {
      fail(error);
      send({
        type: "error",
        error:
          error instanceof AppError
            ? error.message
            : "Transcription failed. Please try again.",
      });
    })
    .finally(() => {
      console.info(
        JSON.stringify({
          event: "ary.transcription_latency",
          first_text_ms: firstText,
          total_ms: Math.round(performance.now() - start),
          cancelled: signal.aborted,
        }),
      );
      try {
        controller.close();
      } catch {
        /* disconnected */
      }
    });
  // Preserve existing HTTP errors/approval handling before any provider work.
  await authorized;
  void work; // Stream owns the operation; cancellation aborts upstream, audit is awaited above.
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-store, no-transform",
      "X-Content-Type-Options": "nosniff",
      "X-Accel-Buffering": "no",
    },
  });
}
