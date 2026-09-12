import { afterEach, describe, expect, it, vi } from "vitest";
import { createHeyAryRuntime } from "../src/components/voice/hey-ary-runtime";
import { RealtimeVoiceRelayService } from "../src/services/realtime-voice-relay-service";
import { OpenAIRealtimeVoiceActivator } from "../src/services/realtime-voice-activator";
import type {
  RealtimeVoiceSession,
  RealtimeVoiceEvent,
} from "../src/domain/realtime-voice";
import type { WakeWordEvent } from "../src/domain/wake-word";
const conversation = "00000000-0000-4000-8000-000000000001";
const tick = async () => {
  for (let i = 0; i < 60; i++) await Promise.resolve();
};
afterEach(() => vi.useRealTimers());
function fixture(owner = true) {
  let wakeState: any = "STOPPED",
    wakeHandler: (e: WakeWordEvent) => void = () => {};
  let failure: (f: any) => void = () => {},
    captureActive = false;
  const events = new Set<(e: RealtimeVoiceEvent) => void>();
  const nodes: any[] = [];
  const context: any = {
    currentTime: 0,
    destination: {},
    resume: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    createBuffer: (_c: number, n: number) => ({
      getChannelData: () => new Float32Array(n),
    }),
    createBufferSource: () => {
      const n = {
        connect() {},
        disconnect() {},
        stop: vi.fn(),
        start() {},
        onended: null,
      };
      nodes.push(n);
      return n;
    },
  };
  const emit = (e: RealtimeVoiceEvent) => events.forEach((h) => h(e));
  const session: RealtimeVoiceSession = {
    id: "session",
    nexus_conversation_id: conversation,
    provider_session_id: "remote",
    state: "IDLE",
    sendAudio: vi.fn(),
    speakText: vi.fn(() => {
      emit({
        type: "assistant_audio_delta",
        turn_id: "answer",
        frame: {
          encoding: "pcm16",
          sample_rate_hz: 24000,
          channels: 1 as const,
          data: new Uint8Array(960),
        },
      });
      emit({ type: "state", state: "IDLE" });
    }),
    interrupt: vi.fn(() =>
      emit({
        type: "interruption",
        interruption: {
          kind: "BOTH",
          at: new Date().toISOString(),
          turn_id: "turn",
          cancel_external_effect: false,
        },
      }),
    ),
    close: vi.fn(async () => {}),
    onEvent: (h) => {
      events.add(h);
      return () => events.delete(h);
    },
  };
  const provider = {
    id: "fake",
    capabilities: () => [] as const,
    availability: () => "AVAILABLE" as const,
    createSession: vi.fn(async () => session),
  };
  const brain = {
    respond: vi.fn(async function* () {
      yield {
        type: "response",
        message: { content: "I need your approval for that." },
      } as any;
      yield { type: "complete" } as any;
    }),
  };
  const relay = new RealtimeVoiceRelayService(provider, {
    inactivityMs: 15000,
  });
  let id = "";
  const request = vi.fn(async (path: string, init?: RequestInit) => {
    if (path.endsWith("/start")) {
      const body = JSON.parse(init!.body as string);
      expect(body).toEqual({ conversation_id: conversation, brain: true });
      const r = await relay.start("owner", body.conversation_id, brain);
      id = r.relay_id;
      return Response.json(r);
    }
    if (path.endsWith("/output"))
      return relay.output("owner", id, init!.signal!);
    if (path.endsWith("/stop"))
      return Response.json(await relay.stop("owner", id));
    return Response.json(relay.status("owner", id, true));
  });
  const wake = {
    id: "local-fixture",
    localOnly: true as const,
    start: vi.fn(async () => {
      wakeState = "LISTENING";
      return {
        id: "wake",
        get state() {
          return wakeState;
        },
        pause: async () => {
          wakeState = "PAUSED";
        },
        resume: async () => {
          expect(captureActive).toBe(false);
          wakeState = "LISTENING";
        },
        stop: vi.fn(async () => {
          wakeState = "STOPPED";
        }),
        takeVerificationAudio: () => new Float32Array(16000),
        onEvent: (h: any) => {
          wakeHandler = h;
          return () => {
            wakeHandler = () => {};
          };
        },
      };
    }),
  };
  const ownerGate = {
    verify: vi.fn(async (sample: Float32Array) => {
      sample.fill(0);
      return {
        decision: owner ? ("ALLOW" as const) : ("REJECT" as const),
        reason: "fixture",
        confidence: 0.9,
        authorizes_actions: false as const,
        replay_resistant: false as const,
      };
    }),
  };
  const runtime = createHeyAryRuntime({
    enabled: true,
    conversationId: conversation,
    wakeProvider: wake,
    ownerGate,
    request,
    createAudioContext: () => context,
    capture: {
      start: vi.fn(async (_config, _frame, fail) => {
        expect(wakeState).toBe("PAUSED");
        captureActive = true;
        failure = fail!;
        const health = {
          state: "CAPTURING" as const,
          microphone_active: true,
          sample_rate_hz: 24000,
          channels: 1 as const,
          frame_count: 0,
        };
        return {
          health,
          pause() {},
          resume() {},
          stop: async () => {
            captureActive = false;
            health.microphone_active = false;
          },
        };
      }),
    },
  });
  return {
    runtime,
    relay,
    brain,
    provider,
    session,
    context,
    nodes,
    request,
    ownerGate,
    emit,
    id: () => id,
    failure,
    wake: () =>
      wakeHandler({
        type: "wake.detected",
        detection: {
          wakePhrase: "HEY_ARY",
          timestamp: new Date().toISOString(),
          providerId: "fixture",
          sessionId: "wake",
        },
      }),
    wakeFailure: () =>
      wakeHandler({ type: "wake.failed", code: "LOCAL_WAKE_ENGINE_FAILED" }),
    micFailure: () => failure({ code: "CAPTURE_FAILED", message: "private" }),
  };
}
describe("unified lifecycle, synthetic devices and provider only", () => {
  it("sleep → verify → same Brain → audio → interruption → end → reacquire wake; second cycle uses one lease", async () => {
    vi.useFakeTimers();
    const f = fixture();
    await f.runtime.start();
    expect(f.request).not.toHaveBeenCalled();
    f.wake();
    f.wake();
    await tick();
    expect(f.provider.createSession).toHaveBeenCalledOnce();
    expect(f.ownerGate.verify).toHaveBeenCalledOnce();
    expect(f.runtime.snapshot().activation).toBe("ACTIVE");
    f.emit({
      type: "transcript_final",
      turn_id: "one",
      text: "Create a task for tomorrow.",
    });
    await tick();
    expect(f.brain.respond).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(100);
    expect(
      vi
        .mocked(f.session.speakText!)
        .mock.calls.map((call) => call[0])
        .join(" "),
    ).toBe("I need your approval for that.");
    expect(f.runtime.snapshot().playback.audio_chunks_received).toBe(2);
    f.emit({ type: "speech_start", turn_id: "two" });
    await tick();
    expect(f.nodes[0].stop).toHaveBeenCalledOnce();
    expect(f.runtime.snapshot().playback.queued_audio_ms).toBe(0);
    f.emit({ type: "transcript_final", turn_id: "two", text: "Ary, stop." });
    await vi.advanceTimersByTimeAsync(150);
    expect(f.runtime.snapshot().activation).toBe("SLEEPING");
    expect(f.session.close).toHaveBeenCalledOnce();
    expect(f.context.close).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1600);
    f.wake();
    await tick();
    expect(f.provider.createSession).toHaveBeenCalledTimes(2);
    await f.runtime.stop();
    await f.runtime.stop();
    expect(f.context.close).toHaveBeenCalledOnce();
    expect(f.runtime.snapshot().wake.microphoneActive).toBe(false);
  });
  it("owner rejection returns to wake without sending anything to cloud", async () => {
    const f = fixture(false);
    await f.runtime.start();
    f.wake();
    await tick();
    expect(f.runtime.snapshot().activation).toBe("SLEEPING");
    expect(f.request).not.toHaveBeenCalled();
    await f.runtime.stop();
  });
  it("inactivity expires even without a final speech turn", async () => {
    vi.useFakeTimers();
    const f = fixture();
    await f.runtime.start();
    f.wake();
    await tick();
    await vi.advanceTimersByTimeAsync(15200);
    expect(f.runtime.snapshot().activation).toBe("SLEEPING");
    expect(f.session.close).toHaveBeenCalledOnce();
    await f.runtime.stop();
  });
  it.each(["provider", "microphone", "playback", "brain"])(
    "%s failure releases capture and returns degraded wake",
    async (kind) => {
      vi.useFakeTimers();
      const f = fixture();
      await f.runtime.start();
      f.wake();
      await tick();
      if (kind === "provider")
        f.emit({
          type: "failure",
          failure: {
            code: "PROVIDER_FAILED",
            message: "private",
            retryable: false,
          },
        });
      if (kind === "microphone") f.micFailure();
      if (kind === "playback")
        f.emit({
          type: "assistant_audio_delta",
          turn_id: "t",
          frame: {
            encoding: "pcm16",
            sample_rate_hz: 24000,
            channels: 1 as const,
            data: new Uint8Array(3),
          },
        });
      if (kind === "brain") {
        f.brain.respond.mockImplementation(async function* () {
          throw new Error("private");
        });
        f.emit({ type: "transcript_final", turn_id: "one", text: "hello" });
      }
      await vi.advanceTimersByTimeAsync(500);
      expect(f.runtime.snapshot().degraded).toBe(true);
      expect(f.runtime.snapshot().activation).toBe("SLEEPING");
      expect(f.session.close).toHaveBeenCalledOnce();
      await f.runtime.stop();
    },
  );
  it("wake failure stays failed and page/offline shutdown does not resume hardware", async () => {
    const f = fixture();
    await f.runtime.start();
    f.wakeFailure();
    await tick();
    expect(f.runtime.snapshot().activation).toBe("FAILED");
    await Promise.all([f.runtime.stop(), f.runtime.stop()]);
    expect(f.runtime.snapshot().wake.state).toBe("STOPPED");
    expect(f.request).not.toHaveBeenCalled();
  });
  it("stop while verification pending cannot activate late", async () => {
    const f = fixture();
    let resolve!: (x: any) => void;
    f.ownerGate.verify.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    await f.runtime.start();
    f.wake();
    await tick();
    const stop = f.runtime.stop();
    resolve({ decision: "ALLOW" });
    await stop;
    expect(f.provider.createSession).not.toHaveBeenCalled();
  });
});

