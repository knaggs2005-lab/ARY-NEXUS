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
    session_updated: false,
    provider_error: null as string | null,
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
    private milestone: (name: string) => void = () => {},
  ) {
    if (!apiKey) throw new Error("AUTHENTICATION_FAILED");
    if (!model) throw new Error("MODEL_UNAVAILABLE");
  }
  async connect(onEvent: (event: Event) => void) {
    await new Promise<void>((resolve, reject) => {
      let ready = false;
      let failed = false;
      let timer: ReturnType<typeof setTimeout>;
      const fail = (code: string) => {
        if (failed || ready) return;
        failed = true;
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
        this.milestone("SOCKET_OPEN");
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
        if (failed) return;
        if (event.type === "error") {
          const err = event.error as
            { code?: string; message?: string } | undefined;
          this.providerError = this.sanitize(
            `${err?.code ?? "PROVIDER_ERROR"}: ${err?.message ?? "Provider rejected request"}`,
          );
          this.diagnostics.provider_error = this.providerError;
          onEvent({
            type: "error",
            error: {
              code: this.sanitize(err?.code ?? "PROVIDER_ERROR"),
              message: this.providerError,
            },
          });
          if (!ready) fail(this.providerError);
          return;
        }
        if (event.type === "session.created") {
          if (this.diagnostics.session_created) return;
          this.diagnostics.session_created = true;
          this.milestone("SESSION_CREATED");
          onEvent(event);
          try {
            this.send({
              type: "session.update",
              session: {
                type: "realtime",
                model: this.model,
                output_modalities: ["audio"],
                audio: {
                  input: {
                    format: { type: "audio/pcm", rate: 24000 },
                    turn_detection: { type: "server_vad" },
                  },
                  output: {
                    format: { type: "audio/pcm", rate: 24000 },
                    voice:
                      process.env.OPENAI_REALTIME_VOICE ||
                      process.env.OPENAI_TTS_VOICE ||
                      "marin",
                  },
                },
                tools: [],
              },
            });
            this.diagnostics.session_update_sent = true;
            this.milestone("SESSION_UPDATE_SENT");
          } catch {
            fail("CONNECTION_CLOSED");
          }
          return;
        }
        if (event.type === "session.updated" && !ready) {
          if (!this.diagnostics.session_update_sent) {
            fail("PROTOCOL_ERROR");
            return;
          }
          this.diagnostics.session_updated = true;
          ready = true;
          clearTimeout(timer);
          this.milestone("SESSION_UPDATED");
          onEvent(event);
          resolve();
          return;
        }
        onEvent(event);
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
        this.diagnostics.close_reason = this.sanitize(String(reason));
        if (!ready)
          fail(
            this.providerError
              ? this.providerError.startsWith("invalid_model")
                ? `MODEL_UNAVAILABLE ${this.providerError}`
                : `PROVIDER_UNAVAILABLE ${this.providerError}`
              : `CONNECTION_CLOSED code=${code} reason=${this.diagnostics.close_reason}`,
          );
        else onEvent({ type: "connection.closed" });
      });
    });
  }
  private sanitize(value: string) {
    return value
      .split(this.apiKey)
      .join("[redacted]")
      .replace(/Bearer\s+[^\s]+|sk-[^\s]+/gi, "[redacted]")
      .replace(/[\x00-\x1f\x7f]/g, "")
      .slice(0, 240);
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
