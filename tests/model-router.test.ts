import { afterEach, it, expect, vi } from "vitest";
import {
  ModelRouter,
  ModelUnavailableError,
  modelHealth,
} from "../src/services/model-router";
import {
  modelTarget,
  routePolicy,
  type ModelTarget,
} from "../src/domain/model-router";
import type {
  BrainContext,
  LanguageModelProvider,
  ReasoningResult,
} from "../src/domain/providers";
import {
  createModelRouter,
  guardedEmbeddings,
} from "../src/infrastructure/providers/model-router-config";
import { RoutedChatProvider } from "../src/infrastructure/providers/routed-chat";
import {
  LocalEmbeddingProvider,
  MockLanguageModel,
} from "../src/infrastructure/providers/local";
import { OpenAIResponsesProvider } from "../src/infrastructure/providers/openai";
const context: BrainContext = {
  input: "What is known?",
  intent: "recall",
  entities: [],
  memories: [],
  history: [],
};
const result = (model: string): ReasoningResult => ({
  content: `From ${model}`,
  model,
  provider: "fixture",
  metrics: {
    input_tokens: 4,
    cached_input_tokens: 0,
    output_tokens: 3,
    latency_ms: 1,
    estimated_cost_usd: null,
    retrieval_count: 0,
    pricing_version: "fixture",
  },
});
function target(id: string, patch: Partial<ModelTarget> = {}): ModelTarget {
  return {
    ...modelTarget.parse({
      id,
      model: id,
      provider: "compatible",
      location: "cloud",
      tasks: ["chat", "analysis", "planning", "extraction"],
      capabilities: ["reasoning", "structured", "streaming"],
      context_tokens: 128000,
    }),
    available: () => true,
    healthKey: id,
    adapter: {
      name: id,
      identifyIntent: async () => "recall",
      reason: async () => `From ${id}`,
      reasonWithUsage: vi.fn(async () => result(id)),
      planWithUsage: vi.fn(async () => result(id)),
      extractCandidates: vi.fn(async () => []),
      extractMemories: async () => [],
    },
    ...patch,
  };
}
const router = (
  t: ModelTarget[],
  p: Parameters<typeof routePolicy.parse>[0] = {},
) => new ModelRouter(t, routePolicy.parse(p), {}, async () => {}, new Map());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  modelHealth.clear();
});
it("retains the configured model and records selection reasons", async () => {
  const r = await router([
    target("primary"),
    target("secondary", { priority: 10 }),
  ]).reasonWithUsage(context);
  expect(r.model).toBe("primary");
  expect(r.routing?.selected).toBe("primary");
  expect(r.routing?.reason).toContain("privacy");
});
it("uses tasks and required capabilities before any request", async () => {
  const a = target("chat", { tasks: ["chat"] }),
    b = target("planner");
  await router([a, b]).planWithUsage(context, []);
  expect(a.adapter.planWithUsage).not.toHaveBeenCalled();
  expect(b.adapter.planWithUsage).toHaveBeenCalled();
});
it("local-only requests never reach cloud, including on local failure", async () => {
  const a = target("cloud"),
    b = target("local", { location: "local" });
  vi.mocked(b.adapter.reasonWithUsage!).mockRejectedValue(new Error("offline"));
  const r = await router([a, b], { privacy: "local_only" }).reasonWithUsage(
    context,
  );
  expect(a.adapter.reasonWithUsage).not.toHaveBeenCalled();
  expect(r.provider).toBe("local-evidence");
});
it("a task override cannot weaken local-only privacy", async () => {
  const a = target("cloud"),
    r = new ModelRouter(
      [a],
      routePolicy.parse({ privacy: "local_only" }),
      { chat: { privacy: "cloud_allowed" } },
      async () => {},
      new Map(),
    );
  await r.reason(context);
  expect(a.adapter.reasonWithUsage).not.toHaveBeenCalled();
});
it("context capacity rejects a model before sending anything", async () => {
  const a = target("small", { context_tokens: 1024 }),
    b = target("large");
  const r = await router([a, b]).reasonWithUsage(context);
  expect(r.model).toBe("large");
  expect(r.routing?.candidates[0].reason).toBe("context capacity");
});
it("cost preference selects declared cheaper models and rejects unknown budget costs", async () => {
  const a = target("unknown"),
    b = target("cheap", {
      input_usd_per_million: 1,
      output_usd_per_million: 1,
    });
  const r = await router([a, b], {
    preference: "cost",
    max_estimated_cost_usd: 0.1,
  }).reasonWithUsage(context);
  expect(r.model).toBe("cheap");
  expect(r.routing?.candidates[0].reason).toBe("estimated cost budget");
});
it("latency preference uses declared latency and then measured EWMA", async () => {
  const a = target("slow", { expected_latency_ms: 500 }),
    b = target("fast", { expected_latency_ms: 10 });
  expect(
    (await router([a, b], { preference: "latency" }).reasonWithUsage(context))
      .model,
  ).toBe("fast");
});
it("disabled and unconfigured targets are excluded", async () => {
  const a = target("off", { enabled: false }),
    b = target("missing", { available: () => false });
  const r = await router([a, b]).reasonWithUsage(context);
  expect(r.provider).toBe("local-evidence");
  expect(r.routing?.attempts).toHaveLength(0);
});
it("network failures fall back once and preserve both attempts", async () => {
  const a = target("cloud"),
    b = target("local", { location: "local", priority: 10 });
  vi.mocked(a.adapter.reasonWithUsage!).mockRejectedValue(
    new TypeError("fetch failed secret detail"),
  );
  const r = await router([a, b]).reasonWithUsage(context);
  expect(r.model).toBe("local");
  expect(r.routing?.degraded).toBe(true);
  expect(JSON.stringify(r.routing)).not.toContain("secret");
  expect(r.routing?.attempts).toHaveLength(2);
});
it("cooldown avoids repeated calls and expires without retaining content", async () => {
  const a = target("a"),
    b = target("b", { priority: 10 }),
    health = new Map();
  vi.mocked(a.adapter.reasonWithUsage!).mockRejectedValue(new Error("bad"));
  const r = new ModelRouter(
    [a, b],
    routePolicy.parse({}),
    {},
    async () => {},
    health,
  );
  await r.reason(context);
  await r.reason(context);
  expect(a.adapter.reasonWithUsage).toHaveBeenCalledTimes(1);
  health.get("a").until = 0;
  await r.reason(context);
  expect(a.adapter.reasonWithUsage).toHaveBeenCalledTimes(2);
});
it("timeout aborts the attempt and falls back within the request deadline", async () => {
  const a = target("hang"),
    b = target("backup", { priority: 10 });
  vi.mocked(a.adapter.reasonWithUsage!).mockImplementation(
    (_c, o) =>
      new Promise((_, reject) =>
        o?.signal?.addEventListener("abort", () => reject(o.signal?.reason)),
      ),
  );
  const r = await router([a, b], {
    timeout_ms: 50,
    total_timeout_ms: 200,
  }).reasonWithUsage(context);
  expect(r.model).toBe("backup");
  expect(r.routing?.attempts[0].error_code).toBe("timeout");
});
it("caller cancellation never produces a fallback response", async () => {
  const a = target("a"),
    b = target("b"),
    cancel = new AbortController();
  vi.mocked(a.adapter.reasonWithUsage!).mockImplementation(async () => {
    cancel.abort(new Error("User stopped"));
    throw new Error("cancelled");
  });
  await expect(
    router([a, b]).reasonWithUsage(context, { signal: cancel.signal }),
  ).rejects.toThrow("User stopped");
  expect(b.adapter.reasonWithUsage).not.toHaveBeenCalled();
});
it("a failed partial stream never switches voices or mixes model answers", async () => {
  const a = target("a"),
    b = target("b"),
    delta = vi.fn();
  vi.mocked(a.adapter.reasonWithUsage!).mockImplementation(async (_c, o) => {
    o?.onDelta?.("partial");
    throw new Error("connection lost");
  });
  await expect(
    router([a, b]).reasonWithUsage(context, { onDelta: delta }),
  ).rejects.toBeInstanceOf(ModelUnavailableError);
  expect(delta).toHaveBeenCalledExactlyOnceWith("partial");
  expect(b.adapter.reasonWithUsage).not.toHaveBeenCalled();
});
it("telemetry failure does not retry a successful completion", async () => {
  const a = target("a"),
    b = target("b");
  const r = new ModelRouter(
    [a, b],
    routePolicy.parse({}),
    {},
    async () => {
      throw new Error("event store down");
    },
    new Map(),
  );
  expect((await r.reasonWithUsage(context)).model).toBe("a");
  expect(b.adapter.reasonWithUsage).not.toHaveBeenCalled();
});
it("unavailable extraction stays retryable instead of falsely extracting nothing", async () => {
  await expect(
    router([]).extractMemories("Remember: real fact"),
  ).rejects.toBeInstanceOf(ModelUnavailableError);
});
it("unavailable planning cannot produce an executable fake plan", async () => {
  await expect(router([]).planWithUsage(context, [])).rejects.toBeInstanceOf(
    ModelUnavailableError,
  );
});
it("offline evidence mode discloses limitations and cites only supplied records", async () => {
  const r = await router([]).reasonWithUsage({
    ...context,
    memories: [
      {
        content: "Project deadline is Friday",
        summary: "Deadline",
        unresolved_conflict_count: 1,
      } as never,
    ],
  });
  expect(r.content).toContain("[1] Project deadline is Friday");
  expect(r.content).toContain("contested");
  expect(r.content).toContain("have not verified or updated");
  expect(r.model).toBe("Evidence-only fallback");
});
it("factory rejects remote endpoints labeled local and inline keys", () => {
  vi.stubEnv(
    "ARY_MODEL_ROUTER_TARGETS",
    JSON.stringify([
      {
        ...modelTarget.parse({
          id: "local",
          provider: "mlx",
          model: "fixture",
          location: "local",
          tasks: ["chat"],
          capabilities: ["reasoning"],
          context_tokens: 32000,
        }),
        base_url: "https://cloud.example/v1",
      },
    ]),
  );
  expect(() =>
    createModelRouter(
      new MockLanguageModel(),
      "mock",
      async () => {},
      async () => {},
    ),
  ).toThrow(/loopback/);
});
it("factory cannot relabel the configured cloud provider", () => {
  vi.stubEnv("ARY_MODEL_ROUTER_PRIMARY", '{"location":"local"}');
  expect(() =>
    createModelRouter(
      new OpenAIResponsesProvider(),
      "openai",
      async () => {},
      async () => {},
    ),
  ).toThrow(/identity/);
});
it("local-only embeddings are blocked without producing replacement vectors", async () => {
  vi.stubEnv("ARY_MODEL_ROUTER_POLICY", '{"privacy":"local_only"}');
  const inner = new LocalEmbeddingProvider(),
    spy = vi.spyOn(inner, "embed"),
    p = guardedEmbeddings(inner, false);
  await expect(p.embed("private")).rejects.toThrow(/blocked/);
  expect(spy).not.toHaveBeenCalled();
  expect(p.modelId).toBe(inner.modelId);
  expect(p.version).toBe(inner.version);
});
function chat(protocol: "chat" | "anthropic" = "chat") {
  return new RoutedChatProvider({
    baseUrl: "http://127.0.0.1:9999/v1",
    apiKey: "fixture-secret",
    model: "fixture",
    provider: protocol,
    protocol,
    inputPrice: 1,
    outputPrice: 2,
  });
}
it("compatible transport sends bounded context and records returned usage", async () => {
  const fetcher = vi.fn().mockResolvedValue(
    Response.json({
      model: "actual",
      choices: [
        { message: { content: "Recorded answer" }, finish_reason: "stop" },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    }),
  );
  vi.stubGlobal("fetch", fetcher);
  const r = await chat().reasonWithUsage({
    ...context,
    history: [
      {
        role: "user",
        content: "question",
        metadata: { secret: "do-not-send" },
      } as never,
    ],
  });
  expect(r.model).toBe("actual");
  expect(r.metrics.input_tokens).toBe(10);
  expect(fetcher.mock.calls[0][1].body).not.toContain("do-not-send");
  expect(fetcher.mock.calls[0][1].redirect).toBe("error");
});
it("Anthropic uses native Messages and separate system instructions", async () => {
  const fetcher = vi.fn().mockResolvedValue(
    Response.json({
      model: "claude-fixture",
      stop_reason: "end_turn",
      content: [{ type: "text", text: "Answer" }],
      usage: { input_tokens: 3, output_tokens: 2 },
    }),
  );
  vi.stubGlobal("fetch", fetcher);
  expect((await chat("anthropic").reasonWithUsage(context)).content).toBe(
    "Answer",
  );
  expect(fetcher.mock.calls[0][0]).toMatch(/messages$/);
  expect(fetcher.mock.calls[0][1].headers["x-api-key"]).toBe("fixture-secret");
  expect(JSON.parse(fetcher.mock.calls[0][1].body).system).toContain(
    "You are Ary",
  );
});
it("compatible streaming preserves incremental text and usage", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response(
          'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":5,"completion_tokens":2}}\n\ndata: [DONE]\n\n',
        ),
      ),
  );
  const delta = vi.fn();
  const r = await chat().reasonWithUsage(context, { onDelta: delta });
  expect(delta).toHaveBeenCalledExactlyOnceWith("Hello");
  expect(r.content).toBe("Hello");
  expect(r.metrics.output_tokens).toBe(2);
});
it("truncated streams are not returned as successful answers", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response('data: {"choices":[{"delta":{"content":"Partial"}}]}\n\n'),
      ),
  );
  await expect(
    chat().reasonWithUsage(context, { onDelta: () => {} }),
  ).rejects.toThrow(/before completion/);
});
it("structured extraction validates model output, including forged ownership", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                candidates: [
                  { memory: { content: "fact", user_id: "forged" } },
                ],
              }),
            },
          },
        ],
      }),
    ),
  );
  await expect(chat().extractMemories("a fact")).rejects.toThrow();
});
it("Gemini is reachable through its supported compatible endpoint", async () => {
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubEnv("GEMINI_API_KEY", "fixture-only");
  vi.stubEnv(
    "ARY_MODEL_ROUTER_TARGETS",
    JSON.stringify([
      {
        ...modelTarget.parse({
          id: "gemini",
          provider: "gemini",
          model: "gemini-fixture",
          location: "cloud",
          tasks: ["chat"],
          capabilities: ["reasoning"],
          context_tokens: 128000,
        }),
        api_key_env: "GEMINI_API_KEY",
      },
    ]),
  );
  const fetcher = vi.fn().mockResolvedValue(
    Response.json({
      model: "gemini-fixture",
      choices: [{ message: { content: "Fixture" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 3, completion_tokens: 2 },
    }),
  );
  vi.stubGlobal("fetch", fetcher);
  const r = await createModelRouter(
    new OpenAIResponsesProvider(),
    "openai",
    async () => {},
    async () => {},
  ).reasonWithUsage(context);
  expect(r.provider).toBe("gemini");
  expect(fetcher.mock.calls[0][0]).toBe(
    "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
  );
});
it("localhost gateways do not automatically acquire local privacy authority", () => {
  vi.stubEnv("LLM_BASE_URL", "http://127.0.0.1:9000/v1");
  vi.stubEnv("ARY_MODEL_ROUTER_POLICY", '{"privacy":"local_only"}');
  const r = createModelRouter(
    new MockLanguageModel(),
    "compatible",
    async () => {},
    async () => {},
  );
  expect(r.describe()[0].location).toBe("cloud");
});
it("cloud vendors cannot be relabeled as local behind a proxy", () => {
  vi.stubEnv(
    "ARY_MODEL_ROUTER_TARGETS",
    JSON.stringify([
      {
        ...modelTarget.parse({
          id: "anthropic",
          provider: "anthropic",
          model: "claude",
          location: "local",
          tasks: ["chat"],
          capabilities: ["reasoning"],
          context_tokens: 128000,
        }),
        base_url: "http://127.0.0.1:9000/v1",
      },
    ]),
  );
  expect(() =>
    createModelRouter(
      new MockLanguageModel(),
      "mock",
      async () => {},
      async () => {},
    ),
  ).toThrow(/cannot be labeled local/);
});
it("router diagnostics never include target URLs or secret values", () => {
  vi.stubEnv("LLM_BASE_URL", "http://127.0.0.1:9000/v1");
  vi.stubEnv("LLM_API_KEY", "do-not-log-this");
  const r = createModelRouter(
    new MockLanguageModel(),
    "compatible",
    async () => {},
    async () => {},
  );
  const text = JSON.stringify(r.describe());
  expect(text).not.toContain("9000");
  expect(text).not.toContain("do-not-log-this");
});
it("output arriving after a timed-out attempt cannot enter a fallback stream", async () => {
  const a = target("slow"),
    b = target("backup", { priority: 10 }),
    delta = vi.fn();
  let late: ((text: string) => void) | undefined;
  vi.mocked(a.adapter.reasonWithUsage!).mockImplementation((_c, o) => {
    late = o?.onDelta;
    return new Promise(() => {});
  });
  vi.mocked(b.adapter.reasonWithUsage!).mockImplementation(async (_c, o) => {
    o?.onDelta?.("backup");
    return result("backup");
  });
  const r = await router([a, b], {
    timeout_ms: 50,
    total_timeout_ms: 200,
  }).reasonWithUsage(context, { onDelta: delta });
  late?.("late primary text");
  expect(r.model).toBe("backup");
  expect(delta.mock.calls).toEqual([["backup"]]);
});
it("cancellation before dispatch makes no provider call", async () => {
  const a = target("a"),
    cancel = new AbortController();
  cancel.abort(new Error("Stopped"));
  await expect(
    router([a]).reasonWithUsage(context, { signal: cancel.signal }),
  ).rejects.toThrow("Stopped");
  expect(a.adapter.reasonWithUsage).not.toHaveBeenCalled();
});
it("required streaming capability excludes a buffered-only target", async () => {
  const a = target("buffered", { capabilities: ["reasoning"] }),
    b = target("stream");
  const r = await router([a, b], {
    required_capabilities: ["streaming"],
  }).reasonWithUsage(context);
  expect(r.model).toBe("stream");
  expect(r.routing?.candidates[0].reason).toBe("capability missing");
});
it("Anthropic streaming checks terminal status and returns incremental text", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response(
          'data: {"type":"message_start","message":{"model":"claude-fixture","usage":{"input_tokens":3}}}\n\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}\n\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":2}}\n\ndata: {"type":"message_stop"}\n\n',
        ),
      ),
  );
  const delta = vi.fn(),
    r = await chat("anthropic").reasonWithUsage(context, { onDelta: delta });
  expect(r.model).toBe("claude-fixture");
  expect(r.metrics.output_tokens).toBe(2);
  expect(delta).toHaveBeenCalledExactlyOnceWith("Hello");
});
