import WebSocket from "ws";
import type { OpenAIRealtimeTransport } from "./openai-realtime";
type Event = { type: string; [key: string]: unknown };
export class OpenAIRealtimeWebSocketTransport implements OpenAIRealtimeTransport {
  private socket: WebSocket | null = null;
  private closed = false;
  constructor(
    private apiKey: string,
    private model: string,
    private endpoint = `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`,
    private timeoutMs = 10000,
  ) {
    if (!apiKey) throw new Error("AUTHENTICATION_FAILED");
    if (!model) throw new Error("MODEL_UNAVAILABLE");
  }
  async connect(onEvent: (event: Event) => void) {
    await new Promise<void>((resolve, reject) => {
      let ready = false;
      let timer: ReturnType<typeof setTimeout>;
      const fail = (code: string) => {
        clearTimeout(timer);
        this.socket?.close();
        reject(new Error(code));
      };
      timer = setTimeout(() => fail("HANDSHAKE_TIMEOUT"), this.timeoutMs);
      const ws = new WebSocket(this.endpoint, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      this.socket = ws;
      ws.on("open", () => {});
      ws.on("message", (raw) => {
        let event: Event;
        try {
          event = JSON.parse(String(raw));
        } catch {
          fail("PROTOCOL_ERROR");
          return;
        }
        onEvent(event);
        if (event.type === "session.created") {
          ready = true;
          clearTimeout(timer);
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
        }
      });
      ws.on("error", () => {
        if (!ready) fail("PROVIDER_UNAVAILABLE");
        else
          onEvent({
            type: "error",
            error: {
              code: "PROVIDER_UNAVAILABLE",
              message: "Realtime provider connection failed",
            },
          });
      });
      ws.on("close", () => {
        if (!ready) fail("CONNECTION_CLOSED");
        else onEvent({ type: "connection.closed" });
      });
    });
  }
  send(command: { type: string; [key: string]: unknown }) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN)
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
