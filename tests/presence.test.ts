import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  PresenceStore,
  presenceOperation,
  presenceStore,
} from "../src/components/presence/store";
import { appearance } from "../src/components/presence/appearance";
import { presencePriority, type PresenceEvent } from "../src/domain/presence";
import { presenceTelemetry } from "../src/services/presence-telemetry";
import { presenceResponse } from "../src/server/presence-stream";
import { ActionService } from "../src/services/action-service";
import { LocalRepository } from "../src/infrastructure/repositories/local";
import { MemoryService } from "../src/services/memory-service";
import { EntityService } from "../src/services/entity-service";
import { AryBrainService } from "../src/services/ary-brain-service";
import {
  MockLanguageModel,
  LocalEmbeddingProvider,
} from "../src/infrastructure/providers/local";
afterEach(() => vi.useRealTimers());
it("keeps concurrent operations independent, with approvals above background processing", () => {
  const store = new PresenceStore();
  store.set("a", { operation: "a", state: "thinking", label: "Thinking" });
  store.set("b", { operation: "b", state: "approval", label: "Review" });
  expect(store.read().state).toBe("approval");
  store.clear("b");
  expect(store.read().state).toBe("thinking");
  store.clear("a");
  expect(store.read().state).toBe("idle");
});
it("ignores late events after cancellation and expires only its own receipt", () => {
  vi.useFakeTimers();
  const a = presenceOperation("request A"),
    b = presenceOperation("request B");
  b.update({ operation: "b", state: "acting", label: "B" });
  a.finish("waiting", "Interrupted");
  a.update({ operation: "a", state: "error", label: "Late error" });
  expect(presenceStore.read().label).toBe("B");
  vi.advanceTimersByTime(3000);
  expect(presenceStore.read().label).toBe("B");
  b.finish();
  vi.advanceTimersByTime(3000);
  expect(presenceStore.read().state).toBe("idle");
});
it("provides deterministic, static idle/approval/error/complete morphology", () => {
  for (const state of Object.keys(presencePriority) as PresenceEvent["state"][])
    expect(appearance(state)).toEqual(appearance(state));
  for (const state of [
    "idle",
    "approval",
    "error",
    "complete",
    "waiting",
  ] as const)
    expect(appearance(state).moving).toBe(false);
  expect(appearance("thinking").fold).not.toEqual(
    appearance("retrieving").fold,
  );
});
async function fixture(
  fn: (repo: LocalRepository, actions: ActionService) => Promise<void>,
) {
  const dir = await mkdtemp(join(tmpdir(), "ary-presence-test-"));
  try {
    const repo = new LocalRepository(randomUUID(), join(dir, "data.json"));
    await fn(repo, new ActionService(repo));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
it("emits execution only after permission and emits completion after committed outcome", async () =>
  fixture(async (repo, actions) => {
    const events: PresenceEvent[] = [];
    await presenceTelemetry.run(
      (e) => events.push(e),
      () =>
        actions.run("memory.read", null, async () => {
          expect(events.at(-1)?.state).toBe("acting");
          return { done: true };
        }),
    );
    expect(events.map((e) => e.state)).toEqual(["acting", "complete"]);
    expect((await repo.list("outcomes"))[0].status).toBe("success");
  }));
it("blocked actions do not emit an executing state", async () =>
  fixture(async (_repo, actions) => {
    const events: PresenceEvent[] = [],
      execute = vi.fn();
    await expect(
      presenceTelemetry.run(
        (e) => events.push(e),
        () => actions.run("unknown.tool", null, execute),
      ),
    ).rejects.toThrow();
    expect(execute).not.toHaveBeenCalled();
    expect(events.map((e) => e.state)).toEqual(["error"]);
  }));
it("an action failure never produces a successful completion event", async () =>
  fixture(async (_repo, actions) => {
    const events: PresenceEvent[] = [];
    await expect(
      presenceTelemetry.run(
        (e) => events.push(e),
        () =>
          actions.run("memory.read", null, async () => {
            throw Error("test");
          }),
      ),
    ).rejects.toThrow();
    expect(events.map((e) => e.state)).toEqual(["acting", "error"]);
  }));
it("a broken visual subscriber cannot change execution or audit", async () =>
  fixture(async (repo, actions) => {
    await presenceTelemetry.run(
      () => {
        throw Error("display failed");
      },
      () => actions.run("memory.read", null, async () => 42),
    );
    expect((await repo.list("actions"))[0].status).toBe("succeeded");
  }));
it("isolates concurrent request subscribers without a global event bus", async () => {
  const a: PresenceEvent[] = [],
    b: PresenceEvent[] = [];
  await Promise.all([
    presenceTelemetry.run(
      (e) => a.push(e),
      async () => {
        await Promise.resolve();
        presenceTelemetry.getStore()?.({
          operation: "a",
          state: "thinking",
          label: "A",
        });
      },
    ),
    presenceTelemetry.run(
      (e) => b.push(e),
      async () => {
        await Promise.resolve();
        presenceTelemetry.getStore()?.({
          operation: "b",
          state: "acting",
          label: "B",
        });
      },
    ),
  ]);
  expect(a.map((e) => e.operation)).toEqual(["a"]);
  expect(b.map((e) => e.operation)).toEqual(["b"]);
});
it("returns the unchanged result through the opt-in stream and reports transport errors", async () => {
  const response = presenceResponse(async () => ({
    action_id: "existing",
    result: { task_id: "task" },
  }));
  const event = JSON.parse((await response.text()).trim());
  expect(event).toEqual({
    type: "result",
    status: 201,
    body: { action_id: "existing", result: { task_id: "task" } },
  });
  const failed = presenceResponse(async () => {
    throw Error("private detail");
  });
  expect(JSON.parse((await failed.text()).trim())).toEqual({
    type: "result",
    status: 500,
    body: { error: "Internal server error" },
  });
});
it("emits retrieval/reasoning/extraction stages from real service execution, with bounded count and no content", async () =>
  fixture(async (repo, actions) => {
    const memory = new MemoryService(repo, new LocalEmbeddingProvider());
    const brain = new AryBrainService(
      repo,
      memory,
      new EntityService(repo),
      new MockLanguageModel(),
      actions,
    );
    const events: PresenceEvent[] = [];
    for await (const _event of brain.respond(
      { input: "What do you know about telescope maintenance?" },
      { onPresence: (e) => events.push(e) },
    )) {
      /* consume durable pipeline */
    }
    expect(events.map((e) => e.state)).toEqual([
      "understanding",
      "understanding",
      "retrieving",
      "thinking",
      "remembering",
    ]);
    expect(events.find((e) => e.state === "thinking")?.count).toBe(0);
    expect(JSON.stringify(events)).not.toContain("telescope");
    expect(new Set(events.map((e) => e.operation)).size).toBe(1);
  }));
