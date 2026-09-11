import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { LocalRepository } from "../src/infrastructure/repositories/local";
import { ActionService } from "../src/services/action-service";
import { MemoryService } from "../src/services/memory-service";
import { LocalEmbeddingProvider } from "../src/infrastructure/providers/local";
import { NexusIntelligenceService } from "../src/services/nexus-intelligence-service";
import { intelligenceQuery } from "../src/domain/nexus-intelligence";
import { PermissionService } from "../src/services/permission-service";
import { NexusMapService } from "../src/services/nexus-map-service";
import { ActionRequestService } from "../src/services/action-request-service";
let dir: string,
  repo: LocalRepository,
  memories: MemoryService,
  service: NexusIntelligenceService;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "nexus-intelligence-"));
  repo = new LocalRepository(randomUUID(), join(dir, "data.json"));
  memories = new MemoryService(repo, new LocalEmbeddingProvider());
  service = new NexusIntelligenceService(
    repo,
    new ActionService(repo),
    memories,
  );
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});
const entity = (name = "Austin", metadata = {}) =>
  repo.insert("entities", {
    entity_type: "person",
    name,
    description: "Isolated visual acceptance",
    metadata,
  });
const fact = () =>
  memories.createMemory({
    content: "The interview edit deadline is Friday",
    metadata: { origin: "manual" },
  });
