import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { LocalRepository } from "../src/infrastructure/repositories/local";
import { EntityService } from "../src/services/entity-service";
import { MemoryService } from "../src/services/memory-service";
import { AryBrainService } from "../src/services/ary-brain-service";
import { ActionService } from "../src/services/action-service";
import {
  LocalEmbeddingProvider,
  MockLanguageModel,
} from "../src/infrastructure/providers/local";
import type { BrainContext } from "../src/domain/providers";
let dir: string, repo: LocalRepository, service: EntityService;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ary-entity-"));
  repo = new LocalRepository(randomUUID(), join(dir, "data.json"));
  service = new EntityService(repo);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});
const create = (
  name: string,
  entity_type: "company" | "project" | "person" = "company",
) => service.createEntity({ name, entity_type });
it("resolves Ary Nexus canonically and Nexus as an alias to the same stable ID", async () => {
  const ary = await create("Ary Nexus", "project");
  await service.addAlias(ary.id, "Nexus");
  const names = await service.resolveMentions("What does Ary Nexus do?");
  expect(names.resolutions).toHaveLength(1);
  expect(names.resolutions[0]).toMatchObject({
    mention: "Ary Nexus",
    method: "canonical",
    confidence: 1,
    canonical_entity_id: ary.id,
  });
  const aliases = await service.resolveMentions("What does NEXUS do?");
  expect(aliases.resolutions[0]).toMatchObject({
    method: "alias",
    canonical_entity_id: ary.id,
    confidence: 0.98,
  });
  expect((await repo.get("entities", ary.id))?.name).toBe("Ary Nexus");
});
it.each([
  ["Clevaryn", "Clevaryn Studio"],
  ["Wag Trails", "Trailbook"],
])(
  "resolves %s known aliases without changing canonical IDs",
  async (name, alias) => {
    const entity = await create(name);
    await service.addAlias(entity.id, alias);
    expect((await service.resolveEntities(alias)).map((e) => e.id)).toEqual([
      entity.id,
    ]);
    expect((await service.findEntity(alias))?.id).toBe(entity.id);
    const first = await service.addAlias(entity.id, alias);
    expect((await service.addAlias(entity.id, alias.toUpperCase())).id).toBe(
      first.id,
    );
  },
);
it("canonical names precede colliding legacy aliases; longest canonical span wins", async () => {
  const nexus = await create("Nexus");
  const ary = await create("Ary Nexus", "project");
  await repo.insert("entity_aliases", { alias: "nexus", entity_id: ary.id });
  expect((await service.resolveMentions("Nexus")).resolutions[0]).toMatchObject(
    { canonical_entity_id: nexus.id, method: "canonical" },
  );
  expect((await service.resolveEntities("Ary Nexus")).map((e) => e.id)).toEqual(
    [ary.id],
  );
  expect(
    (await service.resolveMentions("Ary Nexus and Nexus")).resolutions.map(
      (r) => r.canonical_entity_id,
    ),
  ).toEqual([ary.id, nexus.id]);
});
it("never merges similar companies or resolves misspellings by name similarity", async () => {
  const a = await create("Clevaryn");
  const b = await create("Clevaryn Labs");
  const c = await create("Cleveryn");
  expect(
    (await service.resolveEntities("Clevaryn Labs")).map((e) => e.id),
  ).toEqual([b.id]);
  expect((await service.resolveEntities("Cleveryn")).map((e) => e.id)).toEqual([
    c.id,
  ]);
  expect(await service.resolveEntities("Clevarynn")).toEqual([]);
  expect(
    (await service.resolveEntities("Clevaryn and Clevaryn Labs"))
      .map((e) => e.id)
      .sort(),
  ).toEqual([a.id, b.id].sort());
  expect(await repo.list("entities")).toHaveLength(3);
});
it("leaves ambiguous people names unresolved even if one candidate was created first", async () => {
  const a = await create("Alex Chen", "person");
  const b = await create("Alex Reed", "person");
  const result = await service.resolveMentions("What does Alex need?");
  expect(result.entities).toEqual([]);
  expect(result.resolutions[0]).toMatchObject({
    mention: "Alex",
    status: "ambiguous",
    canonical_entity_id: null,
    confidence: 0,
  });
  expect(result.resolutions[0].candidates.map((c) => c.id).sort()).toEqual(
    [a.id, b.id].sort(),
  );
  expect((await service.resolveEntities("Alex Chen")).map((e) => e.id)).toEqual(
    [a.id],
  );
});
it("uses explicit affiliation only when ambiguity needs it, and records relationship evidence", async () => {
  const a = await create("Alex Chen", "person");
  await create("Alex Reed", "person");
  const clev = await create("Clevaryn");
  const edge = await service.linkEntities({
    source_entity_id: a.id,
    target_entity_id: clev.id,
    relationship_type: "works_at",
  });
  const trace = (
    await service.resolveMentions("Ask Alex at Clevaryn about the deadline")
  ).resolutions[0];
  expect(trace).toMatchObject({
    method: "context",
    canonical_entity_id: a.id,
    confidence: 0.9,
    evidence_relationship_ids: [edge.id],
  });
  expect(
    (await service.resolveMentions("Ask Alex. Clevaryn has a deadline"))
      .resolutions[0].status,
  ).toBe("ambiguous");
  const list = vi.spyOn(repo, "list");
  await service.resolveMentions("Alex Chen");
  expect(list.mock.calls.some(([table]) => table === "relationships")).toBe(
    false,
  );
});
it("rejects expired, disabled, unrelated, or contradictory affiliation evidence", async () => {
  const a = await create("Alex Chen", "person");
  const b = await create("Alex Reed", "person");
  const clev = await create("Clevaryn");
  const edge = await service.linkEntities({
    source_entity_id: a.id,
    target_entity_id: clev.id,
    relationship_type: "works_at",
    valid_to: "2020-01-01T00:00:00Z",
  });
  expect(
    (await service.resolveMentions("Alex at Clevaryn")).resolutions[0].status,
  ).toBe("ambiguous");
  await repo.update("relationships", edge.id, { valid_to: null, strength: 0 });
  expect(
    (await service.resolveMentions("Alex at Clevaryn")).resolutions[0].status,
  ).toBe("ambiguous");
  await repo.update("relationships", edge.id, {
    strength: 1,
    relationship_type: "met",
  });
  expect(
    (await service.resolveMentions("Alex at Clevaryn")).resolutions[0].status,
  ).toBe("ambiguous");
  await repo.update("relationships", edge.id, {
    relationship_type: "works_at",
  });
  await service.linkEntities({
    source_entity_id: b.id,
    target_entity_id: clev.id,
    relationship_type: "works_at",
  });
  expect(
    (await service.resolveMentions("Alex at Clevaryn")).resolutions[0].status,
  ).toBe("ambiguous");
});
it("supports identical canonical people names without picking an arbitrary record", async () => {
  await create("Sam Lee", "person");
  await create("Sam Lee", "person");
  expect(await service.findEntity("Sam Lee")).toBeNull();
  expect((await service.resolveMentions("Sam Lee")).resolutions[0].status).toBe(
    "ambiguous",
  );
});
it("preserves token boundaries, normalizes case, and rejects alias reassignment", async () => {
  const wag = await create("Wag Trails", "project");
  const other = await create("Wag Trail Labs");
  await service.addAlias(wag.id, "Trailbook");
  await expect(service.addAlias(other.id, "TRAILBOOK")).rejects.toThrow(
    /another entity/,
  );
  expect(await service.resolveEntities("Trailbookish wagtrails")).toEqual([]);
  expect(
    (await service.resolveEntities("wag trails")).map((e) => e.id),
  ).toEqual([wag.id]);
});
it("scopes resolution to the tenant and does not use another user's aliases", async () => {
  const a = await create("Clevaryn");
  await service.addAlias(a.id, "Studio");
  const other = new EntityService(
    new LocalRepository(randomUUID(), join(dir, "data.json")),
  );
  expect(await other.resolveEntities("Clevaryn Studio")).toEqual([]);
});
it("streams and persists traces for both messages and withholds ambiguous linked memories", async () => {
  const alex = await create("Alex Chen", "person");
  await create("Alex Reed", "person");
  const memories = new MemoryService(repo, new LocalEmbeddingProvider());
  const fact = await memories.createMemory({ content: "Alex likes blue" });
  await memories.linkMemoryToEntity(fact.id, alex.id);
  let received: BrainContext | undefined;
  const model = new MockLanguageModel();
  const reason = vi.spyOn(model, "reason").mockImplementation(async (c) => {
    received = c;
    return "Which Alex do you mean?";
  });
  const brain = new AryBrainService(
    repo,
    memories,
    service,
    model,
    new ActionService(repo),
  );
  const events = [];
  for await (const event of brain.respond({ input: "What does Alex like?" }))
    events.push(event);
  expect(events[0].type).toBe("entities");
  expect(reason).toHaveBeenCalledOnce();
  expect(received?.memories).toEqual([]);
  expect(received?.entity_resolutions?.[0].status).toBe("ambiguous");
  const messages = await repo.list("messages");
  expect(messages).toHaveLength(2);
  for (const message of messages)
    expect(message.metadata.entity_resolutions).toMatchObject([
      { mention: "Alex", status: "ambiguous" },
    ]);
});

