import { it, expect, vi } from "vitest";
import {
  LocalWakeWordProvider,
  loadWakeAssets,
} from "../src/infrastructure/wake/local-wake-word";
import { WakeWordService } from "../src/services/wake-word-service";
const config = { phrases: ["HEY_ARY"] as const, enabled: true };
function setup() {
  let frame: (f: any) => void = () => {};
  let now = 0;
  const stops = vi.fn(async () => {}),
    process = vi.fn(async () => 0.95),
    close = vi.fn(async () => {});
  const capture = {
    start: vi.fn(async (_c, onFrame) => {
      frame = onFrame;
      return {
        health: {
          state: "CAPTURING" as const,
          microphone_active: true,
          sample_rate_hz: 24000,
          channels: 1 as const,
          frame_count: 0,
        },
        pause() {},
        resume() {},
        stop: stops,
      };
    }),
  };
  const provider = new LocalWakeWordProvider(
    capture,
    async () => ({ manifest: {} as any, models: new Map() }),
    async () => ({ process, reset() {}, close }),
    () => now,
  );
  return {
    provider,
    capture,
    process,
    close,
    stops,
    advance: () => (now += 2000),
    frames: () => {
      for (let n = 0; n < 4; n++)
        frame({
          sample_rate_hz: 24000,
          channels: 1,
          data: new Uint8Array(960),
        });
    },
  };
}
it("disabled/missing setup fails before microphone or model downloads", async () => {
  const capture = { start: vi.fn() };
  const assets = vi.fn();
  const p = new LocalWakeWordProvider(capture, assets);
  await expect(p.start({ ...config, enabled: false })).rejects.toThrow(
    "WAKE_DISABLED",
  );
  await expect(p.start(config)).rejects.toThrow(
    "WAKE_MODEL_OWNER_SETUP_REQUIRED",
  );
  expect(capture.start).not.toHaveBeenCalled();
  expect(assets).not.toHaveBeenCalled();
});
it("releases rather than retaining a paused mic, reacquires, stops once", async () => {
  const f = setup(),
    s = await f.provider.start(config);
  await s.pause();
  expect(f.stops).toHaveBeenCalledOnce();
  expect(s.state).toBe("PAUSED");
  await s.resume();
  expect(f.capture.start).toHaveBeenCalledTimes(2);
  await s.stop();
  await s.stop();
  expect(f.close).toHaveBeenCalledOnce();
  expect(s.state).toBe("STOPPED");
});
it("startup suppression, confidence, cooldown and playback suppression use local evidence only", async () => {
  const f = setup(),
    service = new WakeWordService(f.provider);
  const events: any[] = [];
  service.onEvent((e) => events.push(e));
  await service.start(config);
  f.frames();
  await new Promise((r) => setTimeout(r, 0));
  expect(events).toHaveLength(0);
  f.advance();
  service.setPlaybackActive(true);
  f.frames();
  await new Promise((r) => setTimeout(r, 0));
  expect(events).toHaveLength(0);
  f.advance();
  service.setPlaybackActive(false);
  f.frames();
  await new Promise((r) => setTimeout(r, 0));
  expect(events).toHaveLength(1);
  expect(JSON.stringify(events)).not.toContain("audio");
  await service.stop();
});
it("engine failure releases capture and reports failed health", async () => {
  const f = setup(),
    service = new WakeWordService(f.provider);
  await service.start(config);
  f.process.mockRejectedValueOnce(new Error("internal"));
  f.frames();
  await new Promise((r) => setTimeout(r, 0));
  expect(service.health()).toMatchObject({
    state: "FAILED",
    microphoneActive: false,
  });
  expect(f.stops).toHaveBeenCalled();
  await service.stop();
});
it("model loader only accepts fixed local manifests and rejects absent assets", async () => {
  const fetcher = vi.fn(
    async (_url: RequestInfo | URL, _options?: RequestInit) =>
      new Response("", { status: 404 }),
  );
  await expect(loadWakeAssets(fetcher as typeof fetch)).rejects.toThrow(
    "WAKE_MODEL_OWNER_SETUP_REQUIRED",
  );
  expect(fetcher.mock.calls[0][0]).toBe("/models/ary-wake/manifest.json");
});
it("opt-in verification ring is bounded, survives release only until taken, and never enters events", async () => {
  const f = setup(),
    s = await f.provider.start({ ...config, verificationAudio: true });
  for (let i = 0; i < 45; i++) {
    f.frames();
    for (let j = 0; j < 12; j++) await Promise.resolve();
  }
  await s.pause();
  const sample = s.takeVerificationAudio!();
  expect(sample.length).toBe(48000);
  expect(s.takeVerificationAudio!().length).toBe(0);
  sample.fill(0);
  await s.stop();
  const none = await f.provider.start(config);
  f.frames();
  await none.pause();
  expect(none.takeVerificationAudio!().length).toBe(0);
  await none.stop();
});
it("stopped acoustic sessions cannot reacquire through pause/resume", async () => {
  const f = setup(),
    s = await f.provider.start(config);
  await s.stop();
  await s.pause();
  await s.resume();
  expect(s.state).toBe("STOPPED");
  expect(f.capture.start).toHaveBeenCalledOnce();
});
