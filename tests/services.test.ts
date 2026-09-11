import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalRepository } from "../src/infrastructure/repositories/local";
import {
  LocalEmbeddingProvider,
  MockLanguageModel,
} from "../src/infrastructure/providers/local";
import { MemoryService } from "../src/services/memory-service";
import { EntityService } from "../src/services/entity-service";
import { AryBrainService } from "../src/services/ary-brain-service";
import { ActionService } from "../src/services/action-service";
import { seed } from "../src/infrastructure/seed";
const userA = "11111111-1111-4111-8111-111111111111",
  userB = "22222222-2222-4222-8222-222222222222";
let directory: string,
  repo: LocalRepository,
  memory: MemoryService,
  entities: EntityService;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "ary-test-"));
  repo = new LocalRepository(userA, join(directory, "data.json"));
  memory = new MemoryService(repo, new LocalEmbeddingProvider());
  entities = new EntityService(repo);
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
  vi.restoreAllMocks();
});
describe("Memory foundation", () => {
  it("ranks relevant evidence, excludes unrelated and archived memories, and tracks access", async () => {
    const relevant = await memory.createMemory({
      content: "Ary Nexus stores persistent memory and knowledge.",
      importance_score: 1,
    });
    await memory.createMemory({
      content: "Bananas ripen on kitchen counters.",
    });
    const hits = await memory.getRelevantMemories("Ary Nexus memory");
    expect(hits[0].id).toBe(relevant.id);
    expect(hits.every((h) => !h.content.includes("Bananas"))).toBe(true);
    expect(
      (await repo.get("memories", relevant.id))?.last_accessed_at,
    ).not.toBeNull();
    await memory.archiveMemory(relevant.id);
    expect(await memory.searchMemories("Ary Nexus memory")).toEqual([]);
  });
  it("preserves scores on partial edits and re-embeds changed content", async () => {
    const first = await memory.createMemory({
      content: "A purple telescope",
      memory_type: "preference",
      importance_score: 0.95,
      confidence_score: 0.9,
      metadata: { source: "test" },
    });
    const updated = await memory.updateMemory(first.id, {
      content: "A yellow submarine",
    });
    expect(updated.embedding).not.toEqual(first.embedding);
    expect(updated.importance_score).toBe(0.95);
    expect(updated.confidence_score).toBe(0.9);
    expect(updated.memory_type).toBe("preference");
    expect(updated.metadata).toMatchObject({ source: "test" });
    await expect(
      memory.updateMemory(first.id, { importance_score: 2 }),
    ).rejects.toThrow();
  });
  it("persists across repository instances and serializes concurrent writes", async () => {
    await Promise.all(
      Array.from({ length: 15 }, (_, i) =>
        memory.createMemory({ content: `record ${i}` }),
      ),
    );
    const reopened = new LocalRepository(userA, join(directory, "data.json"));
    expect(await reopened.list("memories")).toHaveLength(15);
  });
  it("enforces tenant boundaries for reads, updates, memory links, and entity edges", async () => {
    const foreignRepo = new LocalRepository(
      userB,
      join(directory, "data.json"),
    );
    const foreignMemory = new MemoryService(
      foreignRepo,
      new LocalEmbeddingProvider(),
    );
    const foreignEntities = new EntityService(foreignRepo);
    const secret = await foreignMemory.createMemory({
      content: "Secret confidential strategy",
    });
    const foreign = await foreignEntities.createEntity({
      name: "Private entity",
      entity_type: "company",
    });
    const own = await entities.createEntity({
      name: "My entity",
      entity_type: "project",
    });
    expect(await repo.get("memories", secret.id)).toBeNull();
    expect(await memory.searchMemories("confidential strategy")).toEqual([]);
    await expect(
      memory.updateMemory(secret.id, { content: "changed" }),
    ).rejects.toThrow("not found");
    await expect(memory.linkMemoryToEntity(secret.id, own.id)).rejects.toThrow(
      "not found",
    );
    await expect(
      entities.linkEntities({
        source_entity_id: own.id,
        target_entity_id: foreign.id,
        relationship_type: "owns",
      }),
    ).rejects.toThrow("not found");
  });
  it("does not compare vectors from different embedding models", async () => {
    const first = await memory.createMemory({
      content: "A record with zebra context",
    });
    await repo.update("memories", first.id, {
      embedding_model: "different-model",
    });
    const hits = await memory.searchMemories("zebra");
    expect(hits[0].similarity).toBe(0);
    expect(hits[0].id).toBe(first.id);
  });
  it("seeds idempotently and returns a bounded graph", async () => {
    await seed(repo, entities, memory);
    await seed(repo, entities, memory);
    expect(await repo.list("entities")).toHaveLength(3);
    expect(await repo.list("memories")).toHaveLength(5);
    expect(await repo.list("relationships")).toHaveLength(2);
    const ary = (await entities.findEntity("Ary Nexus"))!;
    expect((await entities.getEntityGraph(ary.id, 0)).nodes).toHaveLength(1);
    expect((await entities.getEntityGraph(ary.id, 1)).edges).toHaveLength(2);
    expect(await entities.findEntity("ary nexus")).toEqual(ary);
  });
});
it("uses explicit entity links to prioritize otherwise equivalent evidence over passing mentions", async () => {
  const ary = await entities.createEntity({
    name: "Ary Nexus",
    entity_type: "project",
  });
  const passing = await memory.createMemory({
    content: "Ary Nexus persistent memory",
  });
  const linked = await memory.createMemory({ content: passing.content });
  await memory.linkMemoryToEntity(linked.id, ary.id);
  const hits = await memory.getRelevantMemories("Ary Nexus");
  expect(hits[0].id).toBe(linked.id);
  expect(hits[0].retrieval_reasons).toContain("Linked entity");
  expect(hits[1].id).toBe(passing.id);
});

