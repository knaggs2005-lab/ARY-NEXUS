import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { missionFixture } from "../scripts/lib/mission-fixture";
import { NexusMemoryService } from "../src/services/nexus-memory-service";
import { registerMemoryTools } from "../src/infrastructure/tools/memory-tools";
import { PermissionService } from "../src/services/permission-service";
import { ApprovalRequiredError } from "../src/services/action-service";
import {
  policyFor,
  memoryInScope,
  memoryClasses,
} from "../src/domain/nexus-memory";
import { agentExecution } from "../src/services/agent-context";
import { LocalRepository } from "../src/infrastructure/repositories/local";
import type { Mutation } from "../src/domain/repository";
let dir: string,
  f: ReturnType<typeof missionFixture>,
  service: NexusMemoryService,
  permissions: PermissionService;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ary-memory-v2-"));
  f = missionFixture(join(dir, "fixture.json"), randomUUID());
  service = new NexusMemoryService(f.repo, f.memories);
  permissions = new PermissionService(f.repo);
  registerMemoryTools(f.tools, service, f.actions);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});
const req = (tool: string, input: Record<string, unknown>) => ({
  tool,
  input,
  request_key: randomUUID(),
  reason: "Isolated memory acceptance",
});
async function pending(r: ReturnType<typeof req>) {
  try {
    await f.coordinator.requests.request(r);
  } catch (e) {
    expect(e).toBeInstanceOf(ApprovalRequiredError);
    return (e as ApprovalRequiredError).actionId;
  }
  throw Error("Expected approval");
}
async function approved(r: ReturnType<typeof req>) {
  await permissions.review(
    await pending(r),
    "approved",
    "Approve isolated fixture",
  );
  return f.coordinator.requests.request(r);
}
const record = () =>
  f.memories.createMemory({
    content: "Wag Trails supports offline hiking maps",
    metadata: { origin: "manual" },
  });
