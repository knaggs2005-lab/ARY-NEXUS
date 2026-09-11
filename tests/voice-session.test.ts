import { describe, expect, it, vi } from "vitest";
import {
  ConversationSession,
  EnergyVAD,
  pcmWave,
  type SessionCallbacks,
} from "../src/components/voice/conversation-session";
const frame = (value: number) => new Float32Array(800).fill(value); // 50 ms at 16 kHz
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function setup(overrides: Partial<SessionCallbacks> = {}) {
  const callbacks = {
    speechStart: vi.fn(),
    state: vi.fn(),
    transcribe: vi.fn(async () => "A final transcript"),
    transcript: vi.fn(),
    error: vi.fn(),
    ...overrides,
  };
  const session = new ConversationSession(callbacks);
  const push = (value: number, count: number) => {
    for (let i = 0; i < count; i++) session.push(frame(value), 16000);
  };
  const turn = () => {
    push(0.1, 8);
    push(0, 13);
  };
  return { callbacks, session, push, turn };
}
describe("Persistent same-Brain voice session", () => {
  it("does not send silence or brief noise to a provider", () => {
    const { callbacks, push } = setup();
    push(0, 10000);
    push(0.1, 3);
    push(0, 20);
    expect(callbacks.transcribe).not.toHaveBeenCalled();
    expect(callbacks.speechStart).not.toHaveBeenCalled();
  });
  it("endpoints at 650 ms and submits exactly one final transcript", async () => {
    const { callbacks, push } = setup();
    push(0.1, 8);
    push(0, 12);
    expect(callbacks.transcribe).not.toHaveBeenCalled();
    push(0, 1);
    await settle();
    expect(callbacks.transcribe).toHaveBeenCalledOnce();
    expect(callbacks.transcript).toHaveBeenCalledExactlyOnceWith(
      "A final transcript",
    );
    expect(callbacks.state).toHaveBeenLastCalledWith("armed");
  });
  it("preserves onset pre-roll in a valid mono PCM WAV", async () => {
    const { callbacks, push } = setup();
    push(0, 4);
    push(0.1, 8);
    push(0, 13);
    const audio = vi.mocked(callbacks.transcribe).mock.calls[0][0];
    const bytes = await audio.arrayBuffer(),
      v = new DataView(bytes);
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe("RIFF");
    expect(v.getUint16(22, true)).toBe(1);
    expect(v.getUint32(24, true)).toBe(16000);
    expect(v.getUint32(40, true)).toBe(bytes.byteLength - 44);
    expect(bytes.byteLength).toBeGreaterThan(21 * 800 * 2);
  });
  it("barge-in interrupts immediately and suppresses a late previous transcript", async () => {
    let finish!: (text: string) => void;
    const transcribe = vi.fn(
      (_audio: Blob, _signal: AbortSignal) =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    const { callbacks, push, turn } = setup({ transcribe });
    turn();
    const signal = transcribe.mock.calls[0][1];
    push(0.2, 4);
    expect(callbacks.speechStart).toHaveBeenCalledTimes(2);
    expect(signal.aborted).toBe(true);
    finish("stale request");
    await settle();
    expect(callbacks.transcript).not.toHaveBeenCalled();
  });
  it("stop revokes in-flight speech and cannot be resumed by late frames", async () => {
    let finish!: (text: string) => void;
    const transcribe = vi.fn(
      (_audio: Blob, _signal: AbortSignal) =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    const { session, callbacks, turn } = setup({ transcribe });
    turn();
    session.stop();
    session.pause(false);
    turn();
    finish("late");
    await settle();
    expect(transcribe.mock.calls[0][1].aborted).toBe(true);
    expect(callbacks.transcript).not.toHaveBeenCalled();
    expect(callbacks.state).toHaveBeenLastCalledWith("off");
  });
  it("pauses capture during approval and discards unsubmitted speech", async () => {
    const { session, callbacks, push, turn } = setup();
    push(0.1, 8);
    session.pause(true);
    turn();
    expect(callbacks.transcribe).not.toHaveBeenCalled();
    session.pause(false);
    turn();
    await settle();
    expect(callbacks.transcript).toHaveBeenCalledOnce();
  });
  it("does not interpret an empty transcription as a request", async () => {
    const { callbacks, turn } = setup({ transcribe: vi.fn(async () => "  ") });
    turn();
    await settle();
    expect(callbacks.transcript).not.toHaveBeenCalled();
  });
  it("provider failure ends continuous capture without a retry loop", async () => {
    const { callbacks, turn } = setup({
      transcribe: vi.fn(async () => {
        throw Error("offline");
      }),
    });
    turn();
    await settle();
    turn();
    expect(callbacks.error).toHaveBeenCalledOnce();
    expect(callbacks.transcribe).toHaveBeenCalledOnce();
    expect(callbacks.state).toHaveBeenLastCalledWith("off");
  });
  it("stops oversized turns without submitting a truncated command", async () => {
    const { callbacks, push } = setup();
    push(0.1, 400);
    await settle();
    expect(callbacks.transcribe).not.toHaveBeenCalled();
    expect(callbacks.error).toHaveBeenCalledOnce();
    expect(callbacks.state).toHaveBeenLastCalledWith("off");
  });
  it("uses swappable VAD and keeps wake audio local until a detector fires", async () => {
    const callbacks = {
      speechStart: vi.fn(),
      state: vi.fn(),
      transcribe: vi.fn(async () => "awake"),
      transcript: vi.fn(),
      error: vi.fn(),
    };
    const vad = {
      id: "fixture-vad",
      speech: (samples: Float32Array) => samples[0] > 0,
      reset: vi.fn(),
    };
    const wake = {
      id: "fixture-wake",
      detected: vi.fn(() => false),
      reset: vi.fn(),
    };
    const session = new ConversationSession(callbacks, vad, wake);
    for (let i = 0; i < 100; i++) session.push(frame(0.1), 16000);
    expect(callbacks.transcribe).not.toHaveBeenCalled();
    expect(callbacks.speechStart).not.toHaveBeenCalled();
    wake.detected.mockReturnValueOnce(true);
    session.push(frame(0.1), 16000);
    for (let i = 0; i < 8; i++) session.push(frame(0.1), 16000);
    for (let i = 0; i < 13; i++) session.push(frame(0), 16000);
    await settle();
    expect(callbacks.transcript).toHaveBeenCalledExactlyOnceWith("awake");
    session.stop();
    expect(wake.reset).toHaveBeenCalled();
    expect(vad.reset).toHaveBeenCalled();
  });
  it("energy detector is explicit, resettable and does not mistake low noise for speech", () => {
    const vad = new EnergyVAD();
    expect(vad.id).toBe("local-energy-v1");
    for (let i = 0; i < 100; i++) expect(vad.speech(frame(0.002))).toBe(false);
    expect(vad.speech(frame(0.08))).toBe(true);
    vad.reset();
    expect(vad.speech(frame(0))).toBe(false);
  });
  it("clamps PCM samples and rejects unsupported frame rates", async () => {
    const v = new DataView(
      await pcmWave([new Float32Array([-2, 2])], 16000).arrayBuffer(),
    );
    expect(v.getInt16(44, true)).toBe(-32768);
    expect(v.getInt16(46, true)).toBe(32767);
    const { session, callbacks } = setup();
    session.push(frame(0.2), 0);
    session.push(frame(0.2), 192000);
    expect(callbacks.speechStart).not.toHaveBeenCalled();
  });
});
