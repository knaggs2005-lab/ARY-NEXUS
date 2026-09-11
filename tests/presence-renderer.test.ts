import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  dispose: vi.fn(),
  draw: vi.fn(),
  compile: vi.fn(async () => {}),
  init: vi.fn(),
  error: undefined as undefined | (() => void),
}));
vi.mock("vgpu", () => ({
  init: mock.init,
  surface: () => ({ format: "rgba8unorm" }),
  effect: () => ({ compile: mock.compile, set: vi.fn() }),
  frame: (_gpu: unknown, fn: (frame: unknown) => void) =>
    fn({
      pass: (_output: unknown, run: (p: unknown) => void) =>
        run({ draw: mock.draw }),
    }),
}));
import { createPresenceRenderer } from "../src/components/presence/renderer";
let frames: Map<number, FrameRequestCallback>,
  seq: number,
  visible: (entries: unknown[]) => void;
let doc: EventTarget & { hidden: boolean };
beforeEach(() => {
  vi.clearAllMocks();
  frames = new Map();
  seq = 0;
  doc = Object.assign(new EventTarget(), { hidden: false });
  vi.stubGlobal("document", doc);
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => {
    frames.set(++seq, fn);
    return seq;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(fn: typeof visible) {
        visible = fn;
      }
      observe() {
        visible([{ isIntersecting: true }]);
      }
      disconnect() {}
    },
  );
  mock.init.mockResolvedValue({
    dispose: mock.dispose,
    onError: (fn: () => void) => {
      mock.error = fn;
      return () => {};
    },
    gpu: { lost: new Promise(() => {}) },
  });
});
afterEach(() => vi.unstubAllGlobals());
function tick(now: number) {
  const callbacks = [...frames.values()];
  frames.clear();
  callbacks.forEach((fn) => fn(now));
}
const canvas = () => ({ style: { opacity: "0" } }) as HTMLCanvasElement;
it("draws static idle once then has no animation loop", async () => {
  const abort = new AbortController();
  await createPresenceRenderer(
    canvas(),
    () => ({ state: "idle", energy: 0 }),
    abort.signal,
    vi.fn(),
  );
  tick(100);
  expect(mock.draw).toHaveBeenCalledTimes(1);
  expect(frames.size).toBe(0);
  abort.abort();
  expect(mock.dispose).toHaveBeenCalledTimes(1);
});
it("caps active rendering to 24fps and stops when hidden", async () => {
  const abort = new AbortController();
  await createPresenceRenderer(
    canvas(),
    () => ({ state: "thinking", energy: 0 }),
    abort.signal,
    vi.fn(),
  );
  tick(100);
  tick(116);
  tick(133);
  tick(150);
  expect(mock.draw).toHaveBeenCalledTimes(2);
  doc.hidden = true;
  tick(200);
  expect(frames.size).toBe(0);
  doc.hidden = false;
  doc.dispatchEvent(new Event("visibilitychange"));
  expect(frames.size).toBe(1);
  abort.abort();
  expect(frames.size).toBe(0);
});
it("stops offscreen and resumes only on visibility", async () => {
  const abort = new AbortController();
  await createPresenceRenderer(
    canvas(),
    () => ({ state: "retrieving", energy: 0 }),
    abort.signal,
    vi.fn(),
  );
  visible([{ isIntersecting: false }]);
  tick(100);
  expect(mock.draw).not.toHaveBeenCalled();
  expect(frames.size).toBe(0);
  visible([{ isIntersecting: true }]);
  tick(200);
  expect(mock.draw).toHaveBeenCalledTimes(1);
  abort.abort();
});
it("releases GPU after cancellation during async initialization", async () => {
  let resolve!: (value: unknown) => void;
  mock.init.mockReturnValueOnce(
    new Promise((r) => {
      resolve = r;
    }),
  );
  const abort = new AbortController();
  const pending = createPresenceRenderer(
    canvas(),
    () => ({ state: "idle", energy: 0 }),
    abort.signal,
    vi.fn(),
  );
  abort.abort();
  resolve({ dispose: mock.dispose });
  await pending;
  expect(mock.dispose).toHaveBeenCalledOnce();
  expect(mock.compile).not.toHaveBeenCalled();
});
it("device errors dispose resources and request static fallback", async () => {
  const abort = new AbortController(),
    failed = vi.fn();
  await createPresenceRenderer(
    canvas(),
    () => ({ state: "acting", energy: 0 }),
    abort.signal,
    failed,
  );
  mock.error?.();
  expect(failed).toHaveBeenCalledOnce();
  expect(mock.dispose).toHaveBeenCalledOnce();
  expect(frames.size).toBe(0);
  abort.abort();
});
it("sustained missed frame budget falls back instead of running a struggling loop", async () => {
  const abort = new AbortController(),
    failed = vi.fn();
  await createPresenceRenderer(
    canvas(),
    () => ({ state: "acting", energy: 0 }),
    abort.signal,
    failed,
  );
  for (let n = 1; n <= 10; n++) tick(n * 200);
  expect(failed).toHaveBeenCalledOnce();
  expect(frames.size).toBe(0);
  abort.abort();
});
