import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { LocalRepository } from "../src/infrastructure/repositories/local";
import { MemoryService } from "../src/services/memory-service";
import { EntityService } from "../src/services/entity-service";
import { rankHybridCandidates } from "../src/services/hybrid-ranking";
import type { EmbeddingProvider } from "../src/domain/providers";
import type { MemoryHit } from "../src/domain/models";

// Controlled geometry, not synonym matching: paraphrase is orthographically unrelated.
const vectors: Record<string, number[]> = {
  "Our canine companion walks wooded routes.": [1, 0, 0],
  "Where does the dog hike?": [0.99, 0.1, 0],
};
const embedder: EmbeddingProvider = {
  modelId: "fixture",
  version: "v1",
  dimensions: 384,
  async embed(text) {
    return [...(vectors[text.trim()] ?? [0, 0, 0]), ...Array(381).fill(0)];
  },
};
let dir: string,
  repo: LocalRepository,
  memory: MemoryService,
  entity: EntityService;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ary-hybrid-"));
  repo = new LocalRepository(randomUUID(), join(dir, "db.json"));
  memory = new MemoryService(repo, embedder);
  entity = new EntityService(repo);
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

it("recalls a paraphrase through semantic candidates with no lexical or graph match", async () => {
  const fact = await memory.createMemory({
    content: "Our canine companion walks wooded routes.",
  });
  const hits = await memory.searchMemories("Where does the dog hike?");
  expect(hits.map((m) => m.id)).toEqual([fact.id]);
  expect(hits[0].retrieval_sources).toEqual(["semantic"]);
  expect(hits[0].semantic_score).toBeGreaterThan(0.99);
  expect(hits[0].text_score).toBeNull();
  expect(hits[0].score).toBeCloseTo(1 / 61, 12);
});

it("recalls exact identifiers lexically even without compatible semantic embeddings", async () => {
  const fact = await memory.createMemory({
    content: "Deployment code: QZ741 cobalt",
  });
  await repo.update("memories", fact.id, { embedding_model: "old-model" });
  const [hit] = await memory.searchMemories("QZ741 cobalt");
  expect(hit.id).toBe(fact.id);
  expect(hit.retrieval_sources).toEqual(["lexical"]);
  expect(hit.text_score).toBeGreaterThan(0);
  expect(hit.semantic_score).toBeNull();
});

it("resolves aliases then retrieves direct, one-hop and two-hop graph-only evidence, with direction and a hard hop cap", async () => {
  const nodes = await Promise.all(
    ["Ary Nexus", "Clevaryn", "Wag Trails", "Distant"].map((name) =>
      entity.createEntity({ name, entity_type: "project" }),
    ),
  );
  await entity.addAlias(nodes[0].id, "Nexus");
  const facts = [];
  for (let i = 0; i < nodes.length; i++) {
    const fact = await memory.createMemory({ content: `Obsidian record ${i}` });
    await memory.linkMemoryToEntity(fact.id, nodes[i].id);
    facts.push(fact);
    if (i)
      await entity.linkEntities({
        source_entity_id: nodes[i].id,
        target_entity_id: nodes[i - 1].id,
        relationship_type: "supports",
      });
  }
  const hits = await memory.searchMemories("Nexus");
  expect(hits.map((m) => m.id)).toEqual(facts.slice(0, 3).map((m) => m.id));
  expect(hits.map((m) => m.graph_hops)).toEqual([0, 1, 2]);
  expect(hits.map((m) => m.final_rank)).toEqual([1, 2, 3]);
  expect(hits[0].retrieval_sources).toEqual(["entity"]);
  expect(hits[2].retrieval_sources).toEqual(["graph"]);
  expect(hits[2].graph_steps?.map((s) => s.traversal)).toEqual([
    "reverse",
    "reverse",
  ]);
  expect(hits[2].graph_path).toContain("Wag Trails");
  expect(
    hits.every((m) => m.semantic_score === null && m.text_score === null),
  ).toBe(true);
});

it("suppresses irrelevant and empty queries despite high importance/confidence and populated graph", async () => {
  const root = await entity.createEntity({
    name: "Ary Nexus",
    entity_type: "project",
  });
  const fact = await memory.createMemory({
    content: "Our canine companion walks wooded routes.",
    importance_score: 1,
    confidence_score: 1,
  });
  await memory.linkMemoryToEntity(fact.id, root.id);
  expect(await memory.searchMemories("quasar invoice plutonium")).toEqual([]);
  expect(await memory.searchMemories(" ")).toEqual([]);
  expect(await memory.searchMemories("the and of")).toEqual([]);
});

