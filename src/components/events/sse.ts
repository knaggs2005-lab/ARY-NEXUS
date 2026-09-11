/** Incremental SSE framing; comments are transport heartbeats, never activity. */
export class SseDecoder {
  private buffer = "";
  push(text: string) {
    this.buffer = (this.buffer + text).replace(/\r\n/g, "\n");
    if (this.buffer.length > 2_000_000)
      throw Error("Event stream frame exceeded limit");
    const frames = this.buffer.split("\n\n");
    this.buffer = frames.pop()!;
    return frames.flatMap((frame) => {
      let event = "message";
      const data: string[] = [];
      for (const line of frame.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
      }
      return data.length ? [{ event, data: data.join("\n") }] : [];
    });
  }
}
