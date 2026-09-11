import { beforeEach, afterEach, it, expect, vi } from "vitest";
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
import { ActionService } from "../src/services/action-service";
import { PermissionService } from "../src/services/permission-service";
import { BoardMeetingService } from "../src/services/board-meeting-service";
import { boardRoles, type BoardEvent } from "../src/domain/board";
import type {
  BrainContext,
  LanguageModelProvider,
  ReasoningResult,
} from "../src/domain/providers";
let dir: string,
  repo: LocalRepository,
  memories: MemoryService,
  model: LanguageModelProvider,
  service: BoardMeetingService;
const metrics = {
  input_tokens: 120,
  cached_input_tokens: 0,
  output_tokens: 60,
  latency_ms: 10,
  estimated_cost_usd: 0.001,
  retrieval_count: 0,
  pricing_version: "fixture",
};
function output(context: BrainContext): ReasoningResult {
  const role = boardRoles.find((r) => context.input.startsWith(`Act as ${r}`))!;
  const downstream = ["Analyst Ary", "CEO Ary"].includes(role);
  const prior = JSON.parse(
    context.input.split("\nPrior findings: ")[1].split("\nAnalyst order:")[0],
  );
  const order = JSON.parse(context.input.split("\nAnalyst order: ")[1]);
  const hasWork = context.input.includes('"key":"W1"');
  return {
    model: "fixture-model",
    provider: "fixture",
    metrics,
    content: JSON.stringify({
      summary: `${role} review`,
      findings:
        !downstream && hasWork
          ? [
              {
                observation: "Task delivery needs review",
                next_step: "Review the tracking fix",
                evidence: ["W1"],
                confidence: 0.7,
              },
            ]
          : [],
      order:
        role === "Analyst Ary" ? prior.map((f: { id: string }) => f.id) : [],
      plan:
        role === "CEO Ary"
          ? order.slice(0, 2).map((id: string) => ({
              finding_id: id,
              next_step: "Review the tracking fix",
            }))
          : [],
    }),
  };
}
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ary-board-"));
  repo = new LocalRepository(randomUUID(), join(dir, "db.json"));
  memories = new MemoryService(repo, new LocalEmbeddingProvider());
  model = {
    name: "fixture",
    identifyIntent: async () => "board",
    reason: async () => "",
    extractMemories: vi.fn(async () => []),
    reasonWithUsage: vi.fn(async (c) => output(c)),
  };
  service = new BoardMeetingService(
    repo,
    memories,
    model,
    new ActionService(repo),
  );
  await repo.insert("tasks", {
    title: "Fix Wag Trails tracking",
    description: "",
    entity_id: null,
    goal_id: null,
    status: "pending",
    priority: 3,
    due_at: null,
    metadata: {},
  });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});
