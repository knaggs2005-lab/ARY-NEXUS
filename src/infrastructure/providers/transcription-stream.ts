/** OpenAI file-transcription SSE, with bounded partials and authoritative final text. */
export async function readTranscriptionStream(
  response: Response,
  onDelta: (text: string) => void,
  signal?: AbortSignal,
) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Missing transcription stream");
  const decoder = new TextDecoder();
  let buffer = "",
    length = 0;
  let final: string | undefined;
  const consume = (frame: string) => {
    const data = frame
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data || data === "[DONE]") return;
    const event = JSON.parse(data);
    if (event.type === "error") throw new Error("Transcription stream failed");
    if (event.type === "transcript.text.delta") {
      if (
        final !== undefined ||
        typeof event.delta !== "string" ||
        (length += event.delta.length) > 10000
      )
        throw new Error("Invalid transcription delta");
      onDelta(event.delta);
    }
    if (event.type === "transcript.text.done") {
      if (
        final !== undefined ||
        typeof event.text !== "string" ||
        event.text.length > 10000
      )
        throw new Error("Invalid transcription result");
      final = event.text;
    }
  };
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    for (;;) {
      signal?.throwIfAborted();
      const { value, done } = await reader.read();
      signal?.throwIfAborted();
      buffer += done
        ? decoder.decode()
        : decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, "\n");
      let boundary: number;
      while ((boundary = buffer.indexOf("\n\n")) >= 0) {
        if (boundary > 65536) throw new Error("Oversized transcription frame");
        consume(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
      }
      if (buffer.length > 65536)
        throw new Error("Oversized transcription frame");
      if (done) break;
    }
    if (buffer.trim()) consume(buffer);
    if (final === undefined) throw new Error("Incomplete transcription stream");
    return { text: final };
  } finally {
    signal?.removeEventListener("abort", abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