describe("Brain and permissions", () => {
  it("delivers a response before extraction, then saves provenance, links, history, actions and outcomes", async () => {
    await seed(repo, entities, memory);
    const llm = new MockLanguageModel();
    const extract = vi.spyOn(llm, "extractMemories");
    const brain = new AryBrainService(
      repo,
      memory,
      entities,
      llm,
      new ActionService(repo),
    );
    const stream = brain.respond({
      input: "Remember: Ary Nexus needs inspectable memory sources.",
    });
    expect((await stream.next()).value?.type).toBe("entities");
    const first = await stream.next();
    expect(first.value?.type).toBe("response");
    expect(extract).not.toHaveBeenCalled();
    const done = await stream.next();
    expect(done.value?.type).toBe("complete");
    expect(extract).toHaveBeenCalledOnce();
    const saved = (await repo.list("memories")).find(
      (m) => m.content === "Ary Nexus needs inspectable memory sources.",
    )!;
    expect(saved.source_message_id).toBeTruthy();
    expect(
      await repo.list("memory_entities", { memory_id: saved.id }),
    ).toHaveLength(1);
    const messages = await repo.list("messages");
    expect(messages).toHaveLength(2);
    expect(messages[1].metadata.extraction_status).toBe("completed");
    expect(messages[1].metadata.retrieved_memories).toBeInstanceOf(Array);
    expect(await repo.list("outcomes")).toHaveLength(2);
    await stream.next();
  });
  it("retains the delivered answer and reports failed extraction", async () => {
    const llm = new MockLanguageModel();
    vi.spyOn(llm, "extractMemories").mockRejectedValue(
      new Error("Provider offline"),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    const brain = new AryBrainService(
      repo,
      memory,
      entities,
      llm,
      new ActionService(repo),
    );
    const stream = brain.respond({ input: "Hello" });
    expect((await stream.next()).value?.type).toBe("entities");
    expect((await stream.next()).value?.type).toBe("response");
    const end = (await stream.next()).value;
    expect(end?.type).toBe("complete");
    if (end?.type === "complete") expect(end.warnings).toHaveLength(1);
    expect((await repo.list("messages"))[1].metadata.extraction_status).toBe(
      "failed",
    );
    expect(
      (await repo.list("actions")).find((a) => a.tool_name === "memory.extract")
        ?.status,
    ).toBe("failed");
  });
  it("logs blocked unknown actions without executing them", async () => {
    const operation = vi.fn();
    await expect(
      new ActionService(repo).run("email.send", null, operation),
    ).rejects.toThrow("not permitted");
    expect(operation).not.toHaveBeenCalled();
    expect((await repo.list("actions"))[0].status).toBe("blocked");
  });
});
