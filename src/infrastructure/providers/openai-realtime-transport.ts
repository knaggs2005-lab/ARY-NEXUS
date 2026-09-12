import type { OpenAIRealtimeTransport } from "./openai-realtime";
type Event = { type: string; [key: string]: unknown };
export class OpenAIRealtimeWebSocketTransport implements OpenAIRealtimeTransport {
  private socket: WebSocket | null = null;
  private closed = false;
  constructor(
    private apiKey: string,
    private model: string,
    private endpoint = `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`,
  ) {
    if (!apiKey) throw new Error("OpenAI realtime API key is missing");
    if (!model) throw new Error("OpenAI realtime model is missing");
  }
  async connect(onEvent: (event: Event) => void) {
    if (typeof WebSocket === "undefined")
      throw new Error("WebSocket runtime unavailable");
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(this.endpoint, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      } as any);
      this.socket = ws;
      ws.onopen = () => {
        this.send({
          type: "session.update",
          session: {
            type: "realtime",
            modalities: ["text", "audio"],
            input_audio_format: "pcm16",
            output_audio_format: "pcm16",
            turn_detection: { type: "server_vad" },
            tools: [],
          },
        });
        resolve();
      };
      ws.onmessage = (m) => {
        try {
          onEvent(JSON.parse(String(m.data)));
        } catch {
          onEvent({
            type: "protocol.error",
            error: {
              code: "PROTOCOL_ERROR",
              message: "Provider sent invalid JSON",
            },
          });
        }
      };
      ws.onerror = () => reject(new Error("PROVIDER_UNAVAILABLE"));
      ws.onclose = () => {
        if (!this.closed) onEvent({ type: "connection.closed" });
      };
    });
  }
  send(command: { type: string; [key: string]: unknown }) {
    if (!this.socket || this.socket.readyState !== 1)
      throw new Error("CONNECTION_CLOSED");
    this.socket.send(JSON.stringify(command));
  }
  close() {
    if (this.closed) return Promise.resolve();
    this.closed = true;
    this.socket?.close();
    this.socket = null;
    return Promise.resolve();
  }
}
