import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { LocalRepository } from "../src/infrastructure/repositories/local";
import {
  LocalEmbeddingProvider,
  MockLanguageModel,
} from "../src/infrastructure/providers/local";
import { MemoryService } from "../src/services/memory-service";
import { EntityService } from "../src/services/entity-service";
import { MemoryReconciliationService } from "../src/services/memory-reconciliation-service";
import type { LanguageModelProvider } from "../src/domain/providers";
let dir: string,
  repo: LocalRepository,
  memories: MemoryService,
  entities: EntityService;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ary-knowledge-"));
  repo = new LocalRepository(randomUUID(), join(dir, "data.json"));
  memories = new MemoryService(repo, new LocalEmbeddingProvider());
  entities = new EntityService(repo);
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});
async function job(content: string) {
  const conversation = await repo.insert("conversations", {
    title: "Test",
    metadata: {},
  });
  const source = await repo.insert("messages", {
    conversation_id: conversation.id,
    role: "user",
    content,
    metadata: {},
  });
  return repo.insert("extraction_jobs", {
    source_message_id: source.id,
    status: "pending",
    attempts: 0,
    lease_until: null,
    error: null,
    saved_memory_ids: [],
  });
}
function engine(
  extract: NonNullable<LanguageModelProvider["extractCandidates"]>,
) {
  const model = new MockLanguageModel();
  return new MemoryReconciliationService(repo, memories, entities, {
    name: model.name,
    identifyIntent: model.identifyIntent,
    reason: model.reason,
    extractMemories: model.extractMemories,
    extractCandidates: extract,
  });
}
describe("Evidence and reconciliation", () => {
  it("replays a failed duplicate extraction without inserting existing or staged entity links", async () => {
    const ary = await entities.createEntity({
      entity_type: "project",
      name: "Ary Nexus",
    });
    const existing = await memories.createMemory({
      content: "Ary Nexus stores persistent memory",
    });
    await memories.linkMemoryToEntity(existing.id, ary.id);
    const batch = repo.batch.bind(repo);
    // Local storage historically tolerates duplicate links; mirror the real SQL
    // unique constraint here so this production failure cannot be hidden.
    vi.spyOn(repo, "batch").mockImplementation(async (mutations) => {
      const links = new Set(
        (await repo.list("memory_entities")).map(
          (l) => `${l.memory_id}:${l.entity_id}`,
        ),
      );
      for (const m of mutations)
        if (m.kind === "insert" && m.table === "memory_entities") {
          const key = `${m.data.memory_id}:${m.data.entity_id}`;
          if (links.has(key))
            throw new Error(
              "duplicate key violates memory_entities unique constraint",
            );
          links.add(key);
        }
      return batch(mutations);
    });
    const task = await job("Ary Nexus stores persistent memory");
    await repo.update("extraction_jobs", task.id, {
      status: "failed",
      attempts: 2,
      error: "This record already exists",
    });
    const service = engine(async (c) =>
      [0, 1].map(() => ({
        memory: { content: existing.content },
        evidence_quote: c.source.content,
        entity_ids: [ary.id],
      })),
    );
    await service.runJob(task.id);
    await service.runJob(task.id);
    expect(await repo.list("memories")).toHaveLength(1);
    expect(await repo.list("memory_entities")).toHaveLength(1);
    expect(
      await repo.list("memory_evidence", {
        source_message_id: task.source_message_id,
      }),
    ).toHaveLength(1);
    expect(await repo.get("extraction_jobs", task.id)).toMatchObject({
      status: "completed",
      attempts: 3,
    });
  });
  it("adds a missing entity link once when duplicate candidates repeat in a batch", async () => {
    const ary = await entities.createEntity({
      entity_type: "project",
      name: "Ary Nexus",
    });
    const existing = await memories.createMemory({
      content: "Ary Nexus stores persistent memory",
    });
    const spy = vi.spyOn(repo, "batch");
    await engine(async (c) =>
      [0, 1].map(() => ({
        memory: { content: existing.content },
        evidence_quote: c.source.content,
        entity_ids: [ary.id],
      })),
    ).runJob((await job(existing.content)).id);
    const inserts = spy.mock.calls
      .flatMap(([mutations]) => mutations)
      .filter((m) => m.kind === "insert" && m.table === "memory_entities");
    expect(inserts).toHaveLength(1);
    expect(await repo.list("memory_entities")).toHaveLength(1);
  });
  it("commits once across retries and attaches repeated evidence without duplicating a memory", async () => {
    const service = engine(async (c) => [
      {
        memory: { content: "Ary Nexus stores persistent memory" },
        evidence_quote: c.source.content,
      },
    ]);
    const first = await job("Remember: Ary Nexus stores persistent memory");
    const ids = await service.runJob(first.id);
    expect(await service.runJob(first.id)).toEqual(ids);
    await service.runJob((await job("Ary Nexus stores persistent memory")).id);
    expect(await repo.list("memories")).toHaveLength(1);
    expect(await repo.list("memory_evidence")).toHaveLength(2);
  });
  it("rejects fabricated evidence atomically and leaves the job retryable", async () => {
    const service = engine(async (c) => [
      {
        memory: { content: "Ary Nexus stores memory" },
        evidence_quote: c.source.content,
      },
      {
        memory: { content: "Wag Trails is sold" },
        evidence_quote: "a fabricated quote",
      },
    ]);
    const task = await job("Ary Nexus stores memory");
    await expect(service.runJob(task.id)).rejects.toThrow("not present");
    expect(await repo.list("memories")).toHaveLength(0);
    expect(await repo.list("memory_versions")).toHaveLength(0);
    expect((await repo.get("extraction_jobs", task.id))?.status).toBe("failed");
  });
  it("preserves both sides of a conflict until a reviewed replacement, including historic knowledge", async () => {
    const previous = await memories.createMemory({
      content: "Ary Nexus launches in June",
      valid_from: "2026-01-01T00:00:00Z",
    });
    const service = engine(async (c) => [
      {
        memory: {
          content: "Ary Nexus launches in July",
          valid_from: "2026-06-01T00:00:00Z",
        },
        evidence_quote: c.source.content,
        disposition: "supersede",
        related_memory_id: previous.id,
      },
    ]);
    const [candidateId] = await service.runJob(
      (await job("Correction: Ary Nexus launches in July")).id,
    );
    const before = new Date().toISOString();
    expect((await repo.get("memories", previous.id))?.status).toBe("active");
    expect((await repo.get("memories", candidateId))?.status).toBe("disputed");
    expect(
      (await memories.searchMemories("Ary Nexus launches July")).some(
        (m) => m.id === candidateId,
      ),
    ).toBe(false);
    const [conflict] = await repo.list("memory_conflicts");
    await service.resolveConflict(conflict.id, "replaced");
    expect((await repo.get("memories", previous.id))?.status).toBe(
      "superseded",
    );
    expect((await repo.get("memories", candidateId))?.supersedes_id).toBe(
      previous.id,
    );
    expect(
      (await memories.atTime(before)).some((m) => m.id === previous.id),
    ).toBe(true);
    expect(
      (await memories.history(previous.id)).versions.length,
    ).toBeGreaterThan(1);
    await expect(
      service.resolveConflict(conflict.id, "replaced"),
    ).rejects.toThrow("already resolved");
  });
  it("rolls back a batch with a foreign reference, and blocks competing stale writes", async () => {
    const first = await memories.createMemory({ content: "Original fact" });
    await expect(
      repo.batch([
        {
          kind: "update",
          table: "memories",
          id: first.id,
          data: { content: "Should roll back" },
        },
        {
          kind: "insert",
          table: "memory_evidence",
          data: {
            memory_id: first.id,
            source_message_id: randomUUID(),
            quote: "unknown",
            evidence_type: "supports",
          },
        },
      ]),
    ).rejects.toThrow();
    expect((await repo.get("memories", first.id))?.content).toBe(
      "Original fact",
    );
    await memories.updateMemory(first.id, { content: "Changed" });
    await expect(
      repo.batch([
        {
          kind: "update",
          table: "memories",
          id: first.id,
          expected_updated_at: first.updated_at,
          data: { content: "Stale" },
        },
      ]),
    ).rejects.toThrow("Record changed");
  });
  it("does not create versions for access timestamps", async () => {
    const memory = await memories.createMemory({ content: "Ary Nexus memory" });
    await memories.getRelevantMemories("Ary Nexus");
    expect((await memories.history(memory.id)).versions).toHaveLength(1);
  });
});
describe("Entity and graph retrieval", () => {
  it("resolves an alias and retrieves a graph-only memory outside text candidates", async () => {
    const ary = await entities.createEntity({
      entity_type: "project",
      name: "Ary Nexus",
    });
    const wag = await entities.createEntity({
      entity_type: "project",
      name: "Wag Trails",
    });
    await entities.addAlias(ary.id, "Nexus");
    expect(
      (await entities.resolveEntities("Tell me about Nexus")).map((e) => e.id),
    ).toEqual([ary.id]);
    expect(await entities.resolveEntities("Nexusology")).toEqual([]);
    await entities.linkEntities({
      source_entity_id: ary.id,
      target_entity_id: wag.id,
      relationship_type: "tracks",
    });
    const memory = await memories.createMemory({
      content: "Obsidian lunar telescope",
    });
    await memories.linkMemoryToEntity(memory.id, wag.id);
    expect(
      await repo.search(
        "Nexus",
        await new LocalEmbeddingProvider().embed("Nexus"),
        "local-concepts-v1:384",
        200,
        "local-concepts-v1",
      ),
    ).toHaveLength(0);
    const hits = await memories.getRelevantMemories("Nexus", 8, [ary.id]);
    expect(hits[0].id).toBe(memory.id);
    expect(hits[0].graph_path).toEqual(["Ary Nexus", "tracks", "Wag Trails"]);
    await expect(entities.addAlias(wag.id, "Nexus")).rejects.toThrow(
      "another entity",
    );
    const stranger = new MemoryService(
      new LocalRepository(randomUUID(), join(dir, "data.json")),
      new LocalEmbeddingProvider(),
    );
    expect(await stranger.getRelevantMemories("Nexus", 8, [ary.id])).toEqual(
      [],
    );
  });
  it("excludes future and expired facts from present retrieval", async () => {
    await memories.createMemory({
      content: "Ary Nexus future",
      valid_from: "2099-01-01T00:00:00Z",
    });
    await memories.createMemory({
      content: "Ary Nexus past",
      valid_to: "2020-01-01T00:00:00Z",
    });
    expect(await memories.searchMemories("Ary Nexus")).toEqual([]);
  });
});

