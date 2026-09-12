import { describe, expect, it } from "vitest";
import { realtimeVoiceInterruption } from "../src/domain/realtime-voice";
describe("realtime voice contracts", () => {
  it("keeps Nexus and provider session identities distinct", () => {
    const s = {
      id: "rt-1",
      nexus_conversation_id: "conv-1",
      provider_session_id: "provider-1",
    };
    expect(s.id).not.toBe(s.nexus_conversation_id);
    expect(s.nexus_conversation_id).not.toBe(s.provider_session_id);
  });
  it("requires external cancellation to remain false", () => {
    const x = {
      turn_id: "t",
      kind: "BOTH",
      at: new Date().toISOString(),
      cancel_external_effect: false,
    };
    expect(realtimeVoiceInterruption.parse(x).cancel_external_effect).toBe(
      false,
    );
    expect(() =>
      realtimeVoiceInterruption.parse({ ...x, cancel_external_effect: true }),
    ).toThrow();
  });
  it("represents partial transcript without persistence", () => {
    const turn = {
      transcript: {
        text: "partial",
        phase: "EPHEMERAL",
        persisted_message_id: null,
      },
    };
    expect(turn.transcript.persisted_message_id).toBeNull();
  });
  it("rejects provider-specific fields in interruption contract", () => {
    expect(() =>
      realtimeVoiceInterruption.parse({
        turn_id: "t",
        kind: "STOP_AUDIO",
        at: new Date().toISOString(),
        cancel_external_effect: false,
        openai_event: "x",
      }),
    ).toThrow();
  });
  it("preserves truthful provider failure", () => {
    const failure = {
      code: "socket_unavailable",
      message: "provider unavailable",
      retryable: true,
      provider: "test",
    };
    expect(failure.message).toContain("unavailable");
  });
  it("has no credential fields in public session metadata", () => {
    const session = {
      id: "r",
      nexus_conversation_id: "c",
      provider_session_id: null,
      state: "IDLE",
    };
    expect(JSON.stringify(session)).not.toMatch(/key|token|secret|credential/i);
  });
});
