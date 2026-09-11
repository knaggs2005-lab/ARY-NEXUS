import { afterEach, expect, it, vi } from "vitest";
import {
  HandTrackingSession,
  type TrackingDependencies,
} from "../src/components/spatial/hand-tracking";
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
function fixture() {
  vi.stubGlobal("location", { origin: "http://localhost" });
  const stop = vi.fn(),
    terminate = vi.fn(),
    pause = vi.fn();
  const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream;
  const worker = {
    terminate,
    postMessage: vi.fn(),
    onmessage: null as null | ((e: MessageEvent) => void),
    onerror: null as null | (() => void),
  };
  const video = {
    play: vi.fn(async () => {}),
    pause,
    readyState: 2,
    srcObject: null,
  };
  const deps: TrackingDependencies = {
    media: vi.fn(async () => stream),
    worker: () => worker as unknown as Worker,
    video: () => video as unknown as HTMLVideoElement,
    bitmap: vi.fn(async () => ({ close: vi.fn() }) as unknown as ImageBitmap),
  };
  const state = vi.fn(),
    result = vi.fn();
  return {
    session: new HandTrackingSession(state, result, deps),
    deps,
    state,
    result,
    stream,
    worker,
    video,
    stop,
    terminate,
    pause,
  };
}
it("turning tracking off stops camera, terminates worker and releases video", async () => {
  vi.useFakeTimers();
  const f = fixture();
  await f.session.start();
  expect(f.worker.postMessage).toHaveBeenCalledWith({
    type: "init",
    origin: "http://localhost",
  });
  f.session.stop();
  expect(f.stop).toHaveBeenCalledOnce();
  expect(f.terminate).toHaveBeenCalledOnce();
  expect(f.video.srcObject).toBeNull();
  expect(f.state).toHaveBeenLastCalledWith("off");
  expect(vi.getTimerCount()).toBe(0);
});
it("does not reopen the camera after a late permission grant", async () => {
  const f = fixture();
  let grant!: (s: MediaStream) => void;
  f.deps.media = () =>
    new Promise((r) => {
      grant = r;
    });
  const start = f.session.start();
  f.session.stop();
  grant(f.stream);
  await start;
  expect(f.stop).toHaveBeenCalledOnce();
  expect(f.worker.postMessage).not.toHaveBeenCalled();
});
it("startup timeout and worker errors clean up rather than leaving camera running", async () => {
  vi.useFakeTimers();
  const f = fixture();
  await f.session.start();
  await vi.advanceTimersByTimeAsync(40002);
  expect(f.stop).toHaveBeenCalledOnce();
  expect(f.state).toHaveBeenLastCalledWith("CPU tracking startup timed out");
  const next = fixture();
  await next.session.start();
  next.worker.onerror?.();
  next.worker.onerror?.();
  expect(next.stop).toHaveBeenCalledOnce();
  expect(next.state).toHaveBeenLastCalledWith("Tracking worker unavailable");
});
it("drops a late video frame after shutdown and never delivers stale landmarks", async () => {
  vi.useFakeTimers();
  const f = fixture();
  let complete!: (b: ImageBitmap) => void;
  f.deps.bitmap = () =>
    new Promise((r) => {
      complete = r;
    });
  await f.session.start();
  f.worker.onmessage?.({
    data: { type: "ready", delegate: "CPU" },
  } as MessageEvent);
  await vi.advanceTimersByTimeAsync(100);
  f.session.stop();
  const close = vi.fn();
  complete({ close } as unknown as ImageBitmap);
  await Promise.resolve();
  expect(close).toHaveBeenCalledOnce();
  f.worker.onmessage?.({
    data: { type: "result", landmarks: [1], latency: 10 },
  } as MessageEvent);
  expect(f.result).not.toHaveBeenCalledWith([1], 10);
});
it("denied camera permission keeps tracking off with a useful fallback status", async () => {
  const f = fixture();
  f.deps.media = async () => {
    throw Object.assign(new Error("denied"), { name: "NotAllowedError" });
  };
  await f.session.start();
  expect(f.worker.postMessage).not.toHaveBeenCalled();
  expect(f.video.srcObject).toBeNull();
  expect(f.state.mock.calls.at(-1)?.[0]).toContain("Camera permission denied");
});
it("an unresponsive inference frame releases camera and worker after the deadline", async () => {
  vi.useFakeTimers();
  const f = fixture();
  await f.session.start();
  f.worker.onmessage?.({
    data: { type: "ready", delegate: "CPU" },
  } as MessageEvent);
  await vi.advanceTimersByTimeAsync(5200);
  expect(f.stop).toHaveBeenCalledOnce();
  expect(f.terminate).toHaveBeenCalledOnce();
  expect(f.state).toHaveBeenLastCalledWith("Tracking frame timed out");
  expect(vi.getTimerCount()).toBe(0);
});

