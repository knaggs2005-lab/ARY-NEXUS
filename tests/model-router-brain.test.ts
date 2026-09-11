import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { missionFixture } from "../scripts/lib/mission-fixture";
import {
  AryBrainService,
  type BrainEvent,
} from "../src/services/ary-brain-service";
import { MemoryService } from "../src/services/memory-service";
import { ModelRouter, modelHealth } from "../src/services/model-router";
import { LocalEmbeddingProvider } from "../src/infrastructure/providers/local";
import { guardedEmbeddings } from "../src/infrastructure/providers/model-router-config";
let dir: string, f: ReturnType<typeof missionFixture>;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ary-router-brain-"));
  f = missionFixture(join(dir, "data.json"), randomUUID());
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  modelHealth.clear();
  await rm(dir, { recursive: true, force: true });
});
it("cloud outage preserves lexical recall, honest response attribution and a retryable extraction job", async () => {
  const memory = await f.memories.createMemory({
    content: "Clevaryn has a Friday deadline",
    summary: "Clevaryn Friday deadline",
    source_message_id: null,
  });
  const before = await f.repo.get("memories", memory.id);
  const local = new LocalEmbeddingProvider();
  const embeddings = {
    modelId: local.modelId,
    version: local.version,
    dimensions: 384,
    embed: vi.fn(async () => {
      throw new Error("cloud disconnected");
    }),
  };
  const memories = new MemoryService(f.repo, embeddings),
    router = new ModelRouter([]);
  const brain = new AryBrainService(
    f.repo,
    memories,
    f.entities,
    router,
    f.actions,
  );
  const events: BrainEvent[] = [];
  for await (const e of brain.respond({ input: "Clevaryn Friday deadline" }))
    events.push(e);
  const response = events.find((e) => e.type === "response");
  expect(response?.type).toBe("response");
  if (response?.type !== "response") return;
  expect(response.message.content).toContain("Clevaryn has a Friday deadline");
  expect(response.message.metadata.provider_id).toBe("local-evidence");
  expect(response.message.metadata.retrieval_mode).toBe("lexical_graph_only");
  expect((await f.repo.list("extraction_jobs"))[0].status).toBe("failed");
  const after = await f.repo.get("memories", memory.id);
  expect(after?.embedding).toEqual(before?.embedding);
  expect(after?.embedding_model).toBe(before?.embedding_model);
  expect(await f.repo.list("memories")).toHaveLength(1);
  expect(events.some((e) => e.type === "complete")).toBe(true);
});
it("embedding degradation does not swallow database errors", async () => {
  const local = new LocalEmbeddingProvider();
  vi.spyOn(local, "embed").mockRejectedValue(new Error("offline"));
  vi.spyOn(f.repo, "search").mockRejectedValue(
    new Error("Database unavailable"),
  );
  await expect(
    new MemoryService(f.repo, local).searchMemories("private context"),
  ).rejects.toThrow("Database unavailable");
});
it("new embeddings never silently use local vectors after cloud failure", async () => {
  const local = new LocalEmbeddingProvider();
  vi.spyOn(local, "embed").mockRejectedValue(new Error("offline"));
  const service = new MemoryService(f.repo, local);
  await expect(
    service.createMemory({
      content: "Do not fabricate vectors",
      source_message_id: null,
    }),
  ).rejects.toThrow();
  expect(await f.repo.list("memories")).toHaveLength(0);
});
it("a task-specific local privacy policy also protects shared embedding calls", async () => {
  vi.stubEnv("ARY_MODEL_ROUTER_TASKS", '{"chat":{"privacy":"local_only"}}');
  const local = new LocalEmbeddingProvider(),
    spy = vi.spyOn(local, "embed");
  await expect(
    guardedEmbeddings(local, false).embed("private context"),
  ).rejects.toThrow(/blocked/);
  expect(spy).not.toHaveBeenCalled();
});
