import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { readTranscriptionStream } from "../src/infrastructure/providers/transcription-stream";
import { OpenAISpeechToText } from "../src/infrastructure/providers/openai-voice";
import { readTranscript } from "../src/components/voice/transcript-stream";
import { transcriptionResponse } from "../src/server/voice-stream";
import { VoiceService } from "../src/services/voice-service";
import { ActionService } from "../src/services/action-service";
import { LocalRepository } from "../src/infrastructure/repositories/local";
const encoder = new TextEncoder();
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
function response(events: unknown[], sse = false, split = false) {
  const bytes = encoder.encode(
    events
      .map((e) =>
        sse ? `data: ${JSON.stringify(e)}\r\n\r\n` : JSON.stringify(e) + "\n",
      )
      .join(""),
  );
  return new Response(
    new ReadableStream({
      start(c) {
        if (split) for (const byte of bytes) c.enqueue(new Uint8Array([byte]));
        else c.enqueue(bytes);
        c.close();
      },
    }),
  );
}
it("decodes split UTF-8 SSE and uses authoritative corrected final text", async () => {
  const delta = vi.fn();
  const result = await readTranscriptionStream(
    response(
      [
        { type: "transcript.text.delta", delta: "Café nine" },
        { type: "transcript.text.done", text: "Café 9." },
      ],
      true,
      true,
    ),
    delta,
  );
  expect(delta).toHaveBeenCalledWith("Café nine");
  expect(result.text).toBe("Café 9.");
});
it.each([
  [{ type: "transcript.text.delta", delta: "Partial" }],
  [{ type: "error" }],
  [{ type: "transcript.text.done", text: 123 }],
  [{ type: "transcript.text.delta", delta: "x".repeat(10001) }],
])(
  "rejects broken provider streams instead of accepting partial text %#",
  async (events) => {
    await expect(
      readTranscriptionStream(response([events], true), vi.fn()),
    ).rejects.toThrow();
  },
);
it("supports silence without inventing a transcript", async () => {
  expect(
    await readTranscriptionStream(
      response([{ type: "transcript.text.done", text: "" }], true),
      vi.fn(),
    ),
  ).toEqual({ text: "" });
});
it("keeps JSON provider calls compatible and requests SSE only when asked", async () => {
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ text: "Hello" }))
    .mockResolvedValueOnce(
      response(
        [
          { type: "transcript.text.delta", delta: "Hello" },
          { type: "transcript.text.done", text: "Hello" },
        ],
        true,
      ),
    );
  vi.stubGlobal("fetch", fetcher);
  const stt = new OpenAISpeechToText();
  const audio = new Blob(["audio"], { type: "audio/webm" });
  await stt.transcribe(audio);
  await stt.transcribe(audio, undefined, vi.fn());
  expect(fetcher.mock.calls[0][1].body.has("stream")).toBe(false);
  expect(fetcher.mock.calls[1][1].body.get("stream")).toBe("true");
  expect(fetcher.mock.calls[1][1].body.has("prompt")).toBe(false);
});
it("shows partials while requiring a final transport event", async () => {
  const partial = vi.fn();
  expect(
    await readTranscript(
      response(
        [
          { type: "delta", text: "Café" },
          { type: "complete", text: "Café." },
        ],
        false,
        true,
      ),
      partial,
      new AbortController().signal,
    ),
  ).toEqual({ text: "Café." });
  expect(partial).toHaveBeenCalledWith("Café");
  await expect(
    readTranscript(
      response([{ type: "delta", text: "Partial" }]),
      partial,
      new AbortController().signal,
    ),
  ).rejects.toThrow("ended early");
  await expect(
    readTranscript(
      response([
        { type: "delta", text: "Partial" },
        { type: "error", error: "Audit failed" },
      ]),
      partial,
      new AbortController().signal,
    ),
  ).rejects.toThrow("Audit failed");
});
it("aborts a waiting transcript reader and ignores stale final data", async () => {
  const cancel = vi.fn();
  const controller = new AbortController();
  const reading = readTranscript(
    new Response(new ReadableStream({ cancel })),
    vi.fn(),
    controller.signal,
  );
  controller.abort();
  await expect(reading).rejects.toMatchObject({ name: "AbortError" });
  expect(cancel).toHaveBeenCalledOnce();
});
it("streams early through the existing permission gate but finishes only after action/outcome audit", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ary-stt-audit-"));
  try {
    const repo = new LocalRepository(randomUUID(), join(dir, "data.json"));
    const actions = new ActionService(repo);
    let release!: () => void;
    const auditGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const batch = repo.batch.bind(repo);
    vi.spyOn(repo, "batch").mockImplementation(async (mutations) => {
      await auditGate;
      return batch(mutations);
    });
    const transcribe = vi.fn(
      async (
        _audio: Blob,
        _signal?: AbortSignal,
        delta?: (text: string) => void,
      ) => {
        delta?.("Review the project");
        return { text: "Review the project." };
      },
    );
    const voice = new VoiceService(
      { id: "test", model: "test", transcribe },
      { id: "test", model: "test", synthesize: vi.fn() },
      async () => {},
    );
    const res = await transcriptionResponse(
      actions,
      voice,
      new Blob(["audio"], { type: "audio/webm" }),
      new AbortController().signal,
    );
    const partial = vi.fn();
    let finished = false;
    const reading = readTranscript(
      res,
      partial,
      new AbortController().signal,
    ).then((value) => {
      finished = true;
      return value;
    });
    await vi.waitFor(() =>
      expect(partial).toHaveBeenCalledWith("Review the project"),
    );
    expect(finished).toBe(false);
    expect((await repo.list("actions"))[0].status).toBe("requested");
    release();
    expect(await reading).toEqual({ text: "Review the project." });
    expect((await repo.list("actions"))[0].status).toBe("succeeded");
    expect(await repo.list("outcomes")).toMatchObject([{ status: "success" }]);
    expect(await repo.list("messages")).toEqual([]);
    expect(await repo.list("memories")).toEqual([]);
    await actions.permissions.savePolicy({
      tool: "voice.transcribe",
      level: 0,
      reason: "Deny test",
    });
    await expect(
      transcriptionResponse(
        actions,
        voice,
        new Blob(["audio"], { type: "audio/webm" }),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(transcribe).toHaveBeenCalledOnce();
    expect((await repo.list("actions")).at(-1)?.status).toBe("blocked");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