async function block(tool: string, product_entity_id: string | null = null) {
  await new PermissionService(repo).savePolicy({
    tool,
    reason: "Isolated policy test",
    level: 0,
    workspace: "ary-nexus",
    product_entity_id,
    subject_user_id: null,
    action_type: null,
    enabled: true,
    parent_id: null,
  });
}
it.each([
  {},
  { focus: "rm -rf" },
  { q: "a".repeat(201) },
  { q: "x", depth: 9 },
])("rejects malformed/unbounded inspection %j", (q) =>
  expect(() => intelligenceQuery.parse(q)).toThrow(),
);
it("rejects another owner's entity without returning content", async () => {
  const e = await entity();
  const other = new LocalRepository(randomUUID(), join(dir, "data.json"));
  await expect(
    new NexusIntelligenceService(
      other,
      new ActionService(other),
      new MemoryService(other, new LocalEmbeddingProvider()),
    ).query({ focus: e.id }),
  ).rejects.toThrow("Entity");
});
it("exposes an explicit entity-memory link with confidence and source, no vector or raw model payload", async () => {
  const e = await entity(),
    m = await fact();
  await memories.linkMemoryToEntity(m.id, e.id);
  const out = await service.query({ focus: e.id });
  expect(out.memories[0].confidence).toBe(m.confidence_score);
  expect(out.memories[0].sources[0].kind).toBe("manual");
  expect(
    out.map.edges.some(
      (x) => x.source === `memory:${m.id}` && x.target === e.id,
    ),
  ).toBe(true);
  expect(JSON.stringify(out)).not.toContain('"embedding"');
  expect(out.timeline[0].kind).toBe("learned");
});
it("episodic dates and version changes retain exact recorded provenance", async () => {
  const m = await memories.createMemory({
    memory_type: "episodic",
    content: "Interview session finished",
    metadata: { origin: "manual" },
  });
  await memories.updateMemory(m.id, {
    content: "Interview session finished with one pickup",
  });
  const out = await service.query({ focus: `memory:${m.id}` });
  expect(out.timeline.some((t) => t.kind === "episode")).toBe(true);
  const change = out.timeline.find((t) => t.kind === "revision")!;
  expect(change.before).toContain("Interview session finished");
  expect(change.after).toContain("one pickup");
  expect(change.source).toMatch(/^memory_versions:/);
});
it("last accessed time does not invent a substantive change", async () => {
  const m = await fact();
  await repo.update("memories", m.id, {
    last_accessed_at: new Date().toISOString(),
  });
  const out = await service.query({ focus: `memory:${m.id}` });
  expect(out.timeline.filter((x) => x.kind === "revision")).toEqual([]);
});
it("superseded facts stay historical, with an explicit supersession edge", async () => {
  const e = await entity(),
    old = await fact(),
    next = await memories.createMemory({
      content: "The deadline is now Monday",
    });
  await repo.update("memories", old.id, {
    status: "superseded",
    valid_to: new Date().toISOString(),
  });
  await repo.update("memories", next.id, { supersedes_id: old.id });
  await memories.linkMemoryToEntity(next.id, e.id);
  await memories.linkMemoryToEntity(old.id, e.id);
  const current = await service.query({ focus: e.id });
  expect(current.memories.map((m) => m.id)).toEqual([next.id]);
  const history = await service.query({ focus: e.id, history: "all" });
  expect(history.memories.find((m) => m.id === old.id)?.status).toBe(
    "superseded",
  );
  expect(history.map.edges.some((e) => e.type === "supersedes")).toBe(true);
});
it("never guesses connections from similar names", async () => {
  const a = await entity("Austin"),
    b = await entity("Austin");
  const result = await service.query({ focus: a.id });
  expect(result.map.nodes.some((n) => n.id === b.id)).toBe(false);
  expect(result.map.edges).toEqual([]);
});
it("separates unavailable original evidence from confidence", async () => {
  const { id, user_id, created_at, updated_at, ...data } = await fact();
  const m = await repo.insert("memories", {
    ...data,
    metadata: {},
    content: "Legacy unsupported source",
  });
  const out = await service.query({ focus: `memory:${m.id}` });
  expect(out.memories[0].sources[0].kind).toBe("legacy_unknown");
  expect(out.memories[0].sources[0].quote).toBeNull();
});
it("global memory denial preserves world nodes without leaking facts", async () => {
  const e = await entity(),
    m = await fact();
  await memories.linkMemoryToEntity(m.id, e.id);
  await block("memory.read");
  const out = await service.query({ focus: e.id });
  expect(out.memories).toEqual([]);
  expect(JSON.stringify(out)).not.toContain(m.content);
  expect(out.map.meta.warnings.join(" ")).toContain("access restricted");
  expect(
    (await repo.list("actions")).some(
      (a) => a.tool_name === "memory.read" && a.status === "blocked",
    ),
  ).toBe(true);
});
it("scoped denial applies to directly opened linked memory", async () => {
  const e = await repo.insert("entities", {
      entity_type: "project",
      name: "Restricted project",
      description: "",
      metadata: {},
    }),
    m = await fact();
  await memories.linkMemoryToEntity(m.id, e.id);
  await block("memory.read", e.id);
  await expect(service.query({ focus: `memory:${m.id}` })).rejects.toThrow();
});
it("working memory never leaks into global history inspection", async () => {
  const m = await fact();
  await repo.update("memories", m.id, {
    metadata: {
      nexus_memory: {
        version: 1,
        class: "WORKING",
        conversation_id: randomUUID(),
        expires_at: new Date(Date.now() + 3600000).toISOString(),
        outcome_id: null,
        consolidated_from: [],
      },
    },
  });
  expect(
    (await service.query({ focus: `memory:${m.id}`, history: "all" })).memories,
  ).toEqual([]);
});
it("semantic query delegates unchanged to existing hybrid retrieval and exposes its reasons", async () => {
  const m = await fact();
  const hit = {
    ...m,
    score: 0.03,
    similarity: 0.8,
    retrieval_sources: ["semantic" as const],
    retrieval_reasons: ["Semantic rank 1"],
  };
  vi.spyOn(memories, "searchMemories").mockResolvedValue([
    {
      ...hit,
      explanation: undefined!,
      last_accessed_at: new Date().toISOString(),
      source_evidence: [],
      unresolved_conflict_count: 0,
    },
  ]);
  const out = await service.query({ q: "When should I deliver the film?" });
  expect(memories.searchMemories).toHaveBeenCalledWith(
    "When should I deliver the film?",
    12,
  );
  expect(out.memories[0].relevance?.relevant_because).toEqual([
    "Semantic rank 1",
  ]);
  expect(out.map.nodes[0].recordId).toBe(m.id);
});
it("irrelevant query yields a truthful empty state", async () => {
  vi.spyOn(memories, "searchMemories").mockResolvedValue([]);
  const out = await service.query({ q: "Ocean temperatures on Mars" });
  expect(out.map.nodes).toEqual([]);
  expect(out.explanation).toContain("No relevant current memory");
});
it.each(["location", "device", "application", "organization", "object"])(
  "preserves canonical IDs for %s facets",
  async (kind) => {
    const e = await entity("Observed thing", { nexus_kind: kind });
    const out = await service.query({ focus: e.id });
    expect(out.map.nodes[0]).toMatchObject({ id: e.id, kind });
  },
);
it("mission and outcome linkage uses actual step receipts", async () => {
  const e = await entity("Project"),
    c = await repo.insert("conversations", {
      title: "Mission fixture",
      metadata: {},
    });
  const a = await repo.insert("actions", {
    conversation_id: c.id,
    tool_name: "create_task",
    action_type: "write",
    permission_level: 5,
    status: "succeeded",
    input: {},
    output: {},
    error: null,
    metadata: {},
    product_entity_ids: [e.id],
  });
  const o = await repo.insert("outcomes", {
    action_id: a.id,
    goal_id: null,
    status: "success",
    summary: "Real fixture task created",
    metrics: {},
    metadata: {},
  });
  const m = await repo.insert("messages", {
    conversation_id: c.id,
    role: "system",
    content: "Saved plan",
    metadata: {},
  });
  await repo.update("messages", m.id, {
    metadata: {
      plan: {
        version: "orchestrator-v1",
        id: m.id,
        goal: "Deliver client film",
        status: "complete",
        entity_ids: [e.id],
        memory_ids: [],
        states: { create: { action_id: a.id } },
        revision: 1,
      },
    },
  });
  const out = await service.query({ focus: e.id });
  expect(
    out.map.edges.some(
      (edge) =>
        edge.source === `mission:${m.id}` && edge.target === `outcome:${o.id}`,
    ),
  ).toBe(true);
  expect(out.timeline.find((x) => x.kind === "outcome")?.source).toContain(
    a.id,
  );
  await block("activity.read");
  expect(
    (await service.query({ focus: e.id })).map.nodes.some(
      (n) => n.kind === "outcome",
    ),
  ).toBe(false);
});
it("world and memory lenses preserve sources without enumerating tool catalog", async () => {
  const actions = new ActionService(repo),
    tools = new ActionRequestService(repo, actions),
    spy = vi.spyOn(tools, "catalog");
  await new NexusMapService(repo, actions, tools).query({ lens: "world" });
  expect(spy).not.toHaveBeenCalled();
});
