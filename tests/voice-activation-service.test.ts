import { describe, expect, it } from "vitest";
import { VoiceActivationService } from "../src/services/voice-activation-service";
function fakes() {
  let wakeHandler: any;
  let endHandler: any;
  const calls: string[] = [];
  const wake = {
    health: () => ({ state: "LISTENING" as const }),
    onEvent: (h: any) => {
      wakeHandler = h;
      return () => {};
    },
    pause: async () => {
      calls.push("pause");
    },
    resume: async () => {
      calls.push("resume");
    },
  };
  const activator = {
    start: async () => {
      calls.push("start");
    },
    stop: async () => {
      calls.push("stop");
    },
    onEnded: (h: any) => {
      endHandler = h;
      return () => {};
    },
  };
  return {
    wake,
    activator,
    calls,
    fire: () =>
      wakeHandler({
        type: "wake.detected",
        detection: {
          wakePhrase: "ARY",
          timestamp: new Date().toISOString(),
          providerId: "local",
          sessionId: "s",
        },
      }),
    end: (e?: Error) => endHandler(e),
  };
}
describe("VoiceActivationService", () => {
  it("pauses before activation and resumes on end", async () => {
    const f = fakes();
    const s = new VoiceActivationService(f.wake, f.activator);
    f.fire();
    await new Promise((r) => setTimeout(r, 0));
    expect(f.calls.slice(0, 2)).toEqual(["pause", "start"]);
    expect(s.state()).toBe("ACTIVE");
    f.end();
    await new Promise((r) => setTimeout(r, 0));
    expect(f.calls).toContain("resume");
    expect(s.state()).toBe("SLEEPING");
  });
  it("ignores duplicate wakes while active", async () => {
    const f = fakes();
    new VoiceActivationService(f.wake, f.activator);
    f.fire();
    f.fire();
    await new Promise((r) => setTimeout(r, 0));
    expect(f.calls.filter((x) => x === "start")).toHaveLength(1);
  });
  it("recovers activation failure", async () => {
    const f = fakes();
    f.activator.start = async () => {
      throw new Error("offline");
    };
    const s = new VoiceActivationService(f.wake, f.activator);
    f.fire();
    await new Promise((r) => setTimeout(r, 0));
    expect(s.state()).toBe("SLEEPING");
    expect(f.calls).toContain("resume");
  });
});
