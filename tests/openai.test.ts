import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  OpenAIResponsesProvider,
  OpenAIEmbeddingProvider,
  OPENAI_EMBEDDING_VERSION,
  reasoningPayload,
} from "../src/infrastructure/providers/openai";
import { estimateCost, type ModelMetric } from "../src/domain/telemetry";
import { LocalRepository } from "../src/infrastructure/repositories/local";
import { LocalEmbeddingProvider } from "../src/infrastructure/providers/local";
import { MemoryService } from "../src/services/memory-service";
import { ReembeddingService } from "../src/services/reembedding-service";
import { services } from "../src/server/context";
import type { BrainContext } from "../src/domain/providers";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
const context: BrainContext = {
  input: "What is my project?",
  intent: "recall",
  entities: [],
  memories: [],
  history: [],
};
it("uses Responses, reads the key from env, bounds context and logs usage without content", async () => {
  vi.stubEnv("OPENAI_API_KEY", "test-only-env-value");
  const call = vi.fn().mockResolvedValue(
    Response.json({
      model: "gpt-5.6-sol",
      status: "completed",
      output: [
        { type: "reasoning" },
        {
          type: "message",
          content: [{ type: "output_text", text: "No relevant memory." }],
        },
      ],
      usage: {
        input_tokens: 100,
        output_tokens: 20,
        input_tokens_details: { cached_tokens: 40 },
      },
    }),
  );
  vi.stubGlobal("fetch", call);
  const logs: ModelMetric[] = [];
  const provider = new OpenAIResponsesProvider(async (m) => {
    logs.push(m);
  });
  expect(await provider.reason(context)).toBe("No relevant memory.");
  expect(call.mock.calls[0][0]).toBe("https://api.openai.com/v1/responses");
  const request = JSON.parse(call.mock.calls[0][1].body);
  expect(request.model).toBe("gpt-5.6-sol");
  expect(request.store).toBe(false);
  expect(request).not.toHaveProperty("tools");
  expect(logs[0]).toMatchObject({
    model: "gpt-5.6-sol",
    input_tokens: 100,
    cached_input_tokens: 40,
    output_tokens: 20,
    retrieval_count: 0,
    status: "succeeded",
  });
  expect(logs[0].estimated_cost_usd).toBeCloseTo(0.000656);
  expect(JSON.stringify(logs)).not.toContain("test-only-env-value");
  expect(JSON.stringify(logs)).not.toContain(context.input);
  const bounded = reasoningPayload({
    ...context,
    history: Array(30).fill({
      role: "user",
      content: "a".repeat(3000),
      metadata: { secret: "database dump" },
    }),
  });
  expect(bounded.history).toHaveLength(6);
  expect(bounded.history[0].content).toHaveLength(1500);
  expect(JSON.stringify(bounded)).not.toContain("database dump");
});
it("records failures without returning private upstream messages or silently using a stub", async () => {
  vi.stubEnv("OPENAI_API_KEY", "test-only-env-value");
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      Response.json(
        {
          error: {
            code: "insufficient_quota",
            message: "private upstream body",
          },
        },
        { status: 429 },
      ),
    ),
  );
  const logs: ModelMetric[] = [];
  await expect(
    new OpenAIResponsesProvider(async (m) => {
      logs.push(m);
    }).reason(context),
  ).rejects.toThrow("insufficient_quota");
  expect(JSON.stringify(logs)).not.toContain("private upstream body");
  expect(logs[0].input_tokens).toBeNull();
  expect(logs[0].estimated_cost_usd).toBeNull();
});
it("requests the configured embedding dimensions and validates vectors", async () => {
  vi.stubEnv("OPENAI_API_KEY", "test-only-env-value");
  const call = vi.fn().mockResolvedValue(
    Response.json({
      model: "text-embedding-3-large",
      data: [{ index: 0, embedding: [1, ...Array(383).fill(0)] }],
      usage: { total_tokens: 5 },
    }),
  );
  vi.stubGlobal("fetch", call);
  const provider = new OpenAIEmbeddingProvider(async () => {});
  expect((await provider.embed("fixture")).length).toBe(384);
  expect(JSON.parse(call.mock.calls[0][1].body)).toMatchObject({
    model: "text-embedding-3-large",
    dimensions: 384,
  });
  expect(provider.version).toBe(OPENAI_EMBEDDING_VERSION);
  expect(estimateCost("unknown-model", 1, 0, 1)).toBeNull();
});
it("re-embeds every memory state idempotently and keeps versions from mixing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ary-reembed-"));
  try {
    const repo = new LocalRepository(randomUUID(), join(dir, "data.json"));
    const local = new LocalEmbeddingProvider();
    const memory = new MemoryService(repo, local);
    const active = await memory.createMemory({
      content: "Ary Nexus stores durable knowledge",
    });
    const archived = await memory.createMemory({
      content: "Archived knowledge",
    });
    await memory.archiveMemory(archived.id);
    const old = await memory.createMemory({ content: "Superseded knowledge" });
    await repo.update("memories", old.id, { status: "superseded" });
    const embedding = {
      modelId: "text-embedding-3-large",
      version: "test-v2",
      dimensions: 384,
      embed: vi.fn((text: string) => local.embed(text)),
    };
    const task = new ReembeddingService(repo, embedding);
    expect((await task.run()).updated).toBe(3);
    expect((await task.run()).updated).toBe(0);
    expect(embedding.embed).toHaveBeenCalledTimes(3);
    const row = await repo.get("memories", active.id);
    expect(row?.embedding_version).toBe("test-v2");
    expect(row?.embedding_input_hash).toHaveLength(64);
    expect(
      (await repo.get("memories", archived.id))?.archived_at,
    ).not.toBeNull();
    const hits = await repo.search(
      "unrelated question",
      await local.embed("Ary Nexus stores durable knowledge"),
      "text-embedding-3-large",
      8,
      "wrong-version",
      0.2,
    );
    expect(hits).toHaveLength(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it("classifies exhausted credits without treating them as transient rate limits", async () => {
  vi.stubEnv("OPENAI_API_KEY", "test-only-env-value");
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      Response.json(
        {
          error: {
            code: "credit_balance_exhausted",
            type: "insufficient_quota",
            message: "private body",
          },
        },
        { status: 429 },
      ),
    ),
  );
  const logs: ModelMetric[] = [];
  await expect(
    new OpenAIEmbeddingProvider(async (metric) => {
      logs.push(metric);
    }).embed("fixture"),
  ).rejects.toThrow("Add API credits");
  expect(logs[0].error_code).toBe("credit_balance_exhausted");
  expect(JSON.stringify(logs)).not.toContain("private body");
});
it("stops failed re-embedding without changing stored vectors or declaring completion", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ary-reembed-failure-"));
  try {
    const repo = new LocalRepository(randomUUID(), join(dir, "data.json"));
    const memory = new MemoryService(repo, new LocalEmbeddingProvider());
    const first = await memory.createMemory({ content: "First durable fact" });
    await memory.createMemory({ content: "Second durable fact" });
    const embed = vi.fn(async () => {
      throw new Error("upstream private body");
    });
    const result = await new ReembeddingService(repo, {
      modelId: "next-model",
      version: "next-version",
      dimensions: 384,
      embed,
    }).run();
    expect(result).toMatchObject({ updated: 0, failed: 1, remaining: 2 });
    expect(embed).toHaveBeenCalledTimes(1);
    expect(result.error).not.toContain("private body");
    expect((await repo.get("memories", first.id))?.embedding).toEqual(
      first.embedding,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it("returns actual model identity and metrics for the response that produced them", async () => {
  vi.stubEnv("OPENAI_API_KEY", "test-only-env-value");
  vi.stubEnv("OPENAI_ORGANIZATION_ID", "fixture-org");
  vi.stubEnv("OPENAI_PROJECT_ID", "fixture-project");
  const call = vi.fn().mockResolvedValue(
    Response.json({
      model: "gpt-5.6-sol-fixture",
      status: "completed",
      output: [
        {
          type: "message",
          content: [{ type: "output_text", text: "Recorded evidence" }],
        },
      ],
      usage: { input_tokens: 100, output_tokens: 20 },
    }),
  );
  vi.stubGlobal("fetch", call);
  const result = await new OpenAIResponsesProvider(
    async () => {},
  ).reasonWithUsage(context);
  expect(result).toMatchObject({
    content: "Recorded evidence",
    provider: "openai",
    model: "gpt-5.6-sol-fixture",
    metrics: { input_tokens: 100, output_tokens: 20, retrieval_count: 0 },
  });
  expect(call.mock.calls[0][1].headers).toMatchObject({
    "OpenAI-Organization": "fixture-org",
    "OpenAI-Project": "fixture-project",
  });
});

it("requires explicit flags to select development providers", () => {
  vi.stubEnv("ARY_LLM_PROVIDER", undefined);
  vi.stubEnv("ARY_EMBEDDING_PROVIDER", undefined);
  const repo = new LocalRepository(
    randomUUID(),
    join(tmpdir(), "unused-ary-provider-fixture.json"),
  );
  expect(services(repo).provider).toBe("gpt-5.6-sol");
  expect(services(repo).embeddingModel).toBe("text-embedding-3-large");
  vi.stubEnv("ARY_LLM_PROVIDER", "mock");
  vi.stubEnv("ARY_EMBEDDING_PROVIDER", "local");
  expect(services(repo).provider).toBe("Development stub");
  expect(services(repo).embeddingModel).toMatch(/^local/);
});

it("batch embeddings restore input order and log one request cost", async () => {
  vi.stubEnv("OPENAI_API_KEY", "test-only-env-value");
  const a = [1, ...Array(383).fill(0)],
    b = [2, ...Array(383).fill(0)];
  const call = vi.fn().mockResolvedValue(
    Response.json({
      model: "text-embedding-3-large",
      data: [
        { index: 1, embedding: b },
        { index: 0, embedding: a },
      ],
      usage: { total_tokens: 9 },
    }),
  );
  vi.stubGlobal("fetch", call);
  const metrics = vi.fn(async () => {});
  expect(
    await new OpenAIEmbeddingProvider(metrics).embedMany(["first", "second"]),
  ).toEqual([a, b]);
  expect(call).toHaveBeenCalledOnce();
  expect(JSON.parse(call.mock.calls[0][1].body).input).toEqual([
    "first",
    "second",
  ]);
  expect(metrics).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ input_tokens: 9, status: "succeeded" }),
  );
});
it("rejects malformed batch indexes", async () => {
  vi.stubEnv("OPENAI_API_KEY", "test-only-env-value");
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      Response.json({
        model: "text-embedding-3-large",
        data: [0, 0].map((index) => ({
          index,
          embedding: [1, ...Array(383).fill(0)],
        })),
        usage: { total_tokens: 2 },
      }),
    ),
  );
  await expect(
    new OpenAIEmbeddingProvider(async () => {}).embedMany(["a", "b"]),
  ).rejects.toThrow();
});
it("bounds embedding batches before network and accepts empty batches locally", async () => {
  const call = vi.fn();
  vi.stubGlobal("fetch", call);
  const provider = new OpenAIEmbeddingProvider(async () => {});
  expect(await provider.embedMany([])).toEqual([]);
  await expect(provider.embedMany(Array(33).fill("test"))).rejects.toThrow();
  await expect(provider.embedMany([" "])).rejects.toThrow();
  await expect(provider.embedMany(["x".repeat(8001)])).rejects.toThrow();
  expect(call).not.toHaveBeenCalled();
});
