/** Provider-neutral transport. Partial text is never returned as a final transcript. */
export async function readTranscript(
  response: Response,
  onPartial: (text: string) => void,
  signal: AbortSignal,
) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Missing transcript response");
  const decoder = new TextDecoder();
  let buffer = "",
    partial = "";
  let final: string | undefined;
  const consume = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line);
    if (event.type === "error")
      throw new Error(
        typeof event.error === "string" ? event.error : "Transcription failed",
      );
    if (event.type === "delta") {
      if (
        final !== undefined ||
        typeof event.text !== "string" ||
        partial.length + event.text.length > 10000
      )
        throw new Error("Invalid partial transcript");
      partial += event.text;
      onPartial(partial);
    } else if (event.type === "complete") {
      if (
        final !== undefined ||
        typeof event.text !== "string" ||
        event.text.length > 10000
      )
        throw new Error("Invalid final transcript");
      final = event.text;
    }
  };
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    for (;;) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      signal.throwIfAborted();
      buffer += done
        ? decoder.decode()
        : decoder.decode(value, { stream: true });
      let end: number;
      while ((end = buffer.indexOf("\n")) >= 0) {
        if (end > 65536) throw new Error("Oversized transcript response");
        consume(buffer.slice(0, end));
        buffer = buffer.slice(end + 1);
      }
      if (buffer.length > 65536)
        throw new Error("Oversized transcript response");
      if (done) break;
    }
    if (buffer.trim()) consume(buffer);
    if (final === undefined)
      throw new Error("Transcript connection ended early. Please try again.");
    return { text: final };
  } finally {
    signal.removeEventListener("abort", abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