const run = (
  emit?: (event: BoardEvent) => void,
  signal?: AbortSignal,
  key = randomUUID(),
) => service.run({ request_key: key, focus: "Tracking" }, emit, signal);
it("six roles share central evidence; Analyst precedes CEO; one atomic advisory conversation", async () => {
  const events: BoardEvent[] = [];
  const before = await repo.list("tasks");
  const report = await run((e) => events.push(e));
  expect(report.status).toBe("complete");
  expect(report.roles.map((r) => r.role)).toEqual([...boardRoles]);
  expect(report.plan).toHaveLength(2);
  const calls = vi.mocked(model.reasonWithUsage!).mock.calls;
  expect(calls).toHaveLength(6);
  const snapshots = calls.map(
    ([c]) =>
      c.input.split("\nShared evidence: ")[1].split("\nPrior findings:")[0],
  );
  expect(new Set(snapshots).size).toBe(1);
  expect(
    calls.every(
      ([c]) =>
        c.input.length <= 9900 &&
        c.memories.length <= 4 &&
        c.entities.length <= 12,
    ),
  ).toBe(true);
  expect(calls[4][0].input).toContain("Act as Analyst Ary");
  expect(calls[5][0].input).toContain("Act as CEO Ary");
  expect(await repo.list("tasks")).toEqual(before);
  expect(await repo.list("memories")).toEqual([]);
  expect(model.extractMemories).not.toHaveBeenCalled();
  expect(await repo.list("conversations")).toHaveLength(1);
  const messages = await repo.list("messages");
  expect(messages).toHaveLength(1);
  expect(messages[0].metadata.confirmed_fact).toBe(false);
  expect(events.at(-1)?.type).toBe("complete");
  expect((await service.history())[0].id).toBe(report.id);
  const action = (await repo.list("actions")).find(
    (a) => a.tool_name === "board.meet",
  )!;
  expect(action.status).toBe("succeeded");
  expect(action.output.report).toEqual(report);
  expect(
    (await repo.list("outcomes")).find((o) => o.action_id === action.id)
      ?.status,
  ).toBe("success");
});
it.each([
  "board.meet",
  "memory.read",
  "entity.read",
  "activity.read",
  "roi.read",
  "conversation.read",
])("denied %s prevents all evidence reads and model calls", async (tool) => {
  await new PermissionService(repo).savePolicy({
    tool,
    level: 0,
    reason: "Test boundary",
  });
  const list = vi.spyOn(repo, "list");
  await expect(run()).rejects.toThrow(/not permitted/);
  expect(model.reasonWithUsage).not.toHaveBeenCalled();
  expect(
    list.mock.calls.some(([table]) =>
      ["tasks", "goals", "memories", "entities", "relationships"].includes(
        table,
      ),
    ),
  ).toBe(false);
});
it("idempotent repeat returns the saved brief without more role calls", async () => {
  const key = randomUUID();
  const a = await run(undefined, undefined, key),
    b = await run(undefined, undefined, key);
  expect(a).toEqual(b);
  expect(model.reasonWithUsage).toHaveBeenCalledTimes(6);
  expect(await repo.list("conversations")).toHaveLength(1);
  await expect(
    service.run({ request_key: key, focus: "Different" }),
  ).rejects.toThrow(/different inputs/);
});
it("forged evidence is rejected and never contributes to the plan", async () => {
  vi.mocked(model.reasonWithUsage!).mockImplementation(async (c) => {
    const r = output(c);
    if (c.input.startsWith("Act as Sales Ary")) {
      const p = JSON.parse(r.content);
      p.findings[0].evidence = ["INVENTED"];
      r.content = JSON.stringify(p);
    }
    return r;
  });
  const report = await run();
  expect(report.status).toBe("partial");
  expect(report.roles[0].status).toBe("failed");
  expect(report.ranked_findings).not.toContain("0-1");
  expect(report.evidence.every((e) => e.key !== "INVENTED")).toBe(true);
});
it("invalid ranking skips CEO; no fallback plan is invented", async () => {
  vi.mocked(model.reasonWithUsage!).mockImplementation(async (c) => {
    const r = output(c);
    if (c.input.startsWith("Act as Analyst Ary"))
      r.content = JSON.stringify({
        summary: "rank",
        findings: [],
        order: ["forged"],
        plan: [],
      });
    return r;
  });
  const report = await run();
  expect(report.plan).toEqual([]);
  expect(report.roles[5].status).toBe("failed");
  expect(model.reasonWithUsage).toHaveBeenCalledTimes(5);
});
it("a model failure produces a clearly partial saved meeting", async () => {
  vi.mocked(model.reasonWithUsage!).mockRejectedValueOnce(
    new Error("Provider unavailable"),
  );
  const report = await run();
  expect(report.status).toBe("partial");
  expect(report.roles[0].findings).toEqual([]);
  expect(report.roles[0].metrics).toBeNull();
});
it("abort prevents persistence and logs failure", async () => {
  const abort = new AbortController();
  vi.mocked(model.reasonWithUsage!).mockImplementation(async (c) => {
    abort.abort();
    return output(c);
  });
  await expect(run(undefined, abort.signal)).rejects.toThrow();
  expect(await repo.list("conversations")).toEqual([]);
  expect(
    (await repo.list("actions")).find((a) => a.tool_name === "board.meet")
      ?.status,
  ).toBe("failed");
});
it("failure at atomic save leaves no meeting and no success outcome", async () => {
  const batch = repo.batch.bind(repo);
  vi.spyOn(repo, "batch").mockImplementation(async (changes) => {
    if (changes.some((m) => m.kind === "insert" && m.table === "messages"))
      throw new Error("Transient database error");
    return batch(changes);
  });
  await expect(run()).rejects.toThrow("Transient database error");
  expect(await repo.list("conversations")).toEqual([]);
  expect(await repo.list("messages")).toEqual([]);
  const action = (await repo.list("actions")).find(
    (a) => a.tool_name === "board.meet",
  )!;
  expect(action.status).toBe("failed");
  expect(
    (await repo.list("outcomes")).find((o) => o.action_id === action.id)
      ?.status,
  ).toBe("failure");
  vi.restoreAllMocks();
  expect((await run()).status).toBe("complete");
});
it("stub fails explicitly rather than claiming six real reviews", async () => {
  service = new BoardMeetingService(
    repo,
    memories,
    new MockLanguageModel(),
    new ActionService(repo),
  );
  await expect(run()).rejects.toThrow(/development stub/);
  expect(await repo.list("messages")).toEqual([]);
});
it("empty workspace yields no fabricated business impact", async () => {
  repo = new LocalRepository(randomUUID(), join(dir, "empty.json"));
  service = new BoardMeetingService(
    repo,
    new MemoryService(repo, new LocalEmbeddingProvider()),
    model,
    new ActionService(repo),
  );
  const report = await run();
  expect(report.evidence).toEqual([]);
  expect(report.plan).toEqual([]);
  expect(report.roles.every((r) => !r.findings.length)).toBe(true);
});
it("other users cannot read a saved meeting", async () => {
  await run();
  const other = new LocalRepository(randomUUID(), join(dir, "db.json"));
  const s = new BoardMeetingService(
    other,
    memories,
    model,
    new ActionService(other),
  );
  expect(await s.history()).toEqual([]);
});
it("cancellation at the save boundary prevents committing the brief", async () => {
  const abort = new AbortController();
  await expect(
    run((e) => {
      if (e.type === "stage" && e.stage === "Saving the shared brief")
        abort.abort();
    }, abort.signal),
  ).rejects.toThrow();
  expect(await repo.list("conversations")).toEqual([]);
});
it("active goals remain shared when tasks fill the leading work slots", async () => {
  for (let i = 0; i < 7; i++)
    await repo.insert("tasks", {
      title: `Urgent work ${i}`,
      description: "",
      entity_id: null,
      goal_id: null,
      status: "pending",
      priority: 3,
      due_at: "2026-01-01T00:00:00Z",
      metadata: {},
    });
  const goal = await repo.insert("goals", {
    title: "Central goal",
    description: "Existing shared goal",
    entity_id: null,
    status: "active",
    progress: 0,
    target_date: null,
    metadata: {},
  });
  const report = await run();
  expect(report.evidence.find((e) => e.id === goal.id)?.key).toMatch(/^G/);
});
it("an unrecognized CEO plan is rejected without losing specialist evidence", async () => {
  vi.mocked(model.reasonWithUsage!).mockImplementation(async (c) => {
    const r = output(c);
    if (c.input.startsWith("Act as CEO Ary")) {
      const p = JSON.parse(r.content);
      p.plan = [{ finding_id: "forged", next_step: "Invented task" }];
      r.content = JSON.stringify(p);
    }
    return r;
  });
  const report = await run();
  expect(report.plan).toEqual([]);
  expect(report.roles[5].status).toBe("failed");
  expect(report.roles[5].model).toBe("fixture-model");
  expect(report.roles[5].metrics).toEqual(metrics);
  expect(report.roles[5].error).toContain("Analyst-ranked");
});
