import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("ws", async () => {
  const { EventEmitter } = await import("node:events");
  class Socket extends EventEmitter {
    static OPEN = 1;
    static latest: Socket;
    readyState = 1;
    sent: any[] = [];
    constructor() {
      super();
      Socket.latest = this;
    }
    send(value: string) {
      this.sent.push(JSON.parse(value));
    }
    close() {}
  }
  return { default: Socket };
});
import WebSocket from "ws";
import { OpenAIRealtimeWebSocketTransport } from "../src/infrastructure/providers/openai-realtime-transport";
function setup() {
  const transport = new OpenAIRealtimeWebSocketTransport(
    "sk-fixture-secret",
    "fixture-model",
    undefined,
    100,
  );
  const connected = transport.connect(() => {});
  const socket = (WebSocket as any).latest;
  const emit = (type: string, extra = {}) =>
    socket.emit("message", JSON.stringify({ type, ...extra }));
  return { transport, connected, socket, emit };
}
afterEach(() => vi.useRealTimers());
describe("current realtime handshake", () => {
  it("waits through created and sends exactly one current configuration", async () => {
    const { transport, connected, socket, emit } = setup();
    let ready = false;
    void connected.then(() => {
      ready = true;
    });
    socket.emit("open");
    await Promise.resolve();
    expect(ready).toBe(false);
    emit("session.created");
    emit("session.created");
    await Promise.resolve();
    expect(ready).toBe(false);
    expect(socket.sent).toEqual([
      {
        type: "session.update",
        session: {
          type: "realtime",
          model: "fixture-model",
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
      },
    ]);
    for (const field of [
      "modalities",
      "input_audio_format",
      "output_audio_format",
      "turn_detection",
    ])
      expect(socket.sent[0].session).not.toHaveProperty(field);
    emit("session.updated");
    await connected;
    expect(transport.getDiagnostics().session_updated).toBe(true);
    await transport.close();
  });
  it("rejects sanitized provider errors before accepted update", async () => {
    const { transport, connected, socket, emit } = setup();
    const rejection = expect(connected).rejects.toThrow("unknown_parameter");
    emit("session.created");
    emit("error", {
      error: {
        code: "unknown_parameter",
        message: "bad sk-fixture-secret Bearer private-value",
      },
    });
    socket.emit("close", 4000, Buffer.from("sk-fixture-secret"));
    await rejection;
    expect(JSON.stringify(transport.getDiagnostics())).not.toContain(
      "sk-fixture-secret",
    );
    expect(JSON.stringify(transport.getDiagnostics())).not.toContain(
      "private-value",
    );
    expect(transport.getDiagnostics().provider_error).toContain(
      "unknown_parameter",
    );
  });
  it("rejects close before session.updated with sanitized evidence", async () => {
    const { transport, connected, socket, emit } = setup();
    const rejection = expect(connected).rejects.toThrow(
      "CONNECTION_CLOSED code=4000 reason=reason",
    );
    emit("session.created");
    socket.emit("close", 4000, Buffer.from("reason"));
    await rejection;
    expect(transport.getDiagnostics().close_code).toBe(4000);
  });
  it("times out while awaiting session.updated", async () => {
    vi.useFakeTimers();
    const { connected, emit } = setup();
    const rejection = expect(connected).rejects.toThrow("HANDSHAKE_TIMEOUT");
    emit("session.created");
    await vi.advanceTimersByTimeAsync(100);
    await rejection;
  });
});
