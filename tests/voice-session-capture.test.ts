import { afterEach, expect, it, vi } from "vitest";
import { capturePCM } from "../src/components/voice/pcm-capture";
import { microphoneLease } from "../src/components/voice/microphone-lease";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const fakeStream = () => {
  const stop = vi.fn();
  return {
    stop,
    stream: { getTracks: () => [{ stop }] } as unknown as MediaStream,
  };
};
it("releases the microphone if AudioContext construction fails", async () => {
  const { stream, stop } = fakeStream();
  vi.stubGlobal(
    "AudioContext",
    class {
      constructor() {
        throw Error("audio unavailable");
      }
    },
  );
  await expect(
    capturePCM(stream, new AbortController().signal, vi.fn()),
  ).rejects.toThrow("audio unavailable");
  expect(stop).toHaveBeenCalledOnce();
});
it("abort during worklet loading closes context and ignores the late module", async () => {
  const { stream, stop } = fakeStream(),
    controller = new AbortController();
  let finish!: () => void;
  const close = vi.fn(async () => {}),
    source = vi.fn();
  vi.stubGlobal(
    "AudioContext",
    class {
      close = close;
      createMediaStreamSource = source;
      audioWorklet = {
        addModule: () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      };
    },
  );
  const pending = capturePCM(stream, controller.signal, vi.fn());
  controller.abort();
  finish();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(stop).toHaveBeenCalledOnce();
  expect(close).toHaveBeenCalledOnce();
  expect(source).not.toHaveBeenCalled();
});
it("delivers PCM and disconnects once without delivering stale port messages", async () => {
  const { stream, stop } = fakeStream(),
    controller = new AbortController(),
    receive = vi.fn();
  const close = vi.fn(async () => {}),
    disconnect = vi.fn();
  let port!: {
    onmessage: ((event: MessageEvent<Float32Array>) => void) | null;
  };
  vi.stubGlobal(
    "AudioContext",
    class {
      state = "running";
      sampleRate = 48000;
      destination = {};
      close = close;
      resume = async () => {};
      audioWorklet = { addModule: async () => {} };
      createMediaStreamSource() {
        return { connect() {}, disconnect };
      }
    },
  );
  vi.stubGlobal(
    "AudioWorkletNode",
    class {
      port = (port = { onmessage: null });
      connect() {}
      disconnect = disconnect;
    },
  );
  const release = await capturePCM(stream, controller.signal, receive);
  const callback = port.onmessage!;
  callback({ data: new Float32Array([0.1]) } as MessageEvent<Float32Array>);
  expect(receive).toHaveBeenCalledOnce();
  controller.abort();
  release();
  callback({ data: new Float32Array([0.2]) } as MessageEvent<Float32Array>);
  expect(receive).toHaveBeenCalledOnce();
  expect(stop).toHaveBeenCalledOnce();
  expect(close).toHaveBeenCalledOnce();
  expect(disconnect).toHaveBeenCalledTimes(2);
});
it("does not silently start a second continuous session in another window", async () => {
  let held = false;
  vi.stubGlobal("navigator", {
    locks: {
      request: async (
        _name: string,
        _options: unknown,
        work: (lock: object | null) => Promise<void>,
      ) => {
        if (held) return work(null);
        held = true;
        try {
          await work({});
        } finally {
          held = false;
        }
      },
    },
  });
  const first = new AbortController();
  await microphoneLease(first.signal);
  await expect(microphoneLease(new AbortController().signal)).rejects.toThrow(
    "Another Ary window",
  );
  first.abort();
  await new Promise((r) => setTimeout(r, 0));
  const second = new AbortController();
  await microphoneLease(second.signal);
  second.abort();
});
it("fails closed without Web Locks and after a cancelled lock grant", async () => {
  vi.stubGlobal("navigator", {});
  await expect(microphoneLease(new AbortController().signal)).rejects.toThrow(
    "session locking",
  );
  const controller = new AbortController();
  controller.abort();
  await expect(microphoneLease(controller.signal)).rejects.toMatchObject({
    name: "AbortError",
  });
});
