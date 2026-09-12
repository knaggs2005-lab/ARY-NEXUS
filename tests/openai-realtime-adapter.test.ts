import { describe, expect, it } from "vitest";
import { OpenAIRealtimeSessionProvider } from "../src/infrastructure/providers/openai-realtime";
function transport() {
  let cb: (e: any) => void = () => {};
  const sent: any[] = [];
  return {
    connect: async (f: any) => {
      cb = f;
    },
    send: (x: any) => sent.push(x),
    close: async () => {},
    emit: (e: any) => cb(e),
    sent,
  };
}
const config = {
  user_id: "u",
  conversation_id: "c",
  classic_fallback_available: true,
};
function frame(
  data: ArrayBuffer | Uint8Array = Uint8Array.from([0, 1, 2, 255]),
) {
  return {
    encoding: "pcm16" as const,
    sample_rate_hz: 24000,
    channels: 1,
    data,
  };
}
describe("OpenAI realtime adapter correction", () => {
  it("does not advertise reconnect", () =>
    expect(new OpenAIRealtimeSessionProvider().capabilities()).not.toContain(
      "reconnect",
    ));
  it("ABORT only emits canonical interruption", async () => {
    const t = transport();
    const s = await new OpenAIRealtimeSessionProvider(() => t).createSession(
      config,
    );
    const e: any[] = [];
    s.onEvent((x) => e.push(x));
    s.interrupt("ABORT_BRAIN_REQUEST");
    expect(t.sent).toEqual([]);
    expect(e.some((x) => x.type === "interruption")).toBe(true);
  });
  it("BOTH sends only provider cancellation", async () => {
    const t = transport();
    const s = await new OpenAIRealtimeSessionProvider(() => t).createSession(
      config,
    );
    s.interrupt("BOTH");
    expect(t.sent).toEqual([{ type: "response.cancel" }]);
  });
  it("response.done returns idle with or without usage", async () => {
    const t = transport();
    const s = await new OpenAIRealtimeSessionProvider(() => t).createSession(
      config,
    );
    const e: any[] = [];
    s.onEvent((x) => e.push(x));
    t.emit({ type: "response.done" });
    expect(e.at(-1)).toEqual({ type: "state", state: "IDLE" });
    t.emit({ type: "response.done", usage: { input_tokens: 2 } });
    expect(e.at(-2).type).toBe("usage");
    expect(e.at(-1).state).toBe("IDLE");
  });
  it("rejects audio until the provider session is ready", async () => {
    const t = transport();
    const s = await new OpenAIRealtimeSessionProvider(() => t).createSession(
      config,
    );
    expect(() => s.sendAudio(frame())).toThrow(
      "Realtime voice session is not ready",
    );
    expect(t.sent).toEqual([]);
  });
  it("appends Uint8Array audio as exact base64 bytes", async () => {
    const t = transport();
    const s = await new OpenAIRealtimeSessionProvider(() => t).createSession(
      config,
    );
    t.emit({ type: "session.created", session: { id: "provider" } });
    expect(() => s.sendAudio(frame())).toThrow("not ready");
    t.emit({ type: "session.updated", session: { id: "provider" } });
    const bytes = Uint8Array.from([0, 1, 2, 255]);
    s.sendAudio(frame(bytes));
    expect(t.sent).toEqual([
      { type: "input_audio_buffer.append", audio: "AAEC/w==" },
    ]);
    expect(Buffer.from(t.sent[0].audio, "base64")).toEqual(Buffer.from(bytes));
  });
  it("appends ArrayBuffer audio as exact base64 bytes", async () => {
    const t = transport();
    const s = await new OpenAIRealtimeSessionProvider(() => t).createSession(
      config,
    );
    t.emit({ type: "session.created", session: { id: "provider" } });
    expect(() => s.sendAudio(frame())).toThrow("not ready");
    t.emit({ type: "session.updated", session: { id: "provider" } });
    const bytes = Uint8Array.from([16, 32, 48, 64]);
    s.sendAudio(frame(bytes.buffer));
    expect(t.sent).toEqual([
      { type: "input_audio_buffer.append", audio: "ECAwQA==" },
    ]);
    expect(Buffer.from(t.sent[0].audio, "base64")).toEqual(Buffer.from(bytes));
  });
  it("encodes only the visible Uint8Array subarray", async () => {
    const t = transport();
    const s = await new OpenAIRealtimeSessionProvider(() => t).createSession(
      config,
    );
    t.emit({ type: "session.created", session: { id: "provider" } });
    expect(() => s.sendAudio(frame())).toThrow("not ready");
    t.emit({ type: "session.updated", session: { id: "provider" } });
    const backing = Uint8Array.from([9, 10, 11, 12]);
    const view = backing.subarray(1, 3);
    s.sendAudio(frame(view));
    expect(t.sent).toEqual([
      { type: "input_audio_buffer.append", audio: "Cgs=" },
    ]);
    expect(Buffer.from(t.sent[0].audio, "base64")).toEqual(
      Buffer.from([10, 11]),
    );
  });
  it("validates audio metadata and rejects empty frames", async () => {
    const t = transport();
    const s = await new OpenAIRealtimeSessionProvider(() => t).createSession(
      config,
    );
    t.emit({ type: "session.created", session: { id: "provider" } });
    expect(() => s.sendAudio(frame())).toThrow("not ready");
    t.emit({ type: "session.updated", session: { id: "provider" } });
    expect(() => s.sendAudio({ ...frame(), encoding: "pcm" })).toThrow(
      "Unsupported audio frame format",
    );
    expect(() => s.sendAudio({ ...frame(), channels: 2 })).toThrow(
      "Unsupported audio frame format",
    );
    expect(() => s.sendAudio({ ...frame(), sample_rate_hz: 16000 })).toThrow(
      "Invalid audio frame metadata",
    );
    expect(() => s.sendAudio(frame(new Uint8Array()))).toThrow(
      "Audio frame is empty",
    );
    expect(t.sent).toEqual([]);
  });
  it("propagates transport send failures without adding protocol commands", async () => {
    const t = transport();
    const s = await new OpenAIRealtimeSessionProvider(() => t).createSession(
      config,
    );
    t.emit({ type: "session.created", session: { id: "provider" } });
    expect(() => s.sendAudio(frame())).toThrow("not ready");
    t.emit({ type: "session.updated", session: { id: "provider" } });
    t.send = () => {
      throw new Error("transport failed");
    };
    expect(() => s.sendAudio(frame())).toThrow("transport failed");
    expect(t.sent).toEqual([]);
  });
  it("remote close prevents send and interrupt and local close is idempotent", async () => {
    const t = transport();
    const s = await new OpenAIRealtimeSessionProvider(() => t).createSession(
      config,
    );
    t.emit({ type: "session.created", session: { id: "provider" } });
    expect(() => s.sendAudio(frame())).toThrow("not ready");
    t.emit({ type: "session.updated", session: { id: "provider" } });
    t.emit({ type: "connection.closed" });
    expect(() =>
      s.sendAudio({
        encoding: "pcm16",
        sample_rate_hz: 24000,
        channels: 1,
        data: new Uint8Array(),
      }),
    ).toThrow();
    s.interrupt("BOTH");
    await s.close();
    await s.close();
    expect(t.sent).toEqual([]);
  });
  it("provider and Nexus IDs remain distinct", async () => {
    const t = transport();
    const s = await new OpenAIRealtimeSessionProvider(() => t).createSession(
      config,
    );
    t.emit({ type: "session.created", session: { id: "provider" } });
    expect(s.nexus_conversation_id).toBe("c");
    expect(s.provider_session_id).toBe("provider");
  });
});
