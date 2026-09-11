import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  createNexusEvent,
  eventFamilies,
  eventDraft,
  isFreshEvent,
} from "../src/domain/nexus-events";
import { NexusEventBus } from "../src/services/nexus-event-bus";
import { LocalRepository } from "../src/infrastructure/repositories/local";
import { nexusEventStream } from "../src/server/nexus-event-stream";
import {
  NexusClientBus,
  parseEventBatch,
} from "../src/components/events/event-store";
import { SseDecoder } from "../src/components/events/sse";
let dir: string, repo: LocalRepository, foreign: LocalRepository;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "nexus-event-test-"));
  const file = join(dir, "data.json");
  repo = new LocalRepository(randomUUID(), file);
  foreign = new LocalRepository(randomUUID(), file);
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});
const draft = {
  type: "ary.thinking",
  source: { kind: "backend" as const, name: "test" },
  payload: { label: "Reasoning", state: "thinking", operation_id: "op" },
};
it.each(eventFamilies)(
  "normalizes %s events with explicit null links",
  (family) => {
    const event = createNexusEvent(
      { ...draft, type: family + ".test" },
      randomUUID(),
    );
    expect(event).toMatchObject({
      version: 1,
      related_entity_id: null,
      correlation_id: null,
      mission_id: null,
      severity: "info",
      visibility: "systems",
    });
  },
);
it("rejects invalid types and strips secret/content payloads", () => {
  expect(() =>
    eventDraft.parse({ ...draft, type: "random.execute" }),
  ).toThrow();
  const event = createNexusEvent(
    {
      ...draft,
      payload: {
        label: "ok",
        ...{
          api_key: "secret",
          prompt: "private",
          audio: "raw",
          embedding: [1, 2],
          input: { token: "secret" },
        },
      },
    },
    randomUUID(),
  );
  expect(event.payload).toEqual({ label: "ok" });
});
it("persists publication across repository instances and returns ordered bounded pages", async () => {
  const bus = new NexusEventBus(repo);
  for (let n = 0; n < 5; n++) await bus.publish(draft);
  const reopened = new LocalRepository(repo.userId, join(dir, "data.json"));
  const page = await reopened.readEvents({ after: "0", limit: 2 });
  expect(page.events.map((e) => e.sequence)).toEqual(["1", "2"]);
  expect(page.has_more).toBe(true);
  expect(
    (await reopened.readEvents({ after: page.cursor, limit: 2 })).events.map(
      (e) => e.sequence,
    ),
  ).toEqual(["3", "4"]);
});
it("retries the same ID without duplicate persistence and rejects changed payload", async () => {
  const bus = new NexusEventBus(repo),
    id = randomUUID();
  const one = await bus.publish(draft, id),
    two = await bus.publish(draft, id);
  expect(two).toEqual(one);
  expect((await repo.readEvents({})).events).toHaveLength(1);
  await expect(
    bus.publish({ ...draft, payload: { label: "changed" } }, id),
  ).rejects.toThrow();
});
it("owner isolation and internal visibility apply to all journal reads", async () => {
  await new NexusEventBus(repo).publish(draft);
  await new NexusEventBus(repo).publish({ ...draft, visibility: "internal" });
  expect((await foreign.readEvents({})).events).toEqual([]);
  expect((await repo.readEvents({})).events).toHaveLength(1);
});
it("concurrent writers assign distinct increasing committed cursors", async () => {
  const bus = new NexusEventBus(repo);
  await Promise.all(Array.from({ length: 20 }, () => bus.publish(draft)));
  const page = await repo.readEvents({ after: "0" });
  expect(page.events.map((e) => e.sequence)).toEqual(
    Array.from({ length: 20 }, (_, i) => String(i + 1)),
  );
});
it("canonical events share rollback with their source batch", async () => {
  await expect(
    repo.batch([
      {
        kind: "insert",
        table: "permission_policies",
        data: {
          level: 1,
          reason: "fixture",
          scope_key: "event-rollback-fixture",
          parent_id: null,
          enabled: true,
          product_entity_id: null,
          subject_user_id: null,
          workspace: null,
          tool: null,
          action_type: null,
        },
      },
      {
        kind: "update",
        table: "tasks",
        id: randomUUID(),
        data: { status: "completed" },
      },
    ]),
  ).rejects.toThrow();
  expect((await repo.readEvents({})).events).toEqual([]);
  expect(await repo.list("permission_policies")).toEqual([]);
});
it("memory changes produce evidence without content and access touches are suppressed", async () => {
  const { MemoryService } = await import("../src/services/memory-service");
  const { LocalEmbeddingProvider } =
    await import("../src/infrastructure/providers/local");
  const memory = await new MemoryService(
    repo,
    new LocalEmbeddingProvider(),
  ).createMemory({ content: "Private durable text" });
  await repo.update("memories", memory.id, {
    last_accessed_at: new Date().toISOString(),
  });
  const page = await repo.readEvents({});
  expect(page.events.map((e) => e.type)).toEqual(["memory.created"]);
  expect(JSON.stringify(page)).not.toContain("Private durable text");
});
it("SSE resumes after committed cursor without crossing owners and cancels cleanly", async () => {
  const bus = new NexusEventBus(repo);
  await bus.publish(draft);
  await new NexusEventBus(foreign).publish(draft);
  const abort = new AbortController(),
    response = await nexusEventStream(
      repo,
      new Request("http://localhost/api/events/stream?after=1", {
        signal: abort.signal,
      }),
      { pollMs: 5, lifetimeMs: 1000 },
    );
  const reader = response.body!.getReader(),
    parser = new SseDecoder(),
    decoder = new TextDecoder();
  expect(
    parser.push(decoder.decode((await reader.read()).value))[0].event,
  ).toBe("ready");
  const event = await bus.publish({ ...draft, type: "ary.complete" });
  const frame = parser.push(decoder.decode((await reader.read()).value))[0];
  expect(parseEventBatch(frame.data).events.map((e) => e.id)).toEqual([
    event.id,
  ]);
  abort.abort();
  expect((await reader.read()).done).toBe(true);
});
it("rejects foreign stream origins and invalid cursors before opening", async () => {
  await expect(
    nexusEventStream(
      repo,
      new Request("http://localhost/api/events/stream", {
        headers: { origin: "https://foreign.example" },
      }),
    ),
  ).rejects.toThrow("origin");
  await expect(
    nexusEventStream(
      repo,
      new Request("http://localhost/api/events/stream?after=-1"),
    ),
  ).rejects.toThrow();
});
it("client decoder handles chunking, CRLF and ignores heartbeat comments", () => {
  const parser = new SseDecoder();
  expect(parser.push(": heartbeat\r")).toEqual([]);
  expect(parser.push('\n\r\nevent: ready\r\ndata: {"cursor":"1"}\r')).toEqual(
    [],
  );
  expect(parser.push("\n\r\n")).toEqual([
    { event: "ready", data: '{"cursor":"1"}' },
  ]);
});
it("client deduplicates replay, caps retention, and never exposes internal events", () => {
  const bus = new NexusClientBus(),
    event = createNexusEvent(draft, randomUUID());
  bus.receive([event, event]);
  expect(bus.read().events).toHaveLength(1);
  bus.receive([
    createNexusEvent({ ...draft, visibility: "internal" }, randomUUID()),
  ]);
  expect(bus.read().events).toHaveLength(1);
  bus.receive(
    Array.from({ length: 350 }, () => createNexusEvent(draft, randomUUID())),
  );
  expect(bus.read().events).toHaveLength(300);
  bus.reset();
  expect(bus.read().events).toEqual([]);
});
it("historical and future timestamps cannot become live visual activity", () => {
  expect(
    isFreshEvent(
      createNexusEvent(draft, randomUUID(), new Date(0).toISOString()),
      Date.now(),
    ),
  ).toBe(false);
  expect(
    isFreshEvent(
      createNexusEvent(
        draft,
        randomUUID(),
        new Date(Date.now() + 60000).toISOString(),
      ),
      Date.now(),
    ),
  ).toBe(false);
});

