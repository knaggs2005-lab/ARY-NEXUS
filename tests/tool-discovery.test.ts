import { afterEach, beforeEach, it, expect, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { LocalRepository } from "../src/infrastructure/repositories/local";
import {
  ActionService,
  ApprovalRequiredError,
} from "../src/services/action-service";
import { ActionRequestService } from "../src/services/action-request-service";
import { ToolRegistry } from "../src/domain/tool-registry";
import { ToolDiscoveryService } from "../src/services/tool-discovery-service";
import {
  McpAdapter,
  type McpConnector,
} from "../src/infrastructure/mcp/adapter";
import {
  mcpServerSchema,
  configurationHash,
  schemaHash,
} from "../src/infrastructure/mcp/config";
let dir: string,
  repo: LocalRepository,
  actions: ActionService,
  registry: ToolRegistry;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ary-tools-"));
  repo = new LocalRepository(randomUUID(), join(dir, "data.json"));
  actions = new ActionService(repo);
  registry = new ToolRegistry();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { force: true, recursive: true });
});
const inputSchema = {
  type: "object",
  properties: { title: { type: "string", minLength: 1 } },
  required: ["title"],
  additionalProperties: false,
};
function fixture() {
  const server = mcpServerSchema.parse({
    id: "fixture",
    owner_user_id: repo.userId,
    transport: "http",
    url: "https://mcp.example.test/tools",
    tools: [
      {
        name: "add_note",
        description: "Capture a written reminder",
        capabilities: ["remember an instruction"],
        input_schema: inputSchema,
      },
    ],
  });
  const call = vi.fn(async () => ({
    structuredContent: { id: "fixture-note" },
    content: [{ type: "text", text: "Saved" }],
  }));
  const close = vi.fn(async () => {});
  const list = vi.fn(async () => [{ name: "add_note", inputSchema }]);
  const connector = vi.fn(async () => ({ call, close, list }));
  const adapter = new McpAdapter([server], repo.userId, false, connector);
  adapter.register(registry);
  const requests = new ActionRequestService(repo, actions, registry);
  const request = {
    tool: "mcp.invoke",
    input: {
      ...adapter.descriptors()[0].request_defaults,
      arguments: { title: "Remember the review" },
    },
    request_key: randomUUID(),
    reason: "Owner requests a note",
  };
  return { server, adapter, connector, requests, request, call, close, list };
}
async function approve(
  requests: ActionRequestService,
  request: unknown,
  decision: "approved" | "rejected" = "approved",
) {
  try {
    await requests.request(request);
    throw Error("Missing approval");
  } catch (e) {
    expect(e).toBeInstanceOf(ApprovalRequiredError);
    return actions.permissions.review(
      (e as ApprovalRequiredError).actionId,
      decision,
      "Isolated owner decision",
    );
  }
}
it("normalizes existing declarations without replacing schemas or policy definitions", () => {
  registry.register("create_task", {
    inputSchema: z.object({ title: z.string() }),
    execute: async () => ({}),
  });
  const t = registry.describe()[0];
  expect(t).toMatchObject({
    name: "create_task",
    origin: "internal",
    authentication: { method: "session" },
    execution_location: "server",
    input_schema: { required: ["title"] },
    risk_level: "medium",
  });
  expect(t.capabilities.length).toBeGreaterThan(0);
  expect(t.availability.state).toBe("available");
});
it.each([0, 1, 2, 3])(
  "never contacts MCP at permission level %i",
  async (level) => {
    const f = fixture();
    await actions.permissions.savePolicy({
      tool: "mcp.invoke",
      level,
      reason: "Test boundary",
    });
    await expect(f.requests.request(f.request)).rejects.toMatchObject({
      status: 403,
    });
    expect(f.connector).not.toHaveBeenCalled();
    expect((await repo.list("actions"))[0].status).toBe("blocked");
  },
);
it("requires approval even under level 5; rejection has no external effect", async () => {
  const f = fixture();
  await actions.permissions.savePolicy({
    tool: "mcp.invoke",
    level: 5,
    reason: "Test always approval",
  });
  await approve(f.requests, f.request, "rejected");
  expect(f.connector).not.toHaveBeenCalled();
  expect((await repo.list("action_approvals"))[0].decision).toBe("rejected");
});
it("executes approved MCP through audit/outcome and replays the same execution key once", async () => {
  const f = fixture();
  await approve(f.requests, f.request);
  expect(f.connector).not.toHaveBeenCalled();
  const result = await f.requests.request(f.request);
  const again = await f.requests.request(f.request);
  expect(result.result.structured_content).toEqual({ id: "fixture-note" });
  expect(again.result).toEqual(result.result);
  expect(f.call).toHaveBeenCalledTimes(1);
  expect(f.close).toHaveBeenCalledTimes(1);
  expect(await repo.get("actions", result.action_id)).toMatchObject({
    tool_name: "mcp.invoke",
    status: "succeeded",
    approval_required: true,
  });
  expect(
    (await repo.list("outcomes")).some(
      (o) => o.action_id === result.action_id && o.status === "success",
    ),
  ).toBe(true);
});
it.each(["schema", "configuration", "unknown", "invalid", "missing key"])(
  "rejects %s before any MCP transport",
  async (kind) => {
    const f = fixture();
    const raw = structuredClone(f.request);
    if (kind === "schema") raw.input.schema_hash = "0".repeat(64);
    if (kind === "configuration") raw.input.configuration_hash = "0".repeat(64);
    if (kind === "unknown") raw.input.tool = "add_note; touch /tmp/injected";
    if (kind === "invalid")
      raw.input.arguments = { title: 42 as unknown as string };
    if (kind === "missing key") raw.request_key = "" as typeof raw.request_key;
    await expect(f.requests.request(raw)).rejects.toThrow();
    expect(f.connector).not.toHaveBeenCalled();
  },
);
it("binds approved destination; changing server config invalidates pending execution", async () => {
  const f = fixture();
  await approve(f.requests, f.request);
  f.server.url = "https://different.example.test/mcp";
  await expect(f.requests.request(f.request)).rejects.toThrow(
    /configuration changed/,
  );
  expect(f.connector).not.toHaveBeenCalled();
});
it("checks live schema after approval before invoking any remote capability", async () => {
  const f = fixture();
  await approve(f.requests, f.request);
  f.list.mockResolvedValue([
    { name: "add_note", inputSchema: { ...inputSchema, required: [] } },
  ]);
  await expect(f.requests.request(f.request)).rejects.toThrow(/schema changed/);
  expect(f.call).not.toHaveBeenCalled();
  expect(f.close).toHaveBeenCalledOnce();
});
it("records uncertain external failure and does not automatically reissue a failed request", async () => {
  const f = fixture();
  await approve(f.requests, f.request);
  f.call.mockRejectedValue(Error("network: secret bearer must not leak"));
  await expect(f.requests.request(f.request)).rejects.toThrow(/uncertain/);
  await expect(f.requests.request(f.request)).rejects.toThrow();
  expect(f.call).toHaveBeenCalledOnce();
  expect(f.close).toHaveBeenCalledOnce();
  const logs = await repo.list("actions");
  expect(logs.some((a) => a.status === "failed")).toBe(true);
  expect(JSON.stringify(logs)).not.toContain("secret bearer");
  const disabledTools = new ToolRegistry();
  new McpAdapter([], repo.userId).register(disabledTools);
  const status = await new ToolDiscoveryService(repo, actions, disabledTools, {
    modelId: "fixture",
    embed: async () => [1],
  }).catalog();
  expect(status.find((t) => t.name === "mcp.invoke")?.availability.state).toBe(
    "unconfigured",
  );
});
it("requires local consent for stdio/loopback and never exposes another owner target", () => {
  const f = fixture();
  f.server.owner_user_id = randomUUID();
  expect(f.adapter.descriptors()).toEqual([]);
  expect(() => registry.validate("mcp.invoke", f.request.input)).toThrow(
    /scope/,
  );
  f.server.owner_user_id = repo.userId;
  f.server.url = "https://127.0.0.1:4443/mcp";
  expect(() => registry.validate("mcp.invoke", f.request.input)).toThrow(
    /desktop session/,
  );
});
it("pins inspect requests as approved actions and closes the transport", async () => {
  const f = fixture();
  const request = {
    tool: "mcp.inspect",
    input: {
      server: "fixture",
      configuration_hash: configurationHash(f.server),
    },
    request_key: randomUUID(),
  };
  await approve(f.requests, request);
  expect(f.connector).not.toHaveBeenCalled();
  const r = await f.requests.request(request);
  expect(r.result.tools).toEqual([{ name: "add_note", matched: true }]);
  expect(f.call).not.toHaveBeenCalled();
  expect(f.close).toHaveBeenCalledOnce();
});
it.each([
  "http://example.com/mcp",
  "https://user:password@example.com/mcp",
  "file:///tmp/mcp",
])("rejects unsafe configured transport %s", (url) => {
  expect(() =>
    mcpServerSchema.parse({
      id: "test",
      owner_user_id: repo.userId,
      transport: "http",
      url,
      tools: [{ name: "test", description: "test", input_schema: {} }],
    }),
  ).toThrow();
});
it("canonical schema hash is stable across property order", () => {
  expect(schemaHash({ b: 2, a: 1 })).toBe(schemaHash({ a: 1, b: 2 }));
});
function discovery(batched = false) {
  registry.register("create_task", {
    inputSchema: z.object({ title: z.string() }),
    capability: { capabilities: ["assign work", "track an obligation"] },
    execute: async () => ({}),
  });
  registry.register("task.inspect", {
    inputSchema: z.object({}),
    execute: async () => ({}),
  });
  const vector = (text: string) =>
    /obligation|assign work|create_task|remind me to finish/i.test(text)
      ? [1, 0, 0]
      : /galaxy|astrophysics/i.test(text)
        ? [0, 0, 1]
        : [0, 1, 0];
  const embed = vi.fn(async (text: string) => vector(text));
  const embedMany = vi.fn(async (texts: string[]) => texts.map(vector));
  return {
    service: new ToolDiscoveryService(repo, actions, registry, {
      modelId: "isolated-test",
      version: "v1",
      embed,
      ...(batched ? { embedMany } : {}),
    }),
    embed,
    embedMany,
  };
}
it("discovers a paraphrase semantically with transparent RRF and no permanent memory", async () => {
  const f = discovery();
  const result = await f.service.search({ query: "Remind me to finish it" });
  expect(result.matches[0].tool.name).toBe("create_task");
  expect(result.matches[0].reasons).toContain("semantic rank 1");
  expect(result.model).toBe("isolated-test");
  expect(await repo.list("memories")).toEqual([]);
});
it("suppresses irrelevant concepts and caches descriptors, not query embeddings", async () => {
  const f = discovery();
  expect(
    (await f.service.search({ query: "galaxy astrophysics" })).matches,
  ).toEqual([]);
  const count = f.embed.mock.calls.length;
  await f.service.search({ query: "galaxy astrophysics" });
  expect(f.embed.mock.calls.length - count).toBe(1);
});
it("filters denied tools and falls back to lexical retrieval when embedding fails", async () => {
  const f = discovery();
  await actions.permissions.savePolicy({
    tool: "create_task",
    level: 0,
    reason: "Denied",
  });
  expect(
    (await f.service.search({ query: "Remind me to finish it" })).matches.some(
      (m) => m.tool.name === "create_task",
    ),
  ).toBe(false);
  f.embed.mockRejectedValue(Error("provider offline"));
  const r = await f.service.search({ query: "inspect task" });
  expect(r.model).toBeNull();
  expect(r.warnings).toContain(
    "Semantic provider unavailable; lexical discovery only",
  );
  expect(r.matches[0].tool.name).toBe("task.inspect");
});
it("catalog does not connect MCP and reports successful receipt health only after execution", async () => {
  const f = fixture();
  const service = new ToolDiscoveryService(
    repo,
    actions,
    registry,
    { modelId: "test", embed: async () => [1] },
    f.adapter,
  );
  const before = (await service.catalog()).find(
    (t) => t.id === "mcp:fixture:add_note",
  )!;
  expect(before.availability.state).toBe("unknown");
  expect(before.health.status).toBe("unknown");
  expect(f.connector).not.toHaveBeenCalled();
  await approve(f.requests, f.request);
  const r = await f.requests.request(f.request);
  const after = (await service.catalog()).find(
    (t) => t.id === "mcp:fixture:add_note",
  )!;
  expect(after.availability.state).toBe("connected");
  expect(after.health.status).toBe("healthy");
  expect(after.recent_use?.action_id).toBe(r.action_id);
});
it("official MCP stdio handshake, listing and call work through approval without ambient secrets", async () => {
  const { resolve } = await import("node:path");
  const { connectMcp } = await import("../src/infrastructure/mcp/adapter");
  const f = fixture();
  f.server.transport = "stdio";
  f.server.command = process.execPath;
  f.server.args = [resolve("tests/helpers/mcp-server.mjs")];
  delete f.server.url;
  const tools = new ToolRegistry(),
    adapter = new McpAdapter([f.server], repo.userId, true, connectMcp);
  adapter.register(tools);
  const requests = new ActionRequestService(repo, actions, tools),
    raw = {
      ...f.request,
      input: {
        ...adapter.descriptors()[0].request_defaults,
        arguments: { title: "The isolated protocol test" },
      },
    };
  vi.stubEnv("ARY_TEST_AMBIENT_SECRET", "must-not-inherit");
  try {
    await approve(requests, raw);
    const r = await requests.request(raw);
    expect(r.result.structured_content).toEqual({
      id: "protocol-fixture",
      ambient_secret: false,
    });
    expect(JSON.stringify(r.result.content)).toContain(
      "The isolated protocol test",
    );
  } finally {
    vi.unstubAllEnvs();
  }
});
it("invalid MCP structured output records failure after execution and closes the session", async () => {
  const f = fixture();
  f.server.tools[0].output_schema = {
    type: "object",
    required: ["missing"],
    properties: { missing: { type: "string" } },
  };
  f.request.input.schema_hash = schemaHash({
    input: inputSchema,
    output: f.server.tools[0].output_schema,
  });
  f.list.mockResolvedValue([
    {
      name: "add_note",
      inputSchema,
      outputSchema: f.server.tools[0].output_schema,
    } as any,
  ]);
  await approve(f.requests, f.request);
  await expect(f.requests.request(f.request)).rejects.toThrow(/output failed/);
  expect(f.call).toHaveBeenCalledOnce();
  expect(f.close).toHaveBeenCalledOnce();
});
it("official Streamable HTTP client negotiates MCP and invokes after approval", async () => {
  const { connectMcp } = await import("../src/infrastructure/mcp/adapter");
  const f = fixture();
  const methods: string[] = [];
  const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
    if (init?.method === "GET") return new Response(null, { status: 405 });
    if (init?.method === "DELETE") return new Response(null, { status: 200 });
    const r = JSON.parse(String(init?.body ?? "{}"));
    methods.push(r.method);
    if (r.id === undefined) return new Response(null, { status: 202 });
    let result: unknown;
    if (r.method === "initialize")
      result = {
        protocolVersion: r.params.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: "http-fixture", version: "1" },
      };
    if (r.method === "tools/list")
      result = { tools: [{ name: "add_note", inputSchema }] };
    if (r.method === "tools/call")
      result = { content: [{ type: "text", text: "HTTP approved fixture" }] };
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: r.id, result }), {
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetcher);
  try {
    const tools = new ToolRegistry(),
      adapter = new McpAdapter([f.server], repo.userId, false, connectMcp);
    adapter.register(tools);
    const requests = new ActionRequestService(repo, actions, tools);
    await approve(requests, f.request);
    expect(fetcher).not.toHaveBeenCalled();
    const r = await requests.request(f.request);
    expect(JSON.stringify(r.result.content)).toContain("HTTP approved fixture");
    expect(methods).toContain("initialize");
    expect(methods).toContain("tools/list");
    expect(methods.filter((m) => m === "tools/call")).toHaveLength(1);
  } finally {
    vi.unstubAllGlobals();
  }
});
it("aborts a timed-out MCP session and closes its connection", async () => {
  const f = fixture();
  const tools = new ToolRegistry();
  let started!: () => void;
  const began = new Promise<void>((r) => (started = r));
  const close = vi.fn(async () => {});
  const connector: McpConnector = async (_s, signal) => ({
    list: async () => [{ name: "add_note", inputSchema }],
    call: async () => {
      started();
      return new Promise((_, reject) =>
        signal.addEventListener("abort", () => reject(Error("cancelled")), {
          once: true,
        }),
      );
    },
    close,
  });
  new McpAdapter([f.server], repo.userId, false, connector).register(tools);
  vi.useFakeTimers();
  try {
    const promise = tools.execute("mcp.invoke", f.request.input, {
      userId: repo.userId,
      productIds: [],
      conversationId: null,
    });
    const assertion = expect(promise).rejects.toThrow(/uncertain/);
    await began;
    await vi.advanceTimersByTimeAsync(30001);
    await assertion;
    expect(close).toHaveBeenCalledOnce();
  } finally {
    vi.useRealTimers();
  }
});

