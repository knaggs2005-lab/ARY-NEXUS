import { describe, expect, it, vi } from "vitest";
import {
  BrowserAudioCaptureProvider,
  Pcm16Packetizer,
} from "../src/infrastructure/audio/browser-audio-capture";
function stream() {
  const track = { stop: vi.fn() };
  return { getTracks: () => [track] } as unknown as MediaStream;
}
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
    const p = new BrowserAudioCaptureProvider({
      lease: async () => release,
      getUserMedia: async () => stream(),
      capture: async (_s, _sig, cb) => {
        receive = cb;
        return stopCapture;
      },
    });
    const frames: any[] = [];
    const s = await p.start({}, (f) => frames.push(f), vi.fn());
    receive(new Float32Array(240), 24000);
    s.pause();
    receive(new Float32Array(480), 24000);
    expect(frames).toHaveLength(0);
    s.resume();
    receive(new Float32Array(480), 24000);
    expect(frames).toHaveLength(1);
    await s.stop();
    await s.stop();
    expect(stopCapture).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
  });
  it("fails on unsupported context rate", async () => {
    const failure = vi.fn();
    const s = stream();
    await expect(
      new BrowserAudioCaptureProvider({
        lease: async () => () => {},
        getUserMedia: async () => s,
        capture: async (_s, _sig, cb) => {
          cb(new Float32Array(1), 44100);
          return () => {};
        },
      }).start({}, vi.fn(), failure),
    ).rejects.toBeTruthy();
    expect(failure).toHaveBeenCalledWith(
      expect.objectContaining({ code: "UNSUPPORTED_SAMPLE_RATE" }),
    );
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
});
