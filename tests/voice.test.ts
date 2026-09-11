import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { readResponseStream } from "../src/infrastructure/providers/response-stream";
import { OpenAIResponsesProvider } from "../src/infrastructure/providers/openai";
import {
  OpenAISpeechToText,
  OpenAITextToSpeech,
} from "../src/infrastructure/providers/openai-voice";
import {
  SpeechQueue,
  takeSpeechSegments,
} from "../src/components/voice/speech-queue";
import { VoiceService } from "../src/services/voice-service";
import { AryBrainService } from "../src/services/ary-brain-service";
import { LocalRepository } from "../src/infrastructure/repositories/local";
import {
  LocalEmbeddingProvider,
  MockLanguageModel,
} from "../src/infrastructure/providers/local";
import { MemoryService } from "../src/services/memory-service";
import { EntityService } from "../src/services/entity-service";
import { ActionService } from "../src/services/action-service";
import { handle } from "../src/server/http";
import type {
  BrainContext,
  LanguageModelProvider,
} from "../src/domain/providers";
const context: BrainContext = {
  input: "Hello",
  intent: "recall",
  history: [],
  entities: [],
  memories: [],
};
const final = {
  model: "gpt-5.6-sol",
  status: "completed",
  output: [
    {
      type: "message",
      content: [{ type: "output_text", text: "Hello there." }],
    },
  ],
  usage: { input_tokens: 10, output_tokens: 3 },
};
function sse(events: unknown[]) {
  const bytes = new TextEncoder().encode(
    events.map((e) => `data: ${JSON.stringify(e)}\r\n\r\n`).join(""),
  );
  return new Response(
    new ReadableStream({
      start(c) {
        for (const byte of bytes) c.enqueue(new Uint8Array([byte]));
        c.close();
      },
    }),
  );
}
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it("decodes split UTF-8 SSE and requires a completed response", async () => {
  const delta = vi.fn();
  expect(
    await readResponseStream(
      sse([
        { type: "response.output_text.delta", delta: "Olá" },
        { type: "response.completed", response: final },
      ]),
      { onDelta: delta },
    ),
  ).toEqual(final);
  expect(delta).toHaveBeenCalledWith("Olá");
  await expect(
    readResponseStream(
      sse([{ type: "response.output_text.delta", delta: "partial" }]),
      {},
    ),
  ).rejects.toThrow("Incomplete");
  await expect(
    readResponseStream(sse([{ type: "response.failed" }]), {}),
  ).rejects.toThrow("failed");
});
it("streams reasoning through the provider port and retains usage telemetry", async () => {
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  const fetcher = vi.fn().mockResolvedValue(
    sse([
      { type: "response.output_text.delta", delta: "Hello there." },
      { type: "response.completed", response: final },
    ]),
  );
  vi.stubGlobal("fetch", fetcher);
  const log = vi.fn();
  const delta = vi.fn();
  const result = await new OpenAIResponsesProvider(log).reasonWithUsage(
    context,
    { onDelta: delta },
  );
  expect(JSON.parse(fetcher.mock.calls[0][1].body).stream).toBe(true);
  expect(delta).toHaveBeenCalledOnce();
  expect(result.metrics.input_tokens).toBe(10);
  expect(log).toHaveBeenCalledOnce();
});
it("uses separate speech adapters, environment credentials and abort signals", async () => {
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ text: "Hello Ary" }))
    .mockResolvedValueOnce(
      new Response(new Blob(["sound"], { type: "audio/mpeg" })),
    );
  vi.stubGlobal("fetch", fetcher);
  const signal = new AbortController().signal;
  expect(
    await new OpenAISpeechToText().transcribe(
      new Blob(["sound"], { type: "audio/mp4" }),
      signal,
    ),
  ).toEqual({ text: "Hello Ary" });
  expect(fetcher.mock.calls[0][1].body.get("file").name).toBe("recording.mp4");
  expect(fetcher.mock.calls[0][1].headers).not.toHaveProperty("Content-Type");
  expect(
    (await new OpenAITextToSpeech().synthesize("Hello", signal)).size,
  ).toBeGreaterThan(0);
  expect(fetcher.mock.calls[1][1].signal).toBeInstanceOf(AbortSignal);
  expect(JSON.parse(fetcher.mock.calls[1][1].body)).toMatchObject({
    model: "gpt-4o-mini-tts",
    response_format: "mp3",
  });
});
it("bounds speech inputs and records unavailable cost as null with no content", async () => {
  const transcribe = vi.fn().mockResolvedValue({ text: "Hello" });
  const synthesize = vi.fn();
  const log = vi.fn();
  const service = new VoiceService(
    { id: "other", model: "stt", transcribe },
    { id: "other", model: "tts", synthesize },
    log,
  );
  expect(() =>
    service.transcribe(new Blob(["x"], { type: "text/html" })),
  ).toThrow("Unsupported");
  expect(() =>
    service.transcribe(new Blob([], { type: "audio/webm" })),
  ).toThrow("5 MB");
  expect(() => service.synthesize("x".repeat(701))).toThrow("700");
  await service.transcribe(new Blob(["test"], { type: "audio/webm" }));
  expect(log.mock.calls[0][0]).toMatchObject({
    operation: "transcribe",
    estimated_cost_usd: null,
  });
  expect(JSON.stringify(log.mock.calls)).not.toContain("Hello");
});
it("chunks complete sentences early and bounds long segments", () => {
  expect(takeSpeechSegments("Hello Ary. Another thought")).toEqual({
    segments: ["Hello Ary."],
    rest: "Another thought",
  });
  expect(takeSpeechSegments("A final thought", true).segments).toEqual([
    "A final thought",
  ]);
  expect(
    takeSpeechSegments("a".repeat(2000), true).segments.every(
      (t) => t.length <= 600,
    ),
  ).toBe(true);
});
it("cancels queued and late audio so an interrupted answer cannot play", async () => {
  let complete!: (audio: Blob) => void;
  const synthesize = vi.fn(
    () =>
      new Promise<Blob>((r) => {
        complete = r;
      }),
  );
  const play = vi.fn();
  const error = vi.fn();
  const queue = new SpeechQueue({ synthesize, play }, vi.fn(), error);
  queue.add("First sentence. Second sentence.");
  expect(synthesize).toHaveBeenCalledOnce();
  queue.stop();
  complete(new Blob(["audio"]));
  await new Promise((r) => setTimeout(r, 0));
  expect(play).not.toHaveBeenCalled();
  expect(error).not.toHaveBeenCalled();
  queue.add("Ignored.");
  expect(synthesize).toHaveBeenCalledOnce();
});
it("prefetches while preserving playback order", async () => {
  const sentences = ["First", "Second", "Third"].map(
    (prefix) => `${prefix} ${"word ".repeat(65)}sentence.`,
  );
  const played: string[] = [];
  const queue = new SpeechQueue(
    {
      synthesize: async (t) => new Blob([t]),
      play: async (b) => {
        played.push(await b.text());
      },
    },
    vi.fn(),
    vi.fn(),
  );
  queue.add(sentences.join(" "), true);
  await vi.waitFor(() => expect(played).toEqual(sentences));
});
it("speaks a complete task approval response as one utterance instead of changing clips per sentence", async () => {
  const text =
    "I propose creating a task for Wag Trails. No task has been created yet. Review the details below to approve or reject it.";
  const synthesize = vi.fn(async (input: string) => new Blob([input]));
  const played: string[] = [];
  const queue = new SpeechQueue(
    {
      synthesize,
      play: async (blob) => {
        played.push(await blob.text());
      },
    },
    vi.fn(),
    vi.fn(),
  );
  queue.add(text);
  queue.add("", true);
  await vi.waitFor(() => expect(played).toEqual([text]));
  expect(synthesize).toHaveBeenCalledOnce();
});

