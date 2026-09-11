import type { ReasoningOptions } from "../../domain/voice";
/** Incremental SSE decoder: tolerates split UTF-8 and CRLF. Requires an authoritative final response. */
export async function readResponseStream(
  response: Response,
  options: ReasoningOptions,
) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Missing response stream");
  const decoder = new TextDecoder();
  let buffer = "";
  let final: unknown;
  function consume(frame: string) {
    const data = frame
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data || data === "[DONE]") return;
    const event = JSON.parse(data);
    if (
      event.type === "response.output_text.delta" &&
      typeof event.delta === "string"
    )
      options.onDelta?.(event.delta);
    if (event.type === "response.completed") final = event.response;
    if (
      ["error", "response.failed", "response.incomplete"].includes(event.type)
    )
      throw new Error("Reasoning stream failed");
  }
  try {
    for (;;) {
      options.signal?.throwIfAborted();
      const { value, done } = await reader.read();
      buffer += done
        ? decoder.decode()
        : decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, "\n");
      let boundary: number;
      while ((boundary = buffer.indexOf("\n\n")) >= 0) {
        consume(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
      }
      if (done) break;
      if (buffer.length > 1024 * 1024)
        throw new Error("Oversized stream frame");
    }
    if (buffer.trim()) consume(buffer);
    if (!final) throw new Error("Incomplete response stream");
    return final;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
