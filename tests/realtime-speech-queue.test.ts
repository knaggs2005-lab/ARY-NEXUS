import { it, expect, vi } from "vitest";
import { RealtimeSpeechQueue } from "../src/services/realtime-speech-queue";
it("speaks every canonical word once in order, waiting for delivery to drain", async () => {
  const listeners = new Set<(event: any) => void>();
  const spoken: string[] = [];
  let drain = () => {};
  const session: any = {
    onEvent: (h: any) => {
      listeners.add(h);
      return () => listeners.delete(h);
    },
    speakText: (text: string) => {
      spoken.push(text);
      listeners.forEach((h) => h({ type: "state", state: "IDLE" }));
    },
  };
  const drained = vi.fn(
    () =>
      new Promise<void>((r) => {
        drain = r;
      }),
  );
  const s = new RealtimeSpeechQueue(session, drained);
  const text =
    "First prepare the internal task for approval. Then explain the task and its source evidence without running it.";
  const run = s.speak(text, new AbortController().signal);
  for (let i = 0; i < 20; i++) await Promise.resolve();
  expect(spoken).toHaveLength(1);
  for (let i = 0; i < 12; i++) {
    drain();
    for (let j = 0; j < 20; j++) await Promise.resolve();
  }
  await run;
  expect(spoken.join(" ")).toBe(text);
  expect(spoken.every((x) => x.length <= 24)).toBe(true);
  expect(listeners.size).toBe(0);
});
it("barge-in cancels remaining fragments without replaying them or authorizing an action", async () => {
  const abort = new AbortController(),
    listeners = new Set<(event: any) => void>();
  const session: any = {
    onEvent: (h: any) => {
      listeners.add(h);
      return () => listeners.delete(h);
    },
    speakText: vi.fn(() => {}),
  };
  const queue = new RealtimeSpeechQueue(session, async () => {});
  const run = queue.speak(
    "This canonical answer has enough words for several fragments. Do not repeat after cancellation.",
    abort.signal,
  );
  abort.abort();
  await run;
  expect(session.speakText).toHaveBeenCalledOnce();
  expect(listeners.size).toBe(0);
});