it("batches cold descriptors, preserves semantic recall and reuses the cache", async () => {
  const f = discovery(true);
  const first = await f.service.search({ query: "Remind me to finish it" });
  expect(first.matches[0].tool.name).toBe("create_task");
  expect(first.matches[0].reasons).toContain("semantic rank 1");
  expect(f.embed).toHaveBeenCalledTimes(1);
  expect(f.embedMany).toHaveBeenCalledTimes(1);
  await f.service.search({ query: "Remind me to finish it" });
  expect(f.embed).toHaveBeenCalledTimes(2);
  expect(f.embedMany).toHaveBeenCalledTimes(1);
  expect(await repo.list("memories")).toEqual([]);
});
it("bounds descriptor batches and excludes denied tools", async () => {
  const f = discovery(true);
  await actions.permissions.savePolicy({
    tool: "create_task",
    level: 0,
    reason: "Denied",
  });
  const base = await f.service.catalog();
  const example = base.find((t) => t.name === "task.inspect")!;
  vi.spyOn(f.service, "catalog").mockResolvedValue([
    ...base,
    ...Array.from({ length: 66 }, (_, i) => ({
      ...example,
      id: `fixture${i}`,
      name: `fixture${i}`,
    })),
  ]);
  await f.service.search({ query: "inspect task" });
  expect(f.embedMany.mock.calls.length).toBeGreaterThan(1);
  for (const [texts] of f.embedMany.mock.calls) {
    expect(texts.length).toBeLessThanOrEqual(32);
    expect(texts.some((t) => t.startsWith("create_task."))).toBe(false);
  }
  expect(f.embed).toHaveBeenCalledTimes(1);
});
it("failed batches fall back truthfully without individual retry fan-out", async () => {
  const f = discovery(true);
  f.embedMany.mockRejectedValueOnce(Error("offline"));
  const result = await f.service.search({ query: "inspect task" });
  expect(result.model).toBeNull();
  expect(result.warnings).toContain(
    "Descriptor batch unavailable; lexical discovery only",
  );
  expect(f.embed).toHaveBeenCalledTimes(1);
  const retry = await f.service.search({ query: "Remind me to finish it" });
  expect(retry.matches[0].tool.name).toBe("create_task");
  expect(f.embedMany).toHaveBeenCalledTimes(2);
});
it("concurrent discovery shares an in-flight descriptor batch", async () => {
  const f = discovery(true);
  const original = f.embedMany.getMockImplementation()!;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.embedMany.mockImplementation(async (texts) => {
    await gate;
    return original(texts);
  });
  const first = f.service.search({ query: "Remind me to finish it" });
  const second = f.service.search({ query: "Remind me to finish it" });
  await vi.waitFor(() => expect(f.embedMany).toHaveBeenCalledOnce());
  release();
  const results = await Promise.all([first, second]);
  expect(f.embedMany).toHaveBeenCalledOnce();
  expect(results.every((r) => r.matches[0].tool.name === "create_task")).toBe(
    true,
  );
});
