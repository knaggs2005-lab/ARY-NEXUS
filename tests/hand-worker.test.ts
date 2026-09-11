import { it, expect, vi, afterEach } from "vitest";
vi.mock("@mediapipe/tasks-vision", () => ({
  FilesetResolver: { forVisionTasks: vi.fn(async () => ({})) },
  HandLandmarker: { createFromOptions: vi.fn() },
}));
import { HandLandmarker } from "@mediapipe/tasks-vision";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
  vi.resetModules();
});
async function setup() {
  const worker = {
    postMessage: vi.fn(),
    onmessage: null as null | ((e: MessageEvent) => Promise<void>),
  };
  vi.stubGlobal("self", worker);
  vi.stubGlobal("OffscreenCanvas", class {});
  await import("../src/components/spatial/hand-worker");
  return worker;
}
const init = {
  data: { type: "init", origin: "http://127.0.0.1:3000" },
} as MessageEvent;
it("uses GPU when available and releases every processed bitmap", async () => {
  const detector = {
    detectForVideo: vi.fn(() => ({ landmarks: [] })),
    close: vi.fn(),
  };
  vi.mocked(HandLandmarker.createFromOptions).mockResolvedValue(
    detector as unknown as HandLandmarker,
  );
  const w = await setup();
  await w.onmessage!(init);
  expect(w.postMessage).toHaveBeenCalledWith({
    type: "ready",
    delegate: "GPU",
  });
  const close = vi.fn();
  await w.onmessage!({
    data: { type: "frame", time: 1, frame: { close } },
  } as MessageEvent);
  expect(close).toHaveBeenCalledOnce();
  expect(w.postMessage.mock.calls.at(-1)?.[0].delegate).toBe("GPU");
});
it("falls back to CPU when GPU startup fails", async () => {
  vi.mocked(HandLandmarker.createFromOptions)
    .mockRejectedValueOnce(new Error("No GPU"))
    .mockResolvedValueOnce({} as HandLandmarker);
  const w = await setup();
  await w.onmessage!(init);
  expect(w.postMessage).toHaveBeenCalledWith({
    type: "ready",
    delegate: "CPU",
  });
  expect(
    vi
      .mocked(HandLandmarker.createFromOptions)
      .mock.calls.map(([, o]) => o.baseOptions?.delegate),
  ).toEqual(["GPU", "CPU"]);
});
it("recovers a lost GPU context on CPU with the same camera frame", async () => {
  const gpu = {
      detectForVideo: vi.fn(() => {
        throw new Error("Context lost");
      }),
      close: vi.fn(),
    },
    cpu = { detectForVideo: vi.fn(() => ({ landmarks: [] })) };
  vi.mocked(HandLandmarker.createFromOptions)
    .mockResolvedValueOnce(gpu as unknown as HandLandmarker)
    .mockResolvedValueOnce(cpu as unknown as HandLandmarker);
  const w = await setup();
  await w.onmessage!(init);
  const close = vi.fn();
  await w.onmessage!({
    data: { type: "frame", time: 1, frame: { close } },
  } as MessageEvent);
  expect(gpu.close).toHaveBeenCalledOnce();
  expect(cpu.detectForVideo).toHaveBeenCalledOnce();
  expect(close).toHaveBeenCalledOnce();
  expect(w.postMessage.mock.calls.at(-1)?.[0]).toMatchObject({
    type: "result",
    delegate: "CPU",
  });
});
it("reports model failure and closes frames when CPU recovery also fails", async () => {
  vi.mocked(HandLandmarker.createFromOptions).mockRejectedValue(
    new Error("Unavailable"),
  );
  const w = await setup();
  await w.onmessage!(init);
  expect(w.postMessage.mock.calls.at(-1)?.[0].type).toBe("error");
  const close = vi.fn();
  await w.onmessage!({
    data: { type: "frame", frame: { close }, time: 1 },
  } as MessageEvent);
  expect(close).toHaveBeenCalledOnce();
  expect(w.postMessage.mock.calls.at(-1)?.[0].type).toBe("error");
});
