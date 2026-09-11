import { it, expect, vi, afterEach } from "vitest";
import { BrowserFrameCapture } from "../src/components/perception/capture";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function fixture(surface = "window") {
  const stop = vi.fn(),
    track = { stop, getSettings: () => ({ displaySurface: surface }) };
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
  const media = {
    getUserMedia: vi.fn(async () => stream),
    getDisplayMedia: vi.fn(async () => stream),
  };
  vi.stubGlobal("navigator", { mediaDevices: media });
  vi.stubGlobal("document", {
    createElement: (tag: string) =>
      tag === "video"
        ? {
            play: async () => {},
            pause() {},
            srcObject: null,
            videoWidth: 640,
            videoHeight: 480,
            requestVideoFrameCallback: (cb: () => void) => {
              cb();
              return 1;
            },
          }
        : {
            width: 0,
            height: 0,
            getContext: () => ({ drawImage() {} }),
            toBlob: (cb: (b: Blob) => void) =>
              cb(new Blob(["fixture"], { type: "image/jpeg" })),
          },
  });
  return { stop, stream, media };
}
it("webcam is one frame with audio disabled and stops afterward", async () => {
  const f = fixture();
  const result = await new BrowserFrameCapture().capture(
    "webcam",
    "camera-1",
    new AbortController().signal,
  );
  expect(result.type).toBe("image/jpeg");
  expect(f.media.getUserMedia).toHaveBeenCalledWith({
    video: { deviceId: { exact: "camera-1" } },
    audio: false,
  });
  expect(f.stop).toHaveBeenCalled();
});
it("window selection is explicit with no audio and stops after frame", async () => {
  const f = fixture();
  await new BrowserFrameCapture().capture(
    "window",
    "selected",
    new AbortController().signal,
  );
  expect(f.media.getDisplayMedia).toHaveBeenCalledWith({
    video: { displaySurface: "window" },
    audio: false,
  });
  expect(f.stop).toHaveBeenCalled();
});
it("rejects a screen selected under a window grant", async () => {
  const f = fixture("monitor");
  await expect(
    new BrowserFrameCapture().capture(
      "window",
      "selected",
      new AbortController().signal,
    ),
  ).rejects.toThrow("approved source type");
  expect(f.stop).toHaveBeenCalled();
});
it("cancellation closes late camera permission results", async () => {
  const f = fixture();
  let deliver!: (stream: typeof f.stream) => void;
  f.media.getUserMedia.mockImplementation(
    () =>
      new Promise((r) => {
        deliver = r;
      }),
  );
  const controller = new AbortController(),
    pending = new BrowserFrameCapture().capture(
      "webcam",
      "default",
      controller.signal,
    );
  controller.abort();
  deliver(f.stream);
  await expect(pending).rejects.toThrow("cancelled");
  expect(f.stop).toHaveBeenCalledTimes(1);
});
it("file sources never activate a camera", async () => {
  const f = fixture();
  await expect(
    new BrowserFrameCapture().capture(
      "upload",
      "file",
      new AbortController().signal,
    ),
  ).rejects.toThrow("does not permit");
  expect(f.media.getUserMedia).not.toHaveBeenCalled();
});
it("OS denial provides actionable privacy guidance without retry", async () => {
  const f = fixture();
  f.media.getUserMedia.mockRejectedValue(
    new DOMException("Denied", "NotAllowedError"),
  );
  await expect(
    new BrowserFrameCapture().capture(
      "webcam",
      "default",
      new AbortController().signal,
    ),
  ).rejects.toThrow("Privacy & Security");
  expect(f.media.getUserMedia).toHaveBeenCalledTimes(1);
});