it("changes sampling rate without reopening camera or replacing the worker", async () => {
  vi.useFakeTimers();
  const f = fixture();
  await f.session.start(12);
  f.session.setFps(24);
  expect(f.deps.media).toHaveBeenCalledOnce();
  expect(f.terminate).not.toHaveBeenCalled();
  f.session.stop();
});
it("never queues a second frame while inference is pending", async () => {
  vi.useFakeTimers();
  const f = fixture();
  await f.session.start(24);
  f.worker.onmessage?.({
    data: { type: "ready", delegate: "CPU" },
  } as MessageEvent);
  await vi.advanceTimersByTimeAsync(300);
  expect(f.deps.bitmap).toHaveBeenCalledOnce();
  f.worker.onmessage?.({
    data: { type: "result", landmarks: [], latency: 20 },
  } as MessageEvent);
  await vi.advanceTimersByTimeAsync(60);
  expect(f.deps.bitmap).toHaveBeenCalledTimes(2);
  f.session.stop();
});
it("does not repeatedly infer an unchanged video frame", async () => {
  vi.useFakeTimers();
  const f = fixture();
  Object.assign(f.video, { currentTime: 1 });
  await f.session.start(20);
  f.worker.onmessage?.({
    data: { type: "ready", delegate: "CPU" },
  } as MessageEvent);
  await vi.advanceTimersByTimeAsync(60);
  f.worker.onmessage?.({
    data: { type: "result", landmarks: [], latency: 20 },
  } as MessageEvent);
  await vi.advanceTimersByTimeAsync(400);
  expect(f.deps.bitmap).toHaveBeenCalledOnce();
  Object.assign(f.video, { currentTime: 2 });
  await vi.advanceTimersByTimeAsync(60);
  expect(f.deps.bitmap).toHaveBeenCalledTimes(2);
  f.session.stop();
});
it("times out a frozen camera rather than leaving capture running indefinitely", async () => {
  vi.useFakeTimers();
  const f = fixture();
  Object.assign(f.video, { currentTime: 1 });
  await f.session.start();
  f.worker.onmessage?.({
    data: { type: "ready", delegate: "CPU" },
  } as MessageEvent);
  await vi.advanceTimersByTimeAsync(60);
  f.worker.onmessage?.({
    data: { type: "result", landmarks: [], latency: 10 },
  } as MessageEvent);
  await vi.advanceTimersByTimeAsync(5200);
  expect(f.stop).toHaveBeenCalledOnce();
  expect(f.state.mock.calls.at(-1)?.[0]).toContain("stopped delivering frames");
});
it("bounds a stalled bitmap capture and safely closes its late result", async () => {
  vi.useFakeTimers();
  const f = fixture();
  let finish!: (b: ImageBitmap) => void;
  f.deps.bitmap = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  await f.session.start();
  f.worker.onmessage?.({
    data: { type: "ready", delegate: "CPU" },
  } as MessageEvent);
  await vi.advanceTimersByTimeAsync(5200);
  expect(f.stop).toHaveBeenCalledOnce();
  const close = vi.fn();
  finish({ close } as unknown as ImageBitmap);
  await Promise.resolve();
  expect(close).toHaveBeenCalledOnce();
  expect(f.state.mock.calls.at(-1)?.[0]).toContain("capture timed out");
});
it("replaces a stalled GPU worker once, keeping the original camera stream", async () => {
  vi.useFakeTimers();
  const f = fixture();
  const cpu = {
    postMessage: vi.fn(),
    terminate: vi.fn(),
    onmessage: null as null | ((e: MessageEvent) => void),
    onerror: null,
  };
  let count = 0;
  f.deps.worker = () => (++count === 1 ? f.worker : cpu) as unknown as Worker;
  await f.session.start();
  f.worker.onmessage?.({
    data: { type: "ready", delegate: "GPU" },
  } as MessageEvent);
  await vi.advanceTimersByTimeAsync(5200);
  expect(f.terminate).toHaveBeenCalledOnce();
  expect(f.stop).not.toHaveBeenCalled();
  expect(f.deps.media).toHaveBeenCalledOnce();
  expect(cpu.postMessage).toHaveBeenCalledWith({
    type: "init",
    origin: "http://localhost",
    forceCPU: true,
  });
  const countBefore = f.result.mock.calls.length;
  f.worker.onmessage?.({
    data: { type: "result", landmarks: [], latency: 1 },
  } as MessageEvent);
  expect(f.result.mock.calls.length).toBe(countBefore);
  cpu.onmessage?.({ data: { type: "ready", delegate: "CPU" } } as MessageEvent);
  await vi.advanceTimersByTimeAsync(60);
  cpu.onmessage?.({
    data: { type: "result", landmarks: [], latency: 10 },
  } as MessageEvent);
  expect(f.result).toHaveBeenLastCalledWith([], 10);
  f.session.stop();
  expect(cpu.terminate).toHaveBeenCalledOnce();
  expect(f.stop).toHaveBeenCalledOnce();
});
