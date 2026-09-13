import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalRepository } from "../src/infrastructure/repositories/local";
import { AryBrainService } from "../src/services/ary-brain-service";
import { MemoryService } from "../src/services/memory-service";
import { EntityService } from "../src/services/entity-service";
import { ActionService } from "../src/services/action-service";
import {
  LocalEmbeddingProvider,
  MockLanguageModel,
} from "../src/infrastructure/providers/local";
let directory: string;
let repo: LocalRepository;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "ary-sound-check-"));
  repo = new LocalRepository(
    crypto.randomUUID(),
    join(directory, "fixture.json"),
  );
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});
it.each([
  ["Ary, can you hear me? Answer briefly.", "voice", false],
  ["Hello, Ary, can you hear me?", "voice", false],
  ["Can you hear me?", "text", true],
  ["Can you hear me and create a task?", "voice", true],
  ["Which tools can you use?", "voice", true],
] as const)(
  "keeps canonical Brain and chooses discovery correctly for %s (%s)",
  async (input, modality, discover) => {
    const discovery = vi.fn(async () => []);
    const memory = new MemoryService(repo, new LocalEmbeddingProvider());
    const retrieval = vi.spyOn(memory, "getRelevantMemories");
    const llm = new MockLanguageModel();
    const reason = vi.spyOn(llm, "reason");
    const brain = new AryBrainService(
      repo,
      memory,
      new EntityService(repo),
      llm,
      new ActionService(repo),
      undefined,
      undefined,
      undefined,
      discovery,
    );
    const events = [];
    for await (const event of brain.respond({ input, modality }))
      events.push(event);
    expect(discovery).toHaveBeenCalledTimes(discover ? 1 : 0);
    expect(retrieval).toHaveBeenCalledTimes(2); // Response context + existing extraction reconciliation.
    expect(reason).toHaveBeenCalledOnce();
    expect(reason.mock.calls[0][0].response_style).toBe(
      modality === "voice" ? "spoken" : undefined,
    );
    expect(events.some((e) => e.type === "response")).toBe(true);
    expect(events.at(-1)?.type).toBe("complete");
    expect((await repo.list("messages")).map((m) => m.role)).toEqual([
      "user",
      "assistant",
    ]);
  },
);

it("starts capability lookup while memory retrieval is pending and waits for both", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const memory = new MemoryService(repo, new LocalEmbeddingProvider());
  vi.spyOn(memory, "getRelevantMemories").mockImplementation(async () => {
    await gate;
    return [];
  });
  const discovery = vi.fn(async () => []);
  const llm = new MockLanguageModel();
  const reason = vi.spyOn(llm, "reason");
  const brain = new AryBrainService(
    repo,
    memory,
    new EntityService(repo),
    llm,
    new ActionService(repo),
    undefined,
    undefined,
    undefined,
    discovery,
  );
  const work = (async () => {
    for await (const _event of brain.respond({
      input: "Which tools can you use?",
      modality: "voice",
    })) {
    }
  })();
  try {
    await vi.waitFor(() => expect(discovery).toHaveBeenCalledOnce());
    expect(reason).not.toHaveBeenCalled();
  } finally {
    release();
  }
  await work;
  expect(reason).toHaveBeenCalledOnce();
});
it("reports response failure before running extraction while preserving the extraction job", async () => {
  const memory = new MemoryService(repo, new LocalEmbeddingProvider());
  const llm = new MockLanguageModel();
  vi.spyOn(llm, "reason").mockRejectedValue(Error("provider failure"));
  const extract = vi.spyOn(llm, "extractMemories");
  const brain = new AryBrainService(
    repo,
    memory,
    new EntityService(repo),
    llm,
    new ActionService(repo),
  );
  const turn = brain.respond({ input: "Hello Ary", modality: "voice" });
  expect((await turn.next()).value?.type).toBe("entities");
  expect((await turn.next()).value?.type).toBe("error");
  expect(extract).not.toHaveBeenCalled();
  for await (const _event of turn) {
  }
  expect(extract).toHaveBeenCalledOnce();
  expect(await repo.list("extraction_jobs")).toHaveLength(1);
});