describe("concrete server activator recovery", () => {
  it("closes a late session after stop during connect and rejects parallel starts", async () => {
    let resolve!: (s: RealtimeVoiceSession) => void;
    const f = fixture();
    const provider = {
      ...f.provider,
      createSession: vi.fn(
        () =>
          new Promise<RealtimeVoiceSession>((r) => {
            resolve = r;
          }),
      ),
    };
    const a = new OpenAIRealtimeVoiceActivator(provider, "owner");
    const input: any = { conversation_id: conversation, wake: {} };
    const one = a.start(input),
      two = a.start(input);
    expect(provider.createSession).toHaveBeenCalledOnce();
    const stop = a.stop();
    resolve(f.session);
    await Promise.all([one, two, stop]);
    expect(a.state()).toBe("IDLE");
    expect(f.session.close).toHaveBeenCalledOnce();
  });
  it("active provider failure cleans up once; later close does not double notify", async () => {
    const f = fixture();
    const a = new OpenAIRealtimeVoiceActivator(f.provider, "owner"),
      ended = vi.fn();
    a.onEnded(ended);
    await a.start({ conversation_id: conversation, wake: {} as any });
    f.emit({
      type: "failure",
      failure: { code: "FAILED", message: "error", retryable: false },
    });
    f.emit({ type: "state", state: "CLOSED" });
    await tick();
    expect(ended).toHaveBeenCalledOnce();
    expect(f.session.close).toHaveBeenCalledOnce();
    await a.stop();
    expect(f.session.close).toHaveBeenCalledOnce();
  });
});
