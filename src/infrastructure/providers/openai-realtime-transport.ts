import WebSocket from "ws";
import type { OpenAIRealtimeTransport } from "./openai-realtime";
type Event = { type: string; [key: string]: unknown };
export class OpenAIRealtimeWebSocketTransport implements OpenAIRealtimeTransport {
  private socket: WebSocket | null = null;
  private closed = false;
  private providerError: string | null = null;
  private diagnostics = {
    socket_opened: false,
    session_created: false,
    session_update_sent: false,
    close_code: null as number | null,
    close_reason: "",
    last_event_type: "",
  };
  getDiagnostics() {
    return { ...this.diagnostics };
  }
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
      ws.on("open", () => {
        this.diagnostics.socket_opened = true;
      });
      ws.on("message", (raw) => {
        let event: Event;
        try {
          event = JSON.parse(String(raw));
          this.diagnostics.last_event_type = event.type;
        } catch {
          fail("PROTOCOL_ERROR");
          return;
        }
        onEvent(event);
        if (event.type === "error") {
          const err = event.error as
            { code?: string; message?: string } | undefined;
          this.providerError = `${err?.code ?? "PROVIDER_ERROR"}: ${String(
            err?.message ?? "Provider rejected request",
          )
            .replace(/(?:Bearer|sk-)[^\s]+/gi, "[redacted]")
            .slice(0, 240)}`;
        }
        if (event.type === "session.created") {
          this.diagnostics.session_created = true;
          ready = true;
          clearTimeout(timer);
          this.diagnostics.session_update_sent = true;
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
      ws.on("close", (code, reason) => {
        this.diagnostics.close_code = code;
        this.diagnostics.close_reason = String(reason)
          .replace(/[\x00-\x1f\x7f]/g, "")
          .slice(0, 240);
        if (!ready)
          fail(
            this.providerError
              ? this.providerError.startsWith("invalid_model")
                ? `MODEL_UNAVAILABLE ${this.providerError}`
                : `PROVIDER_UNAVAILABLE ${this.providerError}`
              : `CONNECTION_CLOSED code=${code} reason=${String(reason).slice(0, 240)}`,
          );
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