it("does not resolve through an affiliation supported only by an inactive memory", async () => {
  const alex = await create("Alex Chen", "person");
  await create("Alex Reed", "person");
  const company = await create("Clevaryn");
  const memories = new MemoryService(repo, new LocalEmbeddingProvider());
  const fact = await memories.createMemory({
    content: "Alex Chen works at Clevaryn",
  });
  await service.linkEntities({
    source_entity_id: alex.id,
    target_entity_id: company.id,
    relationship_type: "works_at",
    memory_id: fact.id,
  });
  await memories.archiveMemory(fact.id);
  expect(
    (await service.resolveMentions("Alex at Clevaryn")).resolutions[0].status,
  ).toBe("ambiguous");
});

it("searches aliases and resolves possessive affiliation context without merging identities", async () => {
  const company = await create("Clevaryn", "company");
  await service.addAlias(company.id, "Clevaryn Studio");
  expect((await service.searchEntities("Studio")).map((e) => e.id)).toContain(
    company.id,
  );
  const one = await create("Alex Chen", "person");
  const two = await create("Alex Rivera", "person");
  await service.linkEntities({
    source_entity_id: one.id,
    target_entity_id: company.id,
    relationship_type: "works_at",
  });
  const result = await service.resolveMentions(
    "What did Clevaryn’s Alex decide?",
  );
  const person = result.resolutions.find((r) => r.mention === "Alex")!;
  expect(person).toMatchObject({
    method: "context",
    canonical_entity_id: one.id,
  });
  expect(person.evidence_relationship_ids).toHaveLength(1);
  expect((await repo.get("entities", two.id))?.name).toBe("Alex Rivera");
});

it("resolves a complete alias before an unrelated shorter canonical substring", async () => {
  const short = await create("Atlas", "company");
  const target = await create("Bright Research", "company");
  await service.addAlias(target.id, "Atlas Research");
  const result = await service.resolveMentions(
    "Ask Atlas Research about the project",
  );
  expect(result.resolutions).toHaveLength(1);
  expect(result.resolutions[0]).toMatchObject({
    mention: "Atlas Research",
    method: "alias",
    canonical_entity_id: target.id,
  });
  expect(result.entities.some((e) => e.id === short.id)).toBe(false);
});
