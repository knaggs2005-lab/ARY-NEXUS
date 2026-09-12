import { describe, expect, it, vi } from "vitest";
import {
  BrowserAudioCaptureProvider,
  Pcm16Packetizer,
} from "../src/infrastructure/audio/browser-audio-capture";
function stream() {
  const listeners = new Map<string, () => void>();
  const track = {
    stop: vi.fn(),
    addEventListener: (e: string, h: () => void) => listeners.set(e, h),
    removeEventListener: (e: string) => listeners.delete(e),
    end: () => listeners.get("ended")?.(),
  };
  return {
    stream: { getTracks: () => [track] } as unknown as MediaStream,
    track,
  };
}
const tick = () => new Promise((r) => setTimeout(r, 0));
describe("BrowserAudioCaptureProvider", () => {
  it("assembles exact 480 sample/960 byte frames across arbitrary chunks", () => {
    const frames: any[] = [];
    const p = new Pcm16Packetizer((f) => frames.push(f));
    p.push(Float32Array.from({ length: 100 }, (_, i) => i / 100));
    p.push(Float32Array.from({ length: 380 }, (_, i) => (i + 100) / 500));
    expect(frames).toHaveLength(1);
    expect(frames[0].data.byteLength).toBe(960);
    expect(frames[0].frame_index).toBe(0);
    expect(new DataView(frames[0].data.buffer).getInt16(0, true)).toBe(0);
  });
  it("pauses/discards buffered audio and stops idempotently", async () => {
    let receive: any;
    const release = vi.fn();
    const stopCapture = vi.fn();
    const f = stream();
    const p = new BrowserAudioCaptureProvider({
      lease: async () => release,
      getUserMedia: async () => f.stream,
      capture: async (_s, _sig, cb) => {
        receive = cb;
        return stopCapture;
      },
    });
    const frames: any[] = [];
    const s = await p.start({}, (x) => frames.push(x), vi.fn());
    receive(new Float32Array(240), 24000);
    s.pause();
    expect(s.health.microphone_active).toBe(true);
    receive(new Float32Array(480), 24000);
    expect(frames).toHaveLength(0);
    s.resume();
    expect(s.health.microphone_active).toBe(true);
    receive(new Float32Array(480), 24000);
    expect(frames).toHaveLength(1);
    await s.stop();
    await s.stop();
    expect(stopCapture).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
    expect(s.health.microphone_active).toBe(false);
  });
  it("fails on unsupported context rate exactly once and cleans late capture", async () => {
    const failure = vi.fn();
    const stopCapture = vi.fn();
    const f = stream();
    const result = new BrowserAudioCaptureProvider({
      lease: async () => () => {},
      getUserMedia: async () => f.stream,
      capture: async (_s, _sig, cb) => {
        cb(new Float32Array(1), 44100);
        return stopCapture;
      },
    }).start({}, vi.fn(), failure);
    await expect(result).rejects.toBeTruthy();
    await tick();
    expect(failure).toHaveBeenCalledOnce();
    expect(failure).toHaveBeenCalledWith(
      expect.objectContaining({ code: "UNSUPPORTED_SAMPLE_RATE" }),
    );
    expect(stopCapture).toHaveBeenCalledOnce();
    expect(f.track.stop).toHaveBeenCalled();
  });
  it("does not acquire the mic when lease is rejected", async () => {
    const gum = vi.fn();
    await expect(
      new BrowserAudioCaptureProvider({
        lease: async () => {
          throw new Error("lease busy");
        },
        getUserMedia: gum,
      }).start({}, vi.fn(), vi.fn()),
    ).rejects.toThrow("lease busy");
    expect(gum).not.toHaveBeenCalled();
  });
  it("caller abort after startup stops capture and emits no later frames", async () => {
    let receive: any;
    const controller = new AbortController();
    const f = stream();
    const s = await new BrowserAudioCaptureProvider({
      lease: async () => () => {},
      getUserMedia: async () => f.stream,
      capture: async (_s, _sig, cb) => {
        receive = cb;
        return () => {};
      },
    }).start({ signal: controller.signal }, vi.fn(), vi.fn());
    controller.abort();
    await tick();
    expect(s.health.state).toBe("STOPPED");
    receive(new Float32Array(480), 24000);
    expect(s.health.frame_count).toBe(0);
  });
  it("track end fails once and cannot be resurrected by late callbacks", async () => {
    let receive: any;
    const failure = vi.fn();
    const f = stream();
    const s = await new BrowserAudioCaptureProvider({
      lease: async () => () => {},
      getUserMedia: async () => f.stream,
      capture: async (_s, _sig, cb) => {
        receive = cb;
        return () => {};
      },
    }).start({}, vi.fn(), failure);
    f.track.end();
    await tick();
    expect(failure).toHaveBeenCalledOnce();
    expect(s.health.state).toBe("FAILED");
    receive(new Float32Array(480), 24000);
    expect(s.health.state).toBe("FAILED");
  });
});
