import { describe, expect, it, vi } from "vitest";
import { WakeWordService } from "../src/services/wake-word-service";
import type {
  WakeWordEvent,
  WakeWordProvider,
  WakeWordSession,
} from "../src/domain/wake-word";

function provider() {
  let emit = (_e: WakeWordEvent) => {};
  let stopped = false;
  const p: WakeWordProvider = {
    id: "fake-local",
    localOnly: true,
    async start() {
      const s: WakeWordSession = {
        id: "session",
        state: "LISTENING",
        pause: async () => {},
        resume: async () => {},
        stop: async () => {
          stopped = true;
        },
        onEvent: (h) => {
          emit = h;
          return () => {};
        },
      };
      return s;
    },
  };
  return {
    p,
    fire: (phrase: "ARY" | "HEY_ARY" | "NEXUS") =>
      emit({
        type: "wake.detected",
        detection: {
          wakePhrase: phrase,
          timestamp: new Date().toISOString(),
          providerId: "fake-local",
          sessionId: "session",
        },
      }),
    stopped: () => stopped,
  };
}
describe("WakeWordService", () => {
  it("starts, pauses, resumes and stops locally", async () => {
    const f = provider();
    const s = new WakeWordService(f.p);
    expect((await s.start({ phrases: ["ARY"] })).state).toBe("LISTENING");
    await s.pause();
    expect(s.health().state).toBe("PAUSED");
    await s.resume();
    expect(s.health().state).toBe("LISTENING");
    await s.stop();
    expect(s.health().state).toBe("STOPPED");
    expect(f.stopped()).toBe(true);
    await s.stop();
  });
  it("debounces duplicate detections and suppresses playback", async () => {
    const f = provider();
    const s = new WakeWordService(f.p);
    await s.start({ phrases: ["ARY"], cooldownMs: 10000 });
    f.fire("ARY");
    expect(s.health().state).toBe("WAKE_DETECTED");
    f.fire("ARY");
    s.setPlaybackActive(true);
    f.fire("HEY_ARY");
    expect(s.health().state).toBe("WAKE_DETECTED");
  });
  it("does not acquire microphone when disabled", async () => {
    const start = vi.fn();
    const p: WakeWordProvider = { id: "fake", localOnly: true, start };
    const s = new WakeWordService(p);
    expect((await s.start({ phrases: ["ARY"], enabled: false })).state).toBe(
      "STOPPED",
    );
    expect(start).not.toHaveBeenCalled();
  });
  it("reports microphone failure", async () => {
    const p: WakeWordProvider = {
      id: "fake",
      localOnly: true,
      async start() {
        throw new Error("permission denied");
      },
    };
    const s = new WakeWordService(p);
    expect((await s.start({ phrases: ["ARY"] })).state).toBe("FAILED");
    expect(s.health().microphoneActive).toBe(false);
  });
});