it("filters every candidate channel by tenant, status and time before ranking", async () => {
  const root = await entity.createEntity({
    name: "Ary Nexus",
    entity_type: "project",
  });
  const good = await memory.createMemory({ content: "eligible fixture" });
  await memory.linkMemoryToEntity(good.id, root.id);
  for (const patch of [
    { status: "superseded" as const },
    { status: "disputed" as const },
    { archived_at: "2020-01-01T00:00:00Z" },
    { valid_from: "2099-01-01T00:00:00Z" },
    { valid_to: "2020-01-01T00:00:00Z" },
  ]) {
    const fact = await memory.createMemory({ content: "eligible fixture" });
    await memory.linkMemoryToEntity(fact.id, root.id);
    await repo.update("memories", fact.id, patch);
  }
  const stranger = new MemoryService(
    new LocalRepository(randomUUID(), join(dir, "db.json")),
    embedder,
  );
  await stranger.createMemory({ content: "eligible fixture" });
  const hits = await memory.getRelevantMemories("eligible fixture", 8, [
    root.id,
  ]);
  expect(hits.map((m) => m.id)).toEqual([good.id]);
  expect(hits[0].text_rank).toBe(1);
  expect(hits[0].graph_rank).toBe(1);
  expect(await stranger.getRelevantMemories("Ary Nexus", 8, [root.id])).toEqual(
    [],
  );
});

it("blocks expired and zero-strength relationships and superseded provenance", async () => {
  const a = await entity.createEntity({
    name: "Ary Nexus",
    entity_type: "project",
  });
  const b = await entity.createEntity({
    name: "Wag Trails",
    entity_type: "project",
  });
  const fact = await memory.createMemory({ content: "Obsidian record" });
  const evidence = await memory.createMemory({
    content: "Supports relationship",
  });
  await memory.linkMemoryToEntity(fact.id, b.id);
  const edge = await entity.linkEntities({
    source_entity_id: a.id,
    target_entity_id: b.id,
    relationship_type: "tracks",
    memory_id: evidence.id,
  });
  expect(await memory.searchMemories("Ary Nexus")).toHaveLength(1);
  await repo.update("relationships", edge.id, { strength: 0 });
  expect(await memory.searchMemories("Ary Nexus")).toEqual([]);
  await repo.update("relationships", edge.id, {
    strength: 1,
    valid_to: "2020-01-01T00:00:00Z",
  });
  expect(await memory.searchMemories("Ary Nexus")).toEqual([]);
  await repo.update("relationships", edge.id, { valid_to: null });
  await repo.update("memories", evidence.id, { status: "superseded" });
  expect(await memory.searchMemories("Ary Nexus")).toEqual([]);
});

it("fuses three independent ranks once and uses quality only for tied RRF scores", async () => {
  const base = await memory.createMemory({ content: "fixture" });
  const hit = (id: string, patch: Partial<MemoryHit>): MemoryHit => ({
    ...base,
    id,
    similarity: 0,
    score: 99,
    ...patch,
  });
  const ranked = rankHybridCandidates(
    [
      hit("all", {
        semantic_rank: 1,
        semantic_score: 0.9,
        text_rank: 2,
        text_score: 0.2,
        graph_hops: 0,
        importance_score: 0,
        confidence_score: 0,
      }),
      hit("semantic", {
        semantic_rank: 2,
        semantic_score: 0.8,
        importance_score: 1,
      }),
      hit("lexical", { text_rank: 1, text_score: 0.8, importance_score: 1 }),
      hit("irrelevant", { importance_score: 1, confidence_score: 1 }),
    ],
    8,
  );
  expect(ranked[0].id).toBe("all");
  expect(ranked[0].score).toBeCloseTo(1 / 61 + 1 / 62 + 1 / 61, 12);
  expect(ranked[0].retrieval_sources).toEqual([
    "semantic",
    "lexical",
    "entity",
  ]);
  expect(ranked.map((m) => m.id)).not.toContain("irrelevant");
  const ties = rankHybridCandidates(
    [
      hit("a", {
        semantic_rank: 1,
        semantic_score: 0.9,
        confidence_score: 0.1,
      }),
      hit("b", { text_rank: 1, text_score: 0.9, confidence_score: 0.9 }),
    ],
    8,
  );
  expect(ties[0].score).toBe(ties[1].score);
  expect(ties[0].id).toBe("b");
});
