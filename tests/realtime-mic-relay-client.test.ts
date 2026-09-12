import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AudioCaptureFrame,
  AudioCaptureFailure,
  AudioCaptureProvider,
  AudioCaptureSession,
} from "../src/domain/audio-capture";
import { RealtimeMicRelayClient } from "../src/components/voice/realtime-mic-relay-client";
const conversation = "00000000-0000-4000-8000-000000000001";
const tick = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};
function setup() {
  let receive!: (frame: AudioCaptureFrame) => void;
  let failure!: (failure: AudioCaptureFailure) => void;
  let count = 0,
    forwarded = 0;
  const order: string[] = [];
  const bodies: Uint8Array[] = [];
  const session: AudioCaptureSession = {
    health: {
      state: "CAPTURING",
      sample_rate_hz: 24000,
      channels: 1,
      frame_count: 0,
      microphone_active: true,
    },
    pause() {},
    resume() {},
    stop: vi.fn(async () => {
      order.push("mic-stop");
      session.health.microphone_active = false;
    }),
  };
  const provider: AudioCaptureProvider = {
    start: vi.fn(async (_config, frame, failed) => {
      order.push("mic-start");
      receive = frame;
      failure = failed;
      return session;
    }),
  };
  const request = vi.fn(async (path: string, options?: RequestInit) => {
    if (path.endsWith("/start")) {
      order.push("relay-start");
      return Response.json({
        relay_id: conversation,
        relay_state: "ACTIVE",
        realtime_state: "IDLE",
      });
    }
    if (path.endsWith("/audio")) {
      const bytes = options!.body as Uint8Array;
      bodies.push(new Uint8Array(bytes));
      forwarded += bytes.length / 960;
      return Response.json({
        frames_forwarded: forwarded,
        bytes_forwarded: forwarded * 960,
      });
    }
    if (path.endsWith("/stop")) {
      order.push("relay-stop");
      return Response.json({ stopped: true });
    }
    return Response.json({
      relay_state: "ACTIVE",
      realtime_state: "IDLE",
      speech_start_seen: true,
      speech_end_seen: true,
      failure_code: null,
    });
  });
  const client = new RealtimeMicRelayClient(provider, request);
  function frame(extra: Partial<AudioCaptureFrame> = {}) {
    const index = count++;
    receive({
      frame_index: index,
      encoding: "pcm16",
      sample_rate_hz: 24000,
      channels: 1,
      data: new Uint8Array(960).fill(index),
      ...extra,
    });
  }
  return {
    client,
    provider,
    request,
    session,
    order,
    bodies,
    frame,
    fail: (code: string) =>
      failure({ code, message: "sensitive failure detail" }),
  };
}
afterEach(() => vi.useRealTimers());
describe("physical capture relay client (synthetic input only)", () => {
  it("starts relay first, sends fifteen exact ordered frames, flushes two final whole frames and retains only metadata", async () => {
    const s = setup();
    await s.client.start(conversation);
    expect(s.order).toEqual(["relay-start", "mic-start"]);
    for (let i = 0; i < 17; i++) s.frame();
    await s.client.stop();
    expect(s.bodies.map((b) => b.byteLength)).toEqual([14400, 1920]);
    const all = new Uint8Array([...s.bodies[0], ...s.bodies[1]]);
    for (let i = 0; i < 17; i++)
      expect(all.slice(i * 960, (i + 1) * 960)).toEqual(
        new Uint8Array(960).fill(i),
      );
    expect(s.client.snapshot()).toMatchObject({
      frames_captured: 17,
      frames_forwarded: 17,
      batches_sent: 2,
      cleanup_confirmed: true,
      microphone_active: false,
      speech_start_seen: true,
      speech_end_seen: true,
    });
    expect(Object.keys(s.client.snapshot())).not.toEqual(
      expect.arrayContaining([
        "data",
        "audio",
        "transcript",
        "base64",
        "relay_id",
      ]),
    );
    expect(s.order.indexOf("mic-stop")).toBeLessThan(
      s.order.indexOf("relay-stop"),
    );
    s.frame();
    expect(s.client.snapshot().frames_captured).toBe(17);
    // The only external boundary available to this client is the realtime relay.
    expect(
      s.request.mock.calls.every(([path]) =>
        path.startsWith("realtime/session/"),
      ),
    ).toBe(true);
  });
  it.each(Array.from({ length: 14 }, (_, i) => i + 1))(
    "flushes %i complete final frames without padding",
    async (count) => {
      const s = setup();
      await s.client.start(conversation);
      for (let i = 0; i < count; i++) s.frame();
      expect(s.bodies).toHaveLength(0);
      await s.client.stop();
      expect(s.bodies.map((body) => body.byteLength)).toEqual([count * 960]);
      expect(s.client.snapshot()).toMatchObject({
        frames_captured: count,
        frames_forwarded: count,
        cleanup_confirmed: true,
        failure_code: null,
      });
    },
  );

  it.each([178, 220, 260])(
    "sustains 12 seconds of capture at %i ms per audio request",
    async (latency) => {
      vi.useFakeTimers();
      const s = setup();
      const immediate = s.request.getMockImplementation()!;
      let active = 0,
        peakRequests = 0,
        peakFrames = 0;
      s.request.mockImplementation(async (path, options) => {
        if (!path.endsWith("/audio")) return immediate(path, options);
        active++;
        peakRequests = Math.max(peakRequests, active);
        await new Promise((resolve) => setTimeout(resolve, latency));
        active--;
        return immediate(path, options);
      });
      await s.client.start(conversation);
      for (let i = 0; i < 600; i++) {
        s.frame();
        peakFrames = Math.max(
          peakFrames,
          s.client.snapshot().queue_depth_frames,
        );
        await vi.advanceTimersByTimeAsync(20);
      }
      const stop = s.client.stop();
      await vi.advanceTimersByTimeAsync(latency);
      await stop;
      expect(peakRequests).toBe(1);
      expect(peakFrames).toBeLessThanOrEqual(30);
      expect(s.client.snapshot()).toMatchObject({
        frames_captured: 600,
        frames_forwarded: 600,
        bytes_forwarded: 576000,
        batches_sent: 40,
        failure_code: null,
        cleanup_confirmed: true,
      });
      s.bodies.forEach((body, batch) => {
        for (let frame = 0; frame < 15; frame++)
          expect(body.slice(frame * 960, (frame + 1) * 960)).toEqual(
            new Uint8Array(960).fill(batch * 15 + frame),
          );
      });
    },
  );

  it("sustained slower-than-realtime transport fails within the bounded buffer", async () => {
    vi.useFakeTimers();
    const s = setup();
    const immediate = s.request.getMockImplementation()!;
    s.request.mockImplementation(async (path, options) => {
      if (path.endsWith("/audio"))
        await new Promise((resolve) => setTimeout(resolve, 400));
      return immediate(path, options);
    });
    await s.client.start(conversation);
    for (let i = 0; i < 100 && !s.client.snapshot().failure_code; i++) {
      s.frame();
      await vi.advanceTimersByTimeAsync(20);
    }
    expect(s.client.snapshot().failure_code).toBe("BACKPRESSURE_LIMIT");
    expect(s.client.snapshot().queue_depth_frames).toBeLessThanOrEqual(30);
    await vi.advanceTimersByTimeAsync(400);
    await s.client.stop();
    expect(s.client.snapshot().cleanup_confirmed).toBe(true);
    expect(
      s.request.mock.calls.filter(([p]) => p.endsWith("/audio")),
    ).toHaveLength(1);
  });

  it.each([401, 404, 503])(
    "relay start HTTP %s never opens microphone",
    async (status) => {
      const s = setup();
      s.request.mockResolvedValueOnce(Response.json({}, { status }));
      await s.client.start(conversation);
      await s.client.stop();
      expect(s.provider.start).not.toHaveBeenCalled();
      expect(s.client.snapshot().failure_code).not.toBeNull();
    },
  );
  it("rejects missing conversation without creating one", async () => {
    const s = setup();
    await s.client.start("");
    await s.client.stop();
    expect(s.request).not.toHaveBeenCalled();
    expect(s.provider.start).not.toHaveBeenCalled();
  });
  it("microphone denial closes the relay", async () => {
    const s = setup();
    vi.mocked(s.provider.start).mockRejectedValueOnce(
      new DOMException("private message", "NotAllowedError"),
    );
    await s.client.start(conversation);
    await s.client.stop();
    expect(s.order).toContain("relay-stop");
    expect(s.client.snapshot().failure_code).toBe("START_FAILED");
  });
  it.each(["TRACK_ENDED", "UNSUPPORTED_SAMPLE_RATE"])(
    "capture failure %s stops both sides",
    async (code) => {
      const s = setup();
      await s.client.start(conversation);
      s.fail(code);
      await s.client.stop();
      expect(s.session.stop).toHaveBeenCalledOnce();
      expect(s.order).toContain("relay-stop");
      expect(s.client.snapshot().failure_code).toBe(code);
    },
  );
  it.each([
    { data: new Uint8Array(959) },
    { sample_rate_hz: 48000 },
    { channels: 2 },
    { frame_index: 2 },
  ])("invalid frames fail without forwarding", async (extra) => {
    const s = setup();
    await s.client.start(conversation);
    s.frame(extra);
    await s.client.stop();
    expect(s.bodies).toHaveLength(0);
    expect(s.client.snapshot().client_capture_state).toBe("FAILED");
  });
  it("POST failure stops capture and never retries audio", async () => {
    const s = setup();
    await s.client.start(conversation);
    s.request.mockRejectedValueOnce(new Error("private provider detail"));
    for (let i = 0; i < 15; i++) s.frame();
    await tick();
    await s.client.stop();
    expect(s.session.stop).toHaveBeenCalledOnce();
    expect(s.order).toContain("relay-stop");
    expect(
      s.request.mock.calls.filter(([p]) => p.endsWith("/audio")),
    ).toHaveLength(1);
  });
  it("bounds backpressure to 30 frames and one request", async () => {
    const s = setup();
    await s.client.start(conversation);
    let resolve!: (r: Response) => void;
    s.request.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    for (let i = 0; i < 31; i++) s.frame();
    expect(s.client.snapshot().queue_depth_frames).toBe(30);
    expect(s.client.snapshot().failure_code).toBe("BACKPRESSURE_LIMIT");
    expect(
      s.request.mock.calls.filter(([p]) => p.endsWith("/audio")),
    ).toHaveLength(1);
    resolve(Response.json({ frames_forwarded: 15, bytes_forwarded: 14400 }));
    await s.client.stop();
    expect(s.client.snapshot().queue_depth_frames).toBe(0);
  });
  it("stop during pending POST waits boundedly, then closes; duplicate Stop is idempotent", async () => {
    vi.useFakeTimers();
    const s = setup();
    await s.client.start(conversation);
    s.request.mockImplementationOnce(() => new Promise(() => {}));
    for (let i = 0; i < 15; i++) s.frame();
    const stop = s.client.stop();
    expect(s.client.stop()).toBe(stop);
    await vi.advanceTimersByTimeAsync(800);
    await stop;
    expect(s.client.snapshot().failure_code).toBe("RELAY_REQUEST_TIMEOUT");
    expect(s.order.filter((v) => v === "relay-stop")).toHaveLength(1);
  });
  it("duplicate Start during connecting and capturing opens one provider", async () => {
    const s = setup();
    const first = s.client.start(conversation);
    expect(s.client.start(conversation)).toBe(first);
    await first;
    await s.client.start(conversation);
    await s.client.stop();
    expect(s.provider.start).toHaveBeenCalledOnce();
  });
  it("stop during relay creation closes late session without acquiring mic", async () => {
    const s = setup();
    let release!: (r: Response) => void;
    s.request.mockImplementationOnce(
      () =>
        new Promise((r) => {
          release = r;
        }),
    );
    const start = s.client.start(conversation);
    const stop = s.client.stop();
    release(
      Response.json({
        relay_id: conversation,
        relay_state: "ACTIVE",
        realtime_state: "IDLE",
      }),
    );
    await start;
    await stop;
    expect(s.provider.start).not.toHaveBeenCalled();
    expect(s.order).toContain("relay-stop");
  });
  it.each(["unload", "offline"] as const)(
    "%s stops capture and sends keepalive cleanup",
    async (method) => {
      const s = setup();
      await s.client.start(conversation);
      s.client[method]();
      await s.client.stop();
      expect(s.session.stop).toHaveBeenCalledOnce();
      expect(
        s.request.mock.calls.find(([p]) => p.endsWith("/stop"))?.[1]?.keepalive,
      ).toBe(true);
    },
  );
  it.each(["provider", "expiry"])(
    "%s status failure stops capture",
    async (kind) => {
      vi.useFakeTimers();
      const s = setup();
      await s.client.start(conversation);
      s.request.mockResolvedValueOnce(
        kind === "expiry"
          ? Response.json({}, { status: 404 })
          : Response.json({
              realtime_state: "FAILED",
              failure_code: "invalid_audio",
              speech_start_seen: false,
              speech_end_seen: false,
            }),
      );
      await vi.advanceTimersByTimeAsync(400);
      await s.client.stop();
      expect(s.client.snapshot().client_capture_state).toBe("FAILED");
      expect(s.order).toContain("relay-stop");
    },
  );
});
