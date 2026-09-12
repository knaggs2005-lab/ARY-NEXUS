import { describe, it, expect, vi } from "vitest";
import { RealtimePlayback } from "../src/components/voice/realtime-playback";
import { RealtimeOutputStream } from "../src/services/realtime-output-stream";
import { RealtimeOutputClient } from "../src/components/voice/realtime-output-client";
import { OpenAIRealtimeSessionProvider } from "../src/infrastructure/providers/openai-realtime";
function audio() {
  const starts: number[] = [];
  const nodes: any[] = [];
  const context: any = {
    currentTime: 0,
    destination: {},
    resume: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    createBuffer: vi.fn((_c, n, rate) => ({
      sampleRate: rate,
      getChannelData: () => new Float32Array(n),
    })),
    createBufferSource: () => {
      const node = {
        buffer: null,
        connect: vi.fn(),
        disconnect: vi.fn(),
        onended: null,
        stop: vi.fn(),
        start: (at: number) => starts.push(at),
      };
      nodes.push(node);
      return node;
    },
  };
  return { context, starts, nodes };
}
const frame = (length = 960) => ({
  encoding: "pcm16",
  sample_rate_hz: 24000,
  channels: 1,
  data: new Uint8Array(length),
});
describe("realtime dedicated playback", () => {
  it("schedules ordered source-rate PCM in a dedicated context and reports first audio", async () => {
    const s = audio(),
      factory = vi.fn(() => s.context);
    const p = new RealtimePlayback(factory);
    await p.start();
    p.accept(frame());
    p.accept(frame());
    expect(factory).toHaveBeenCalledWith();
    expect(s.starts[1]).toBeGreaterThan(s.starts[0]);
    expect(p.snapshot()).toMatchObject({
      audio_chunks_received: 2,
      audio_bytes_received: 1920,
    });
    expect(p.snapshot().first_audio_latency_ms).toBeGreaterThanOrEqual(0);
    p.stop();
    p.stop();
    await p.close();
    await p.close();
    expect(s.context.close).toHaveBeenCalledOnce();
    expect(s.nodes[0].stop).toHaveBeenCalledOnce();
  });
  it.each([0, 959, 96001])(
    "rejects malformed or oversized output %i",
    async (n) => {
      const p = new RealtimePlayback(() => audio().context);
      await p.start();
      expect(() => p.accept(frame(n))).toThrow();
      expect(p.snapshot().state).toBe("FAILED");
      await p.close();
    },
  );
  it("bounds queued PCM to one second", async () => {
    const p = new RealtimePlayback(() => audio().context);
    await p.start();
    expect(() => {
      for (let n = 0; n < 60; n++) p.accept(frame());
    }).toThrow("PLAYBACK_BACKPRESSURE");
    expect(p.snapshot().queued_audio_ms).toBe(0);
    await p.close();
  });
  it("drains to idle and counts a later underrun", async () => {
    const s = audio(),
      p = new RealtimePlayback(() => s.context);
    await p.start();
    p.accept(frame());
    s.context.currentTime = 1;
    s.nodes[0].onended();
    expect(p.snapshot().state).toBe("IDLE");
    p.accept(frame());
    expect(p.snapshot().underrun_count).toBe(1);
    await p.close();
  });
});
describe("authenticated relay output boundary", () => {
  it("provider event → bounded stream → client → dedicated playback, with clean disconnect", async () => {
    let emit: (e: any) => void = () => {};
    const provider = new OpenAIRealtimeSessionProvider(() => ({
      connect: async (cb) => {
        emit = cb;
        cb({
          type: "session.updated",
          session: {
            audio: { output: { format: { type: "audio/pcm", rate: 24000 } } },
          },
        });
      },
      send: () => {},
      close: async () => {},
    }));
    const session = await provider.createSession({
      user_id: "u",
      conversation_id: "c",
      classic_fallback_available: false,
    });
    const disconnected = vi.fn(),
      stream = new RealtimeOutputStream(disconnected);
    session.onEvent((e) => stream.publish(e));
    const p = new RealtimePlayback(() => audio().context);
    await p.start();
    const failure = vi.fn();
    const client = new RealtimeOutputClient(
      async () => stream.open(new AbortController().signal),
      p,
      failure,
    );
    await client.open("id");
    emit({ type: "response.created", response: { id: "response" } });
    emit({
      type: "response.output_audio.delta",
      response_id: "response",
      item_id: "turn",
      delta: Buffer.from(new Uint8Array(960)).toString("base64"),
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(p.snapshot().audio_chunks_received).toBe(1);
    expect(failure).not.toHaveBeenCalled();
    await client.close();
    expect(disconnected).toHaveBeenCalledOnce();
    await session.close();
  });
  it("rejects duplicate consumers and bounds unread output", () => {
    const failed = vi.fn(),
      s = new RealtimeOutputStream(failed);
    s.open(new AbortController().signal);
    expect(() => s.open(new AbortController().signal)).toThrow();
    for (let n = 0; n < 200; n++)
      s.publish({
        type: "assistant_audio_delta",
        turn_id: "t",
        frame: frame(),
      });
    expect(failed).toHaveBeenCalledOnce();
    s.close();
  });
  it("rejects provider output without confirmed format and never mistakes assistant transcript for user speech", async () => {
    let emit: (e: any) => void = () => {};
    const s = await new OpenAIRealtimeSessionProvider(() => ({
      connect: async (cb) => {
        emit = cb;
      },
      send: () => {},
      close: async () => {},
    })).createSession({
      user_id: "u",
      conversation_id: "c",
      classic_fallback_available: false,
    });
    const events: any[] = [];
    s.onEvent((e) => events.push(e));
    emit({
      type: "response.output_audio_transcript.delta",
      item_id: "t",
      delta: "hello",
    });
    expect(events[0].type).toBe("assistant_text_delta");
    emit({ type: "response.output_audio.delta", delta: "AAAA" });
    expect(events.at(-1).type).toBe("failure");
    await s.close();
  });
});

describe("barge-in without cancelling external effects", () => {
  it("cancels one provider response, rejects late deltas and resumes a new turn", async () => {
    let emit: (e: any) => void = () => {};
    const commands: any[] = [];
    const s = await new OpenAIRealtimeSessionProvider(() => ({
      connect: async (cb) => {
        emit = cb;
        cb({
          type: "session.updated",
          session: {
            audio: { output: { format: { type: "audio/pcm", rate: 24000 } } },
          },
        });
      },
      send: (c) => commands.push(c),
      close: async () => {},
    })).createSession({
      user_id: "u",
      conversation_id: "c",
      classic_fallback_available: false,
    });
    const events: any[] = [];
    s.onEvent((e) => events.push(e));
    emit({ type: "response.created", response: { id: "r1" } });
    emit({
      type: "response.output_audio.delta",
      response_id: "r1",
      delta: "AAA=",
    });
    s.interrupt("BOTH");
    s.interrupt("BOTH");
    expect(commands).toEqual([{ type: "response.cancel", response_id: "r1" }]);
    emit({
      type: "response.output_audio.delta",
      response_id: "r1",
      delta: "AAA=",
    });
    emit({ type: "response.done", response: { id: "r1" } });
    expect(
      events.filter((e) => e.type === "assistant_audio_delta"),
    ).toHaveLength(1);
    expect(s.state).toBe("INTERRUPTED");
    expect(
      events
        .filter((e) => e.type === "interruption")
        .every((e) => e.interruption.cancel_external_effect === false),
    ).toBe(true);
    emit({ type: "response.created", response: { id: "r2" } });
    emit({
      type: "response.output_audio.delta",
      response_id: "r2",
      delta: "AAA=",
    });
    expect(
      events.filter((e) => e.type === "assistant_audio_delta"),
    ).toHaveLength(2);
    await s.close();
    s.interrupt("BOTH");
    expect(commands).toHaveLength(1);
  });
});
