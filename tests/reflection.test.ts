import { afterEach, beforeEach, expect, it, vi } from "vitest";
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
import { ReflectionService } from "../src/services/reflection-service";
import { EntityService } from "../src/services/entity-service";
import { AryBrainService } from "../src/services/ary-brain-service";
import { ActionService } from "../src/services/action-service";
let dir: string,
  repo: LocalRepository,
  memory: MemoryService,
  reflection: ReflectionService;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ary-reflection-"));
  repo = new LocalRepository(randomUUID(), join(dir, "db.json"));
  memory = new MemoryService(repo, new LocalEmbeddingProvider());
  reflection = new ReflectionService(repo, memory);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});
async function fixture() {
  const conversation = await repo.insert("conversations", {
    title: "Reflection fixture",
    metadata: {},
  });
  const source = await repo.insert("messages", {
    conversation_id: conversation.id,
    role: "user",
    content: "Remember: confirmed release date is October 1.",
    metadata: {},
  });
  const fact = await memory.createMemory({
    content: "Confirmed release date is October 1.",
    source_message_id: source.id,
    importance_score: 0.5,
    confidence_score: 1,
    metadata: { confirmed: true },
  });
  return { conversation, source, fact };
}
async function proposals(sourceId: string) {
  const job = await reflection.enqueue(sourceId);
  await reflection.runJob(job.id);
  return repo.list("reflection_proposals");
}
async function taskFixture() {
  const f = await fixture();
  const goal = await repo.insert("goals", {
    entity_id: null,
    title: "Reliable releases",
    description: "",
    status: "active",
    progress: 0,
    target_date: null,
    metadata: {},
  });
  const task = await repo.insert("tasks", {
    entity_id: null,
    goal_id: goal.id,
    title: "Check recall",
    description: "",
    status: "completed",
    priority: 2,
    due_at: null,
    metadata: {},
  });
  const action = await repo.insert("actions", {
    conversation_id: f.conversation.id,
    tool_name: "test.recall",
    action_type: "internal",
    permission_level: 1,
    status: "succeeded",
    input: { task_id: task.id },
    output: {},
    error: null,
    metadata: {},
  });
  const outcome = await repo.insert("outcomes", {
    action_id: action.id,
    goal_id: null,
    status: "success",
    summary: "Paraphrase recall passed the fixture checks",
    metrics: {},
    metadata: {},
  });
  return { ...f, goal, task, action, outcome };
}
it("queues reflection after extraction without applying anything or delaying the answer for reflection", async () => {
  const brain = new AryBrainService(
    repo,
    memory,
    new EntityService(repo),
    new MockLanguageModel(),
    new ActionService(repo),
    reflection,
  );
  const stream = brain.respond({
    input: "Remember: release checks require evidence.",
  });
  await stream.next();
  expect((await stream.next()).value?.type).toBe("response");
  expect(await repo.list("reflection_jobs")).toHaveLength(0);
  expect((await stream.next()).value?.type).toBe("complete");
  const jobs = await repo.list("reflection_jobs");
  expect(jobs).toHaveLength(1);
  expect(jobs[0].status).toBe("pending");
  expect(await repo.list("reflection_proposals")).toHaveLength(0);
  await reflection.drain();
  expect((await repo.get("reflection_jobs", jobs[0].id))?.status).toBe(
    "completed",
  );
  expect((await repo.list("reflection_proposals"))[0].status).toBe("pending");
});
it("proposes all five change types, records conflicts/decisions/patterns, and makes no silent fact edits", async () => {
  const f = await taskFixture();
  for (let i = 0; i < 3; i++) {
    const message = await repo.insert("messages", {
      conversation_id: f.conversation.id,
      role: "user",
      content: f.fact.content,
      metadata: {},
    });
    await repo.insert("memory_evidence", {
      memory_id: f.fact.id,
      source_message_id: message.id,
      quote: f.fact.content,
      evidence_type: "supports",
    });
  }
  await repo.insert("decisions", {
    entity_id: null,
    goal_id: f.goal.id,
    title: "Use controlled fixtures",
    rationale: "Reproducible results",
    status: "accepted",
    confidence_score: 1,
    decided_at: new Date().toISOString(),
    metadata: {},
  });
  const old = await memory.createMemory({
    content: "The relationship used to be active",
    source_message_id: f.source.id,
  });
  await repo.update("memories", old.id, { status: "superseded" });
  await repo.insert("memory_conflicts", {
    existing_memory_id: old.id,
    candidate_memory_id: f.fact.id,
    reason: "User corrected prior knowledge",
    status: "replaced",
  });
  const candidate = await memory.createMemory({
    content: "Release may move to November",
    source_message_id: f.source.id,
  });
  await repo.update("memories", candidate.id, { status: "disputed" });
  await repo.insert("memory_conflicts", {
    existing_memory_id: f.fact.id,
    candidate_memory_id: candidate.id,
    reason: "Unresolved date",
    status: "pending",
  });
  const entities = new EntityService(repo);
  const a = await entities.createEntity({
    name: "Ary Nexus",
    entity_type: "project",
  });
  const b = await entities.createEntity({
    name: "Clevaryn",
    entity_type: "company",
  });
  await entities.linkEntities({
    source_entity_id: a.id,
    target_entity_id: b.id,
    relationship_type: "tracks",
    memory_id: old.id,
  });
  const p = await proposals(f.source.id);
  expect(new Set(p.map((x) => x.kind))).toEqual(
    new Set([
      "memory_update",
      "relationship_update",
      "lesson_learned",
      "outcome_link",
      "importance_adjustment",
    ]),
  );
  expect(p.every((x) => x.status === "pending" && x.evidence.length > 0)).toBe(
    true,
  );
  expect(await repo.get("memories", f.fact.id)).toEqual(f.fact);
  const job = (await repo.list("reflection_jobs"))[0];
  expect(job.observations.map((o) => o.category)).toEqual(
    expect.arrayContaining([
      "memory",
      "correction",
      "unresolved_conflict",
      "decision",
      "completed_task",
      "outcome",
      "pattern",
    ]),
  );
  await reflection.runJob(job.id);
  expect(await repo.list("reflection_proposals")).toHaveLength(p.length);
});
it("accepts summary updates with evidence/history and leaves confirmed fact content unchanged", async () => {
  const f = await fixture();
  const p = (await proposals(f.source.id))[0];
  await reflection.review(
    p.id,
    "accepted",
    "Literal summary matches the confirmed fact.",
  );
  const changed = await repo.get("memories", f.fact.id);
  expect(changed?.content).toBe(f.fact.content);
  expect(changed?.confidence_score).toBe(1);
  expect(changed?.summary).toBe(f.fact.content);
  expect(changed?.embedding_input_hash).not.toBe(f.fact.embedding_input_hash);
  const versions = await repo.list("memory_versions", { record_id: f.fact.id });
  expect(versions).toHaveLength(2);
  expect(versions[0].snapshot.summary).toBe("");
  const reviewed = await repo.get("reflection_proposals", p.id);
  expect(reviewed?.applied_changes).toHaveLength(1);
  expect(reviewed?.reviewed_by).toBe(repo.userId);
  await reflection.review(p.id, "accepted", "Retry same decision");
  expect(
    await repo.list("memory_versions", { record_id: f.fact.id }),
  ).toHaveLength(2);
  await expect(
    reflection.review(p.id, "rejected", "Change my mind"),
  ).rejects.toThrow("already reviewed");
});
it("rejects without modifying knowledge and records an immutable reason", async () => {
  const f = await fixture();
  const p = (await proposals(f.source.id))[0];
  await reflection.review(p.id, "rejected", "A summary is unnecessary here.");
  expect(await repo.get("memories", f.fact.id)).toEqual(f.fact);
  expect((await repo.get("reflection_proposals", p.id))?.review_reason).toBe(
    "A summary is unnecessary here.",
  );
  await expect(
    repo.update("reflection_proposals", p.id, { reason: "Rewrite audit" }),
  ).rejects.toThrow("immutable");
  await expect(reflection.review(p.id, "accepted", "Later")).rejects.toThrow();
});
it("rejects stale evidence atomically, but ignores harmless access timestamps", async () => {
  const f = await fixture();
  const p = (await proposals(f.source.id))[0];
  await memory.updateMemory(f.fact.id, {
    content: "Confirmed release date is November 20.",
  });
  await expect(
    reflection.review(p.id, "accepted", "Old review"),
  ).rejects.toThrow("Evidence changed");
  expect((await repo.get("reflection_proposals", p.id))?.status).toBe(
    "pending",
  );
  expect((await repo.get("memories", f.fact.id))?.summary).toBe("");
  await reflection.review(p.id, "rejected", "Newer user correction wins.");
  const next = await repo.insert("messages", {
    conversation_id: f.conversation.id,
    role: "user",
    content: "Please inspect the updated release date",
    metadata: {},
  });
  const nextP = (await proposals(next.id)).find((p) => p.status === "pending")!;
  await repo.update("memories", f.fact.id, {
    last_accessed_at: new Date().toISOString(),
  });
  await reflection.review(nextP.id, "accepted", "Reviewed current text");
});
it("records outcome-link versions and applies a lesson exactly once with source evidence", async () => {
  const f = await taskFixture();
  const p = await proposals(f.source.id);
  const link = p.find((x) => x.kind === "outcome_link")!;
  await reflection.review(
    link.id,
    "accepted",
    "Task explicitly belongs to this goal.",
  );
  expect((await repo.get("outcomes", f.outcome.id))?.goal_id).toBe(f.goal.id);
  expect(
    await repo.list("outcome_versions", { record_id: f.outcome.id }),
  ).toHaveLength(2);
  // The link changed lesson evidence. Old lessons must be re-proposed rather than silently accepted.
  const old = p.find((x) => x.kind === "lesson_learned")!;
  await expect(reflection.review(old.id, "accepted", "Stale")).rejects.toThrow(
    "Evidence changed",
  );
  await reflection.review(
    old.id,
    "rejected",
    "Outcome gained its goal link; refresh evidence.",
  );
  const source = await repo.insert("messages", {
    conversation_id: f.conversation.id,
    role: "user",
    content: "Review the linked outcome",
    metadata: {},
  });
  const lesson = (await proposals(source.id)).find(
    (x) => x.kind === "lesson_learned" && x.status === "pending",
  )!;
  await reflection.review(lesson.id, "accepted", "Keep this observed result.");
  await reflection.review(lesson.id, "accepted", "Retry");
  const lessons = (await repo.list("memories")).filter(
    (m) => m.metadata.reflection_proposal_id === lesson.id,
  );
  expect(lessons).toHaveLength(1);
  expect(lessons[0].memory_type).toBe("procedural");
  expect(lessons[0].metadata.evidence).toHaveLength(3);
});
it("waits for extraction, rejects concurrent claims, and recovers an expired lease", async () => {
  const f = await fixture();
  const extraction = await repo.insert("extraction_jobs", {
    source_message_id: f.source.id,
    status: "failed",
    attempts: 1,
    lease_until: null,
    error: "fixture",
    saved_memory_ids: [],
  });
  const job = await reflection.enqueue(f.source.id);
  await expect(reflection.runJob(job.id)).rejects.toThrow("extraction");
  expect((await repo.get("reflection_jobs", job.id))?.error).toContain(
    "Waiting",
  );
  await repo.update("extraction_jobs", extraction.id, { status: "completed" });
  await repo.update("reflection_jobs", job.id, {
    status: "running",
    lease_until: new Date(Date.now() + 60000).toISOString(),
    attempts: 1,
  });
  await expect(reflection.runJob(job.id)).rejects.toThrow("already running");
  await repo.update("reflection_jobs", job.id, {
    lease_until: "2000-01-01T00:00:00Z",
  });
  await reflection.drain();
  expect((await repo.get("reflection_jobs", job.id))?.status).toBe("completed");
});
it("enforces tenant ownership and does not accept review without a reason", async () => {
  const f = await fixture();
  const p = (await proposals(f.source.id))[0];
  const foreign = new ReflectionService(
    new LocalRepository(randomUUID(), join(dir, "db.json")),
    memory,
  );
  await expect(foreign.enqueue(f.source.id)).rejects.toThrow("not found");
  await expect(foreign.review(p.id, "accepted", "Wrong user")).rejects.toThrow(
    "not found",
  );
  await expect(reflection.review(p.id, "accepted", " ")).rejects.toThrow(
    "reason",
  );
});
it("applies reviewed importance and relationship changes without changing confidence or deleting history", async () => {
  const f = await fixture();
  for (let i = 0; i < 3; i++) {
    const m = await repo.insert("messages", {
      conversation_id: f.conversation.id,
      role: "user",
      content: f.fact.content,
      metadata: {},
    });
    await repo.insert("memory_evidence", {
      memory_id: f.fact.id,
      source_message_id: m.id,
      quote: m.content,
      evidence_type: "supports",
    });
  }
  const entities = new EntityService(repo);
  const a = await entities.createEntity({
      name: "Ary Nexus",
      entity_type: "project",
    }),
    b = await entities.createEntity({
      name: "Wag Trails",
      entity_type: "project",
    });
  const backing = await memory.createMemory({
    content: "Old support",
    source_message_id: f.source.id,
  });
  const edge = await entities.linkEntities({
    source_entity_id: a.id,
    target_entity_id: b.id,
    relationship_type: "tracks",
    memory_id: backing.id,
  });
  await repo.update("memories", backing.id, { status: "superseded" });
  const p = await proposals(f.source.id);
  await reflection.review(
    p.find((x) => x.kind === "importance_adjustment")!.id,
    "accepted",
    "Repeated mentions make this useful.",
  );
  expect((await repo.get("memories", f.fact.id))?.importance_score).toBe(0.6);
  expect((await repo.get("memories", f.fact.id))?.confidence_score).toBe(1);
  await reflection.review(
    p.find((x) => x.kind === "relationship_update")!.id,
    "accepted",
    "Its support was superseded.",
  );
  expect((await repo.get("relationships", edge.id))?.strength).toBe(0);
  expect(
    await repo.list("relationship_versions", { record_id: edge.id }),
  ).toHaveLength(2);
});
it("records worker failure without partial proposals and retries safely", async () => {
  const f = await fixture();
  const job = await reflection.enqueue(f.source.id);
  const original = repo.batch.bind(repo);
  const failure = vi
    .spyOn(repo, "batch")
    .mockImplementation(async (mutations) => {
      if (
        mutations.some(
          (m) => m.kind === "insert" && m.table === "reflection_proposals",
        )
      )
        throw new Error("Commit unavailable");
      return original(mutations);
    });
  await expect(reflection.runJob(job.id)).rejects.toThrow("Commit unavailable");
  expect(await repo.list("reflection_proposals")).toHaveLength(0);
  expect((await repo.get("reflection_jobs", job.id))?.status).toBe("failed");
  failure.mockRestore();
  await reflection.runJob(job.id);
  expect(await repo.list("reflection_proposals")).toHaveLength(1);
  expect((await repo.get("reflection_jobs", job.id))?.attempts).toBe(2);
});