it("bounds combined speech without losing or duplicating text", async () => {
  const text = "A short sentence. ".repeat(90).trim();
  const played: string[] = [];
  const queue = new SpeechQueue(
    {
      synthesize: async (input) => {
        expect(input.length).toBeLessThanOrEqual(600);
        return new Blob([input]);
      },
      play: async (blob) => {
        played.push(await blob.text());
      },
    },
    vi.fn(),
    vi.fn(),
  );
  queue.add(text, true);
  await vi.waitFor(() => expect(played.join(" ")).toBe(text));
  expect(played.length).toBeGreaterThan(1);
});
it("keeps voice conversation continuity and extracts saved facts after reasoning cancellation", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ary-voice-test-"));
  try {
    const repo = new LocalRepository(randomUUID(), join(dir, "test.json"));
    const memories = new MemoryService(repo, new LocalEmbeddingProvider());
    const entities = new EntityService(repo);
    const controller = new AbortController();
    const mock = new MockLanguageModel();
    const llm: LanguageModelProvider = {
      name: "Test",
      identifyIntent: mock.identifyIntent.bind(mock),
      reason: mock.reason.bind(mock),
      extractMemories: mock.extractMemories.bind(mock),
      reasonWithUsage: async (_c, options) => {
        options?.onDelta?.("A partial answer");
        controller.abort();
        options?.signal?.throwIfAborted();
        throw new Error("unreachable");
      },
    };
    const brain = new AryBrainService(
      repo,
      memories,
      entities,
      llm,
      new ActionService(repo),
    );
    const conversation = await repo.insert("conversations", {
      title: "Voice test",
      metadata: {},
    });
    const events = [];
    for await (const event of brain.respond(
      {
        input: "Remember: I prefer quiet morning walks.",
        modality: "voice",
        conversation_id: conversation.id,
      },
      { signal: controller.signal, onDelta: vi.fn() },
    ))
      events.push(event);
    expect(events.map((e) => e.type)).toEqual([
      "entities",
      "cancelled",
      "complete",
    ]);
    const messages = await repo.list("messages");
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      conversation_id: conversation.id,
      metadata: { modality: "voice", response_status: "cancelled" },
    });
    expect((await repo.list("memories"))[0].content).toBe(
      "I prefer quiet morning walks.",
    );
    expect((await repo.list("extraction_jobs"))[0].status).toBe("completed");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it("requires authentication and same-origin access for speech endpoints", async () => {
  vi.stubEnv("ARY_STORAGE", "supabase");
  for (const route of ["transcribe", "speak"]) {
    expect(
      (
        await handle(
          new Request(`http://localhost/api/voice/${route}`, {
            method: "POST",
            body: "x",
          }),
          ["voice", route],
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await handle(
          new Request(`http://localhost/api/voice/${route}`, {
            method: "POST",
            headers: { origin: "https://untrusted.example" },
            body: "x",
          }),
          ["voice", route],
        )
      ).status,
    ).toBe(403);
  }
});
