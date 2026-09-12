import { describe, expect, it } from "vitest";
import { OpenAIRealtimeSessionProvider } from "../src/infrastructure/providers/openai-realtime";
function transport() {
  let cb: (e: any) => void = () => {};
  return {
    connect: async (f: any) => {
      cb = f;
    },
    send: (_x: any) => {},
    close: async () => {},
    emit: (e: any) => cb(e),
  };
}
describe("OpenAI realtime adapter skeleton", () => {
  it("declares capabilities and no default availability", () => {
    const p = new OpenAIRealtimeSessionProvider();
    expect(p.capabilities()).toContain("interruptions");
    expect(p.availability()).toBe("UNAVAILABLE");
  });
  it("translates events and preserves IDs", async () => {
    const t = transport();
    const s = await new OpenAIRealtimeSessionProvider(() => t).createSession({
      user_id: "u",
      conversation_id: "c",
      classic_fallback_available: true,
    });
    const e: any[] = [];
    s.onEvent((x) => e.push(x));
    t.emit({ type: "session.created", session: { id: "p" } });
    t.emit({ type: "input_audio_buffer.speech_started", item_id: "t" });
    t.emit({ type: "response.text.delta", item_id: "t", delta: "hi" });
    expect(s.nexus_conversation_id).toBe("c");
    expect(e.map((x) => x.type)).toContain("speech_start");
    expect(e.map((x) => x.type)).toContain("assistant_text_delta");
  });
  it("maps interruption without external cancellation", async () => {
    const t = transport();
    const sent: any[] = [];
    t.send = (x: any) => {
      sent.push(x);
    };
    const s = await new OpenAIRealtimeSessionProvider(() => t).createSession({
      user_id: "u",
      conversation_id: "c",
      classic_fallback_available: true,
    });
    const e: any[] = [];
    s.onEvent((x) => e.push(x));
    s.interrupt("BOTH");
    expect(sent.map((x) => x.type)).toContain("response.cancel");
    expect(
      e.find((x) => x.type === "interruption").interruption
        .cancel_external_effect,
    ).toBe(false);
  });
  it("close is idempotent", async () => {
    const t = transport();
    const s = await new OpenAIRealtimeSessionProvider(() => t).createSession({
      user_id: "u",
      conversation_id: "c",
      classic_fallback_available: true,
    });
    await s.close();
    await s.close();
  });
});
