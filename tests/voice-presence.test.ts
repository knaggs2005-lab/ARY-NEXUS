import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import {
  voiceState,
  voiceLabels,
  type VoiceState,
} from "../src/components/voice/voice-state";
import { VoicePresence } from "../src/components/voice/voice-presence";
import { audioLevel } from "../src/components/voice/input-meter";
import { SpeechQueue } from "../src/components/voice/speech-queue";
const ready = {
  capture: "idle",
  playback: "idle",
  generating: false,
  busy: false,
  preview: false,
  interrupted: false,
  error: "",
} as const;
it.each(Object.keys(voiceLabels) as VoiceState[])(
  "exposes a readable %s state without relying on animation",
  (state) => {
    const level = { current: 0 };
    const html = renderToStaticMarkup(
      createElement(VoicePresence, { state, level }),
    );
    expect(html).toContain(voiceLabels[state][0]);
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-hidden="true"');
  },
);
it("prioritizes current capture, playback, interruption and transcript over background saves", () => {
  expect(
    voiceState({
      ...ready,
      capture: "listening",
      busy: true,
      interrupted: true,
    }),
  ).toBe("listening");
  expect(
    voiceState({
      ...ready,
      playback: "speaking",
      generating: true,
      busy: true,
    }),
  ).toBe("speaking");
  expect(voiceState({ ...ready, interrupted: true, generating: true })).toBe(
    "interrupted",
  );
  expect(voiceState({ ...ready, preview: true, busy: true })).toBe("review");
  expect(voiceState({ ...ready, generating: true })).toBe("thinking");
  expect(voiceState({ ...ready, busy: true })).toBe("saving");
  expect(voiceState({ ...ready, error: "Failed" })).toBe("error");
});
it("measures real microphone energy, clamps peaks and keeps silence at zero", () => {
  expect(audioLevel(new Float32Array(256))).toBe(0);
  expect(audioLevel(new Float32Array([0.1, -0.1]))).toBeCloseTo(0.5);
  expect(audioLevel(new Float32Array([1, -1]))).toBe(1);
  expect(audioLevel(new Float32Array())).toBe(0);
});
it("prefetches a newly streamed sentence while the previous sentence is still playing", async () => {
  const releases: Array<() => void> = [];
  const synthesize = vi.fn(async (text: string) => new Blob([text]));
  const played: string[] = [];
  const queue = new SpeechQueue(
    {
      synthesize,
      play: async (blob) => {
        played.push(await blob.text());
        await new Promise<void>((r) => releases.push(r));
      },
    },
    vi.fn(),
    vi.fn(),
  );
  queue.add("First sentence.");
  await vi.waitFor(() => expect(played).toEqual(["First sentence."]));
  queue.add("Second sentence.");
  await vi.waitFor(() => expect(synthesize).toHaveBeenCalledTimes(2));
  expect(played).toHaveLength(1);
  releases[0]();
  await vi.waitFor(() =>
    expect(played).toEqual(["First sentence.", "Second sentence."]),
  );
  releases[1]();
  queue.stop();
});
it("stops current playback and drops prefetched speech when interrupted", async () => {
  let playbackSignal: AbortSignal | undefined;
  const played = vi.fn(async (_blob: Blob, signal: AbortSignal) => {
    playbackSignal = signal;
    await new Promise<void>((resolve) =>
      signal.addEventListener("abort", () => resolve(), { once: true }),
    );
  });
  const queue = new SpeechQueue(
    { synthesize: async (text) => new Blob([text]), play: played },
    vi.fn(),
    vi.fn(),
  );
  queue.add("First. Second.", true);
  await vi.waitFor(() => expect(played).toHaveBeenCalledOnce());
  queue.stop();
  expect(playbackSignal?.aborted).toBe(true);
  await new Promise((r) => setTimeout(r, 0));
  expect(played).toHaveBeenCalledOnce();
});
