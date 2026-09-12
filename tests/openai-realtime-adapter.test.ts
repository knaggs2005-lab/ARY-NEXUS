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
  it("remote close prevents send and interrupt and local close is idempotent", async () => {
    const t = transport();
    const s = await new OpenAIRealtimeSessionProvider(() => t).createSession(
      config,
    );
    t.emit({ type: "connection.closed" });
    expect(() =>
      s.sendAudio({
        encoding: "pcm",
        sample_rate_hz: 16000,
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
    t.emit({ type: "session.ready", session: { id: "provider" } });
    expect(s.nexus_conversation_id).toBe("c");
    expect(s.provider_session_id).toBe("provider");
  });
});