it("expires relationship paths while retaining relationship history", async () => {
  const a = await entities.createEntity({
    entity_type: "project",
    name: "Nexus",
  });
  const b = await entities.createEntity({
    entity_type: "project",
    name: "Trails",
  });
  const edge = await entities.linkEntities({
    source_entity_id: a.id,
    target_entity_id: b.id,
    relationship_type: "tracks",
  });
  const memory = await memories.createMemory({
    content: "Unrelated telescope",
  });
  await memories.linkMemoryToEntity(memory.id, b.id);
  expect(
    (await memories.getRelevantMemories("Nexus", 8, [a.id])).map((m) => m.id),
  ).toContain(memory.id);
  await entities.endRelationship(edge.id);
  expect(await memories.getRelevantMemories("Nexus", 8, [a.id])).toEqual([]);
  expect(
    await repo.list("relationship_versions", { record_id: edge.id }),
  ).toHaveLength(2);
});

it("records provenance for manual, seed, conversation, revision and unknown legacy memories", async () => {
  const manual = await memories.createMemory({ content: "Manual source fact" });
  expect((await memories.history(manual.id)).sources[0]).toMatchObject({
    kind: "manual",
    quote: "Manual source fact",
  });
  await memories.updateMemory(manual.id, {
    content: "Revised manual source fact",
  });
  const history = await memories.history(manual.id);
  expect(history.sources.map((s) => s.kind)).toEqual(["manual", "revision"]);
  expect(history.sources[0].quote).toBe("Manual source fact");
  await expect(
    repo.update("memory_sources", history.sources[0].id, { quote: "forged" }),
  ).rejects.toThrow("read-only");
  const seed = await memories.createMemory({
    content: "Seed fact",
    metadata: { seed: true, source: "fixture:brief" },
  });
  expect((await memories.history(seed.id)).sources[0]).toMatchObject({
    kind: "seed",
    reference: "fixture:brief",
  });
  const service = engine(async (c) => [
    {
      memory: { content: "Source-backed fact" },
      evidence_quote: c.source.content,
    },
  ]);
  const [id] = await service.runJob((await job("Source-backed fact")).id);
  expect((await memories.history(id)).sources[0]).toMatchObject({
    kind: "conversation",
    quote: "Source-backed fact",
  });
  const legacy = await repo.insert(
    "memories",
    await memories.prepare({ content: "Unknown origin" }),
  );
  expect((await memories.history(legacy.id)).sources[0]).toMatchObject({
    kind: "legacy_unknown",
    quote: null,
  });
});
it.each(["new", "duplicate"] as const)(
  "detects opposing statements despite the provider's %s label",
  async (disposition) => {
    const old = await memories.createMemory({ content: "Ary Nexus is public" });
    const service = engine(async (c) => [
      {
        memory: { content: "Ary Nexus is not public" },
        evidence_quote: c.source.content,
        disposition,
        related_memory_id: disposition === "duplicate" ? old.id : null,
      },
    ]);
    const [id] = await service.runJob(
      (await job("Ary Nexus is not public")).id,
    );
    expect((await repo.get("memories", id))?.status).toBe("disputed");
    const [conflict] = await repo.list("memory_conflicts");
    expect(conflict.reason).toContain("negation");
    const hits = await memories.searchMemories("Ary Nexus public");
    expect(hits.find((m) => m.id === old.id)).toMatchObject({
      unresolved_conflict_count: 1,
    });
    expect(hits.find((m) => m.id === old.id)?.source_evidence?.[0].kind).toBe(
      "manual",
    );
    expect(hits.some((m) => m.id === id)).toBe(false);
  },
);
it("does not collapse a changed month into a duplicate and gives replacements explicit validity", async () => {
  const old = await memories.createMemory({
    content: "Ary Nexus launches in June",
  });
  const service = engine(async (c) => [
    {
      memory: { content: "Ary Nexus launches in July" },
      evidence_quote: c.source.content,
      disposition: "duplicate",
      related_memory_id: old.id,
    },
  ]);
  const [id] = await service.runJob(
    (await job("Correction: Ary Nexus launches in July")).id,
  );
  const [conflict] = await repo.list("memory_conflicts");
  await expect(
    service.resolveConflict(conflict.id, "replaced", "2099-01-01T00:00:00Z"),
  ).rejects.toThrow("Future-dated");
  expect((await repo.get("memories", old.id))?.status).toBe("active");
  await service.resolveConflict(conflict.id, "replaced");
  const before = (await repo.get("memories", old.id))!;
  const after = (await repo.get("memories", id))!;
  expect(before.status).toBe("superseded");
  expect(before.valid_to).toBeTruthy();
  expect(after.valid_from).toBe(before.valid_to);
  expect(
    (await memories.searchMemories("Ary Nexus launch")).map((m) => m.id),
  ).toContain(id);
  expect(
    (await memories.searchMemories("Ary Nexus launch")).map((m) => m.id),
  ).not.toContain(old.id);
});
it("checks new dated statements against retrieved facts even without a reconciliation target", async () => {
  const old = await memories.createMemory({
    content: "Ary Nexus launches in June",
  });
  const service = engine(async (c) => [
    {
      memory: { content: "Ary Nexus launches in July" },
      evidence_quote: c.source.content,
      disposition: "new",
    },
  ]);
  await service.runJob((await job("Ary Nexus launches in July")).id);
  expect((await repo.list("memory_conflicts"))[0].existing_memory_id).toBe(
    old.id,
  );
});
it("rejects fabricated quote updates and assistant-authored user facts", async () => {
  const j = await job("A real quote");
  const memory = await memories.createMemory({
    content: "A real quote",
    source_message_id: j.source_message_id,
  });
  const evidence = await repo.insert("memory_evidence", {
    memory_id: memory.id,
    source_message_id: j.source_message_id,
    quote: "A real quote",
    evidence_type: "supports",
  });
  await expect(
    repo.update("memory_evidence", evidence.id, { quote: "fake" }),
  ).rejects.toThrow("immutable");
  const original = (await repo.get("messages", j.source_message_id))!;
  const assistant = await repo.insert("messages", {
    conversation_id: original.conversation_id,
    role: "assistant",
    content: "I invented this",
    metadata: {},
  });
  await expect(
    memories.createMemory({
      content: "I invented this",
      source_message_id: assistant.id,
    }),
  ).rejects.toThrow("Only user");
});