it("projects only fresh real phases and terminal events clear the matching operation", async () => {
  const { PresenceStore } = await import("../src/components/presence/store");
  const { EventPresenceProjector } =
    await import("../src/components/events/presence-projector");
  const store = new PresenceStore(),
    projector = new EventPresenceProjector(store);
  const event = {
    ...createNexusEvent({ ...draft, visibility: "ambient" }, randomUUID()),
    user_id: repo.userId,
    sequence: "1",
  };
  projector.receive([{ ...event, timestamp: new Date(0).toISOString() }]);
  expect(store.read().state).toBe("idle");
  projector.receive([event]);
  expect(store.read().state).toBe("thinking");
  projector.receive([
    { ...event, payload: { ...event.payload, terminal: true } },
  ]);
  expect(store.read().state).toBe("idle");
});
it("expired work becomes unconfirmed, never fabricated success or failure", async () => {
  const { PresenceStore } = await import("../src/components/presence/store");
  const { EventPresenceProjector } =
    await import("../src/components/events/presence-projector");
  const store = new PresenceStore(),
    projector = new EventPresenceProjector(store),
    now = Date.now();
  const event = {
    ...createNexusEvent({ ...draft, visibility: "ambient" }, randomUUID()),
    user_id: repo.userId,
    sequence: "1",
  };
  projector.receive([event], now);
  projector.expire(now + 120001);
  expect(store.read()).toMatchObject({
    state: "waiting",
    label: "No recent update · current state unconfirmed",
  });
  projector.clear();
  expect(store.read().state).toBe("idle");
});
it("board completion clears concurrent roles including expired leases and ignores late role updates", async () => {
  const { PresenceStore } = await import("../src/components/presence/store");
  const { EventPresenceProjector } =
    await import("../src/components/events/presence-projector");
  const store = new PresenceStore(),
    projector = new EventPresenceProjector(store),
    now = Date.now(),
    correlation_id = randomUUID();
  const event = {
    ...createNexusEvent(
      {
        ...draft,
        type: "agent.stage",
        visibility: "ambient",
        correlation_id,
        payload: {
          state: "delegating",
          operation_id: correlation_id + ":analyst",
        },
      },
      randomUUID(),
    ),
    user_id: repo.userId,
    sequence: "1",
  };
  projector.receive([event], now);
  projector.expire(now + 120001);
  projector.receive(
    [{ ...event, type: "agent.complete", payload: { terminal: true } }],
    now + 120002,
  );
  expect(store.read().state).toBe("idle");
  projector.receive(
    [{ ...event, timestamp: new Date(now + 120003).toISOString() }],
    now + 120003,
  );
  expect(store.read().state).toBe("idle");
});