it("projects legacy classes without rewriting useful records or embeddings", async () => {
  const m = await record();
  expect(policyFor(m).class).toBe("SEMANTIC");
  await service.list();
  expect(await f.repo.get("memories", m.id)).toEqual(m);
  const p = await f.memories.createMemory({
    content: "Open the export panel before exporting",
    memory_type: "procedural",
  });
  expect(policyFor(p).class).toBe("PROCEDURAL");
});
it.each(memoryClasses)(
  "captures %s using approval, canonical memory, audit and outcome",
  async (className) => {
    const entity = await f.entities.createEntity({
      entity_type: "project",
      name: "Wag Trails",
    });
    const conversation = await f.repo.insert("conversations", {
      title: "Scoped work",
      metadata: {},
    });
    const prior = await approved(
      req("memory.capture", { class: "SEMANTIC", content: "Acceptance setup" }),
    );
    const outcome = (await f.repo.list("outcomes")).find(
      (o) => o.status === "success",
    )!;
    const input = {
      class: className,
      content: "Wag Trails export plan",
      entity_ids: className === "ENTITY" ? [entity.id] : [],
      ...(className === "OUTCOME" ? { outcome_id: outcome.id } : {}),
      ...(className === "WORKING"
        ? {
            conversation_id: conversation.id,
            expires_at: new Date(Date.now() + 3600000).toISOString(),
          }
        : {}),
    };
    const response = await approved(req("memory.capture", input));
    const m = await f.repo.get("memories", String(response.result.memory_id));
    expect(policyFor(m!).class).toBe(className);
    expect((await service.inspect(m!.id)).history.sources.length).toBe(1);
    expect(
      (await f.repo.list("actions")).filter(
        (a) => a.status === "succeeded" && a.tool_name === "memory.capture",
      ).length,
    ).toBeGreaterThan(0);
    expect(
      (await f.repo.list("outcomes")).filter((o) => o.status === "success")
        .length,
    ).toBeGreaterThan(0);
    expect(prior).toBeDefined();
  },
);
it("rejection and permission denial create no memories", async () => {
  const r = req("memory.capture", {
    class: "SEMANTIC",
    content: "Do not save",
  });
  const id = await pending(r);
  await permissions.review(id, "rejected", "Rejected test");
  expect(await f.repo.list("memories")).toHaveLength(0);
  await permissions.savePolicy({
    tool: "memory.capture",
    level: 0,
    reason: "Block capture",
  });
  await expect(
    f.coordinator.requests.request(req("memory.capture", r.input)),
  ).rejects.toThrow();
  expect(await f.repo.list("memories")).toHaveLength(0);
});
it("autonomous policy cannot bypass mandatory review", async () => {
  await permissions.savePolicy({
    tool: "memory.capture",
    level: 5,
    reason: "Test ceiling",
  });
  await pending(
    req("memory.capture", {
      class: "SEMANTIC",
      content: "Still requires review",
    }),
  );
  expect(await f.repo.list("memories")).toHaveLength(0);
});
it("preserves idempotent capture without duplicate memory records", async () => {
  const r = req("memory.capture", {
    class: "SEMANTIC",
    content: "Only one durable memory",
  });
  const a = await approved(r),
    b = await f.coordinator.requests.request(r);
  expect(a.result.memory_id).toBe(b.result.memory_id);
  expect(await f.repo.list("memories")).toHaveLength(1);
});
it("keeps WORKING out of unrelated retrieval and expires without deleting history", async () => {
  const c = await f.repo.insert("conversations", {
    title: "Hike",
    metadata: {},
  });
  const result = await approved(
    req("memory.capture", {
      class: "WORKING",
      content: "Wag Trails meeting temporary waypoint",
      conversation_id: c.id,
      expires_at: new Date(Date.now() + 60000).toISOString(),
    }),
  );
  const id = String(result.result.memory_id);
  expect(await f.memories.searchMemories("temporary waypoint")).toHaveLength(0);
  const hits = await f.memories.getRelevantMemories(
    "temporary waypoint",
    8,
    [],
    [],
    { conversationId: c.id },
  );
  expect(hits.some((m) => m.id === id)).toBe(true);
  const m = (await f.repo.get("memories", id))!;
  expect(memoryInScope(m, c.id, Date.now() + 120000)).toBe(false);
  expect((await service.inspect(id)).history.versions.length).toBeGreaterThan(
    0,
  );
});
it("rejects malformed class, missing entity/outcome and forged lifecycle input", async () => {
  await expect(
    f.coordinator.requests.request(
      req("memory.capture", { class: "MADE_UP", content: "invalid" }),
    ),
  ).rejects.toThrow();
  for (const input of [
    { class: "ENTITY", content: "No entity" },
    { class: "OUTCOME", content: "No outcome" },
    { class: "WORKING", content: "No scope" },
  ])
    await expect(approved(req("memory.capture", input))).rejects.toThrow();
  await expect(
    f.memories.createMemory({
      content: "Forge",
      metadata: { nexus_memory: { class: "WORKING" } },
    }),
  ).rejects.toThrow("scoped");
  expect(await f.repo.list("memories")).toHaveLength(0);
});
it("requires quoted conversation evidence and owned references", async () => {
  const c = await f.repo.insert("conversations", {
    title: "Evidence",
    metadata: {},
  });
  const m = await f.repo.insert("messages", {
    conversation_id: c.id,
    role: "user",
    content: "The release moved to Friday",
    metadata: {},
  });
  await expect(
    approved(
      req("memory.capture", {
        class: "EPISODIC",
        content: "The release moved to Monday",
        source_message_id: m.id,
      }),
    ),
  ).rejects.toThrow("quote");
  const result = await approved(
    req("memory.capture", {
      class: "EPISODIC",
      content: m.content,
      source_message_id: m.id,
    }),
  );
  expect(
    (await service.inspect(String(result.result.memory_id))).history.sources[0]
      .source_message_id,
  ).toBe(m.id);
});
it("exposes provenance, learned time, confidence and transparent retrieval reasons", async () => {
  const m = await record();
  const hits = await f.memories.searchMemories("offline hiking maps");
  expect(hits[0].id).toBe(m.id);
  expect(hits[0].explanation?.learned_at).toBe(m.created_at);
  expect(hits[0].explanation?.provenance[0].kind).toBe("manual");
  expect(hits[0].explanation?.relevant_because.length).toBeGreaterThan(0);
  const d = await service.inspect(m.id);
  expect(d.confidence).toBe(0.8);
  expect(d.history.versions.length).toBeGreaterThan(0);
});
it("consolidates only after review, preserving originals and lowering confidence to weakest source", async () => {
  const a = await record(),
    b = await f.memories.createMemory({
      content: "Wag Trails includes trail elevation",
      confidence_score: 0.6,
    });
  const r = req("memory.consolidate", {
    sources: [a, b].map((m) => ({ id: m.id, updated_at: m.updated_at })),
    summary: "Wag Trails provides offline maps and trail elevation",
  });
  const id = await pending(r);
  expect(await f.repo.list("memories")).toHaveLength(2);
  await permissions.review(id, "approved", "Reviewed both source facts");
  const result = await f.coordinator.requests.request(r);
  const d = await service.inspect(String(result.result.memory_id));
  expect(d.confidence).toBe(0.6);
  expect(d.consolidated_sources).toHaveLength(2);
  expect(await f.repo.get("memories", a.id)).toEqual(a);
  expect(await f.repo.get("memories", b.id)).toEqual(b);
});
it("rejects consolidation of conflicting and changed sources", async () => {
  const a = await record(),
    b = await f.memories.createMemory({
      content: "Wag Trails does not include maps",
    });
  const input = {
    sources: [a, b].map((m) => ({ id: m.id, updated_at: m.updated_at })),
    summary: "A summary",
  };
  const r = req("memory.consolidate", input),
    id = await pending(r);
  await f.memories.updateMemory(a.id, {
    content: "Wag Trails now includes routing",
  });
  await permissions.review(id, "approved", "Approved earlier source");
  await expect(f.coordinator.requests.request(r)).rejects.toThrow("changed");
  await f.repo.insert("memory_conflicts", {
    existing_memory_id: a.id,
    candidate_memory_id: b.id,
    reason: "Conflict",
    status: "pending",
  });
  await expect(approved(req("memory.consolidate", input))).rejects.toThrow(
    "contradictions",
  );
  expect(await f.repo.list("memories")).toHaveLength(2);
});
it("archive suppresses recall including direct consolidated summaries", async () => {
  const a = await record(),
    b = await f.memories.createMemory({
      content: "Wag Trails trail elevation",
    });
  await approved(
    req("memory.consolidate", {
      sources: [a, b].map((m) => ({ id: m.id, updated_at: m.updated_at })),
      summary: "Wag Trails supports offline maps and elevation",
    }),
  );
  await approved(
    req("memory.forget", {
      id: a.id,
      expected_updated_at: a.updated_at,
      reason: "Retire source",
    }),
  );
  const hits = await f.memories.searchMemories("offline maps");
  expect(
    hits.some((m) => m.id === a.id || policyFor(m).consolidated_from.length),
  ).toBe(false);
  expect((await service.inspect(a.id)).history.versions.length).toBeGreaterThan(
    1,
  );
});
it("deletes only approved memory record and history, retains source conversation and audit", async () => {
  const a = await record(),
    r = req("memory.delete_record", {
      id: a.id,
      expected_updated_at: a.updated_at,
      reason: "Delete fixture",
    });
  await approved(r);
  expect(await f.repo.get("memories", a.id)).toBeNull();
  expect(await f.repo.list("memory_sources", { memory_id: a.id })).toHaveLength(
    0,
  );
  expect(
    await f.repo.list("memory_versions", { record_id: a.id }),
  ).toHaveLength(0);
  expect(
    (await f.repo.list("actions")).some(
      (x) => x.tool_name === "memory.delete_record" && x.status === "succeeded",
    ),
  ).toBe(true);
  await f.coordinator.requests.request(r);
  expect(await f.repo.list("memories")).toHaveLength(0);
});
it("rolls back record deletion if a later batch mutation fails", async () => {
  const a = await record();
  const before = await service.inspect(a.id);
  await expect(
    f.repo.batch([
      {
        kind: "delete_memory",
        table: "memories",
        id: a.id,
        expected_updated_at: a.updated_at,
      },
      {
        kind: "check",
        table: "entities",
        id: randomUUID(),
        expected_updated_at: a.updated_at,
      },
    ]),
  ).rejects.toThrow();
  expect(await service.inspect(a.id)).toEqual(before);
});
it("preserves referenced history and rejects cross-user deletion", async () => {
  const a = await record();
  const other = new LocalRepository(randomUUID(), join(dir, "fixture.json"));
  await expect(
    other.batch([
      {
        kind: "delete_memory",
        table: "memories",
        id: a.id,
        expected_updated_at: a.updated_at,
      },
    ]),
  ).rejects.toThrow();
  await f.repo.update(
    "memories",
    (await f.memories.createMemory({ content: "New revision" })).id,
    { supersedes_id: a.id },
  );
  await expect(
    approved(
      req("memory.delete_record", {
        id: a.id,
        expected_updated_at: a.updated_at,
        reason: "Cannot break versions",
      }),
    ),
  ).rejects.toThrow("dependent");
  expect(await f.repo.get("memories", a.id)).not.toBeNull();
});
it("cannot strip scoped policy using the legacy update interface", async () => {
  const c = await f.repo.insert("conversations", {
    title: "Scope",
    metadata: {},
  });
  const result = await approved(
    req("memory.capture", {
      class: "WORKING",
      content: "Temporary draft",
      conversation_id: c.id,
      expires_at: new Date(Date.now() + 3600000).toISOString(),
    }),
  );
  const m = await f.memories.updateMemory(String(result.result.memory_id), {
    metadata: { tag: "new" },
  });
  expect(policyFor(m).class).toBe("WORKING");
  expect(memoryInScope(m)).toBe(false);
});
it("keeps Knowledge separate, versioned, attributed and permissioned", async () => {
  const a = await approved(
    req("knowledge.capture", {
      title: "Trail reference",
      content: "Altitude reference data",
      reference: "Owner supplied reference manual",
    }),
  );
  const id = String(a.result.knowledge_id);
  expect(await f.repo.list("memories")).toHaveLength(0);
  expect(await f.memories.searchMemories("Altitude reference")).toHaveLength(0);
  expect((await service.knowledge("Altitude"))[0].id).toBe(id);
  await approved(
    req("knowledge.capture", {
      title: "Revised trail reference",
      content: "Updated altitude reference",
      reference: "Manual revision 2",
      supersedes_id: id,
    }),
  );
  expect(await service.knowledge()).toHaveLength(1);
  expect((await f.repo.get("knowledge_documents", id))?.content).toBe(
    "Altitude reference data",
  );
  await permissions.savePolicy({
    tool: "knowledge.read",
    level: 0,
    reason: "Restricted reference access",
  });
  await expect(
    f.coordinator.requests.request(
      req("knowledge.search", { query: "Altitude" }),
    ),
  ).rejects.toThrow();
});
it("rejects knowledge edits in place and forks of one revision", async () => {
  const a = await approved(
    req("knowledge.capture", {
      title: "Reference",
      content: "Original reference",
      reference: "Manual 1",
    }),
  );
  const id = String(a.result.knowledge_id);
  await expect(
    f.repo.update("knowledge_documents", id, { content: "Silent rewrite" }),
  ).rejects.toThrow("versioned");
  await approved(
    req("knowledge.capture", {
      title: "Revision",
      content: "Updated reference",
      reference: "Manual 2",
      supersedes_id: id,
    }),
  );
  await expect(
    approved(
      req("knowledge.capture", {
        title: "Fork",
        content: "Another reference",
        reference: "Manual 3",
        supersedes_id: id,
      }),
    ),
  ).rejects.toThrow("no longer current");
});
it("does not expose global memory inspector to a scoped agent", async () => {
  const a = await record();
  await expect(
    agentExecution.run(
      {
        id: randomUUID(),
        userId: f.repo.userId,
        tools: ["memory.inspect", "memory.read"],
        permissionLevel: 5,
        check: async () => {},
      },
      () => service.inspect(a.id),
    ),
  ).rejects.toThrow("mission-scoped");
});
it("stages capture so database failure leaves no partial memory, entity link or successful outcome", async () => {
  const entity = await f.entities.createEntity({
      entity_type: "project",
      name: "Nexus",
    }),
    r = req("memory.capture", {
      class: "ENTITY",
      content: "Transactional source",
      entity_ids: [entity.id],
    });
  await permissions.review(await pending(r), "approved", "Accept fixture");
  const original = f.repo.batch.bind(f.repo);
  vi.spyOn(f.repo, "batch").mockImplementation(async (m: Mutation[]) => {
    if (m.some((x) => x.kind === "insert" && x.table === "memories"))
      throw Error("Simulated database failure");
    await original(m);
  });
  await expect(f.coordinator.requests.request(r)).rejects.toThrow();
  expect(await f.repo.list("memories")).toHaveLength(0);
  expect(await f.repo.list("memory_entities")).toHaveLength(0);
  expect(
    (await f.repo.list("actions")).some((a) => a.status === "failed"),
  ).toBe(true);
});
it("recalls classified semantic memory through paraphrases and suppresses irrelevant queries", async () => {
  const result = await approved(
    req("memory.capture", { class: "SEMANTIC", content: "company goal" }),
  );
  const hits = await f.memories.searchMemories("business aim");
  expect(hits[0].id).toBe(result.result.memory_id);
  expect(hits[0].retrieval_sources).toEqual(["semantic"]);
  expect(hits[0].text_score).toBeNull();
  expect(
    await f.memories.searchMemories("unrelated quasar banana"),
  ).toHaveLength(0);
});
it("source content edits suppress stale consolidated claims", async () => {
  const a = await record(),
    b = await f.memories.createMemory({
      content: "Wag Trails trail elevation",
    });
  const c = await approved(
    req("memory.consolidate", {
      sources: [a, b].map((m) => ({ id: m.id, updated_at: m.updated_at })),
      summary: "Wag Trails offline maps and elevation",
    }),
  );
  await f.memories.updateMemory(a.id, {
    content: "Wag Trails no longer supports offline maps",
  });
  expect(
    (await f.memories.searchMemories("Wag Trails offline maps")).some(
      (m) => m.id === c.result.memory_id,
    ),
  ).toBe(false);
});
it("applies project permission caps from input links even when envelope references are omitted", async () => {
  const p = await f.entities.createEntity({
    name: "Restricted project",
    entity_type: "project",
  });
  await permissions.savePolicy({
    tool: "memory.capture",
    product_entity_id: p.id,
    level: 0,
    reason: "Project restricted",
  });
  await expect(
    f.coordinator.requests.request(
      req("memory.capture", {
        class: "ENTITY",
        content: "Private project fact",
        entity_ids: [p.id],
      }),
    ),
  ).rejects.toThrow();
  expect(await f.repo.list("memories")).toHaveLength(0);
});
it("inherits existing creation restrictions instead of bypassing them with a new tool name", async () => {
  await permissions.savePolicy({
    tool: "memory.create",
    level: 0,
    reason: "Keep all creation blocked",
  });
  await expect(
    f.coordinator.requests.request(
      req("memory.capture", {
        class: "SEMANTIC",
        content: "Blocked via inherited policy",
      }),
    ),
  ).rejects.toThrow();
  expect(await f.repo.list("memories")).toHaveLength(0);
});
it("rejects two concurrent Knowledge successors in the local transaction layer", async () => {
  const a = await approved(
    req("knowledge.capture", {
      title: "Root",
      content: "Reference root",
      reference: "Manual 1",
    }),
  );
  const data = {
    title: "Revision",
    content: "Reference revision",
    reference: "Manual 2",
    confidence: 0.8,
    entity_ids: [],
    supersedes_id: String(a.result.knowledge_id),
    archived_at: null,
  };
  const results = await Promise.allSettled([
    f.repo.insert("knowledge_documents", data),
    f.repo.insert("knowledge_documents", data),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
});
it("classifies useful existing memory in place with stable ID, source and embedding", async () => {
  const a = await record(),
    e = await f.entities.createEntity({
      name: "Wag Trails",
      entity_type: "project",
    });
  const result = await approved(
    req("memory.classify", {
      id: a.id,
      expected_updated_at: a.updated_at,
      class: "ENTITY",
      entity_ids: [e.id],
    }),
  );
  const m = (await f.repo.get("memories", a.id))!;
  expect(result.result.memory_id).toBe(a.id);
  expect(m.content).toBe(a.content);
  expect(m.embedding).toEqual(a.embedding);
  expect(m.embedding_input_hash).toBe(a.embedding_input_hash);
  expect(m.source_message_id).toBe(a.source_message_id);
  expect(policyFor(m).class).toBe("ENTITY");
  expect(await f.repo.list("memories")).toHaveLength(1);
  expect((await service.inspect(a.id)).history.versions.length).toBeGreaterThan(
    1,
  );
});
it("requires a key for new real memory tool execution", async () => {
  await expect(
    f.coordinator.requests.request({
      tool: "memory.capture",
      input: { class: "SEMANTIC", content: "Missing key" },
      reason: "Isolated validation",
    }),
  ).rejects.toThrow("request key");
  expect(await f.repo.list("memories")).toHaveLength(0);
});
it("replays linked memory deletion using the original workspace scope", async () => {
  const m = await record(),
    e = await f.entities.createEntity({
      name: "Linked project",
      entity_type: "project",
    });
  await f.memories.linkMemoryToEntity(m.id, e.id);
  const r = req("memory.delete_record", {
    id: m.id,
    expected_updated_at: m.updated_at,
    reason: "Delete linked fixture",
  });
  await approved(r);
  const result = await f.coordinator.requests.request(r);
  expect(result.result.memory_id).toBe(m.id);
  expect(await f.repo.get("memories", m.id)).toBeNull();
});

it("bounds explanatory source text while retaining original learning and revision provenance", async () => {
  const m = await f.memories.createMemory({
    content: "company goal " + "evidence ".repeat(1500),
  });
  await f.memories.updateMemory(m.id, {
    summary: "Updated summary for company goal",
  });
  const hit = (await f.memories.searchMemories("company goal"))[0];
  expect(hit.explanation?.provenance.map((p) => p.kind)).toEqual([
    "manual",
    "revision",
  ]);
  expect(
    hit.explanation?.provenance.every((p) => (p.quote?.length ?? 0) <= 1000),
  ).toBe(true);
  expect(hit.explanation?.learned_at).toBe(m.created_at);
});