it("ends an unread stream at its deadline and reports storage failure without invented events", async () => {
  const response = await nexusEventStream(
    repo,
    new Request("http://localhost/api/events/stream"),
    { pollMs: 5, lifetimeMs: 10 },
  );
  await new Promise((resolve) => setTimeout(resolve, 20));
  const reader = response.body!.getReader();
  await reader.read(); // real ready frame queued before the deadline
  expect((await reader.read()).done).toBe(true);
  const running = await nexusEventStream(
    repo,
    new Request("http://localhost/api/events/stream"),
    { pollMs: 5, lifetimeMs: 1000 },
  );
  vi.spyOn(repo, "readEvents").mockRejectedValue(Error("database unavailable"));
  const feed = running.body!.getReader(),
    parser = new SseDecoder(),
    decoder = new TextDecoder();
  await feed.read();
  const frames = parser.push(decoder.decode((await feed.read()).value));
  expect(frames.map((f) => f.event)).toEqual(["unavailable"]);
  expect((await feed.read()).done).toBe(true);
});

it("event subscriptions honor the existing activity.read permission without executing a tool", async () => {
  const { PermissionService } =
    await import("../src/services/permission-service");
  await new PermissionService(repo).savePolicy({
    tool: "activity.read",
    level: 0,
    reason: "Fixture denial",
  });
  await expect(
    nexusEventStream(repo, new Request("http://localhost/api/events/stream")),
  ).rejects.toThrow("permission policy");
  expect(await repo.list("actions")).toEqual([]);
});
it("stream origin uses the existing normalized Host boundary", async () => {
  const response = await nexusEventStream(
    repo,
    new Request("http://localhost:3000/api/events/stream", {
      headers: { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" },
    }),
  );
  await response.body!.cancel();
});
it("both event endpoints require authentication", async () => {
  const { handle } = await import("../src/server/http");
  vi.stubEnv("ARY_STORAGE", "supabase");
  try {
    for (const path of [["events"], ["events", "stream"]]) {
      expect(
        (
          await handle(
            new Request("http://localhost/api/" + path.join("/")),
            path,
          )
        ).status,
      ).toBe(401);
    }
  } finally {
    vi.unstubAllEnvs();
  }
});
