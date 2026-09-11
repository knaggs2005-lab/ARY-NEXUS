import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  mapKinds,
  mapQuery,
  mapNode,
  mapEdge,
  projectMapRecord,
  projectInspection,
  type NexusMap,
} from "../src/domain/nexus-map";
import {
  clusters,
  projectMap,
  spatialLayout,
  eventConnections,
} from "../src/components/atlas/map-projection";
import { createNexusEvent } from "../src/domain/nexus-events";
import { LocalRepository } from "../src/infrastructure/repositories/local";
import { NexusMapService } from "../src/services/nexus-map-service";
import { ActionService } from "../src/services/action-service";
import { ActionRequestService } from "../src/services/action-request-service";
import { PermissionService } from "../src/services/permission-service";
import { MemoryService } from "../src/services/memory-service";
import { LocalEmbeddingProvider } from "../src/infrastructure/providers/local";
const blank = (): NexusMap => ({
  nodes: [],
  edges: [],
  meta: {
    generatedAt: new Date().toISOString(),
    more: false,
    cursor: null,
    warnings: [],
  },
});
let dir: string, repo: LocalRepository, service: NexusMapService;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "nexus-map-"));
  repo = new LocalRepository(randomUUID(), join(dir, "data.json"));
  const actions = new ActionService(repo);
  service = new NexusMapService(
    repo,
    actions,
    new ActionRequestService(repo, actions),
  );
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});
it.each(mapKinds)("supports %s as an explicit map category", (kind) =>
  expect(mapQuery.parse({ kind }).kind).toBe(kind),
);
it("rejects arbitrary types, excess depth and unbounded query input", () => {
  for (const q of [
    { kind: "fake" },
    { depth: 3 },
    { q: "a".repeat(121) },
    { limit: 10000 },
  ])
    expect(() => mapQuery.parse(q)).toThrow();
});
it("empty categories stay empty; roles are declared and capabilities never claim running", async () => {
  const map = await service.query({});
  expect(map.nodes.find((n) => n.id === "system:ary")?.status).toBe(
    "available",
  );
  expect(map.nodes.filter((n) => n.kind === "agent")).toHaveLength(6);
  expect(
    map.nodes.some((n) =>
      ["application", "device", "location", "automation"].includes(n.kind),
    ),
  ).toBe(false);
  expect(map.nodes.some((n) => n.status === "running")).toBe(false);
  expect(map.nodes.filter((n) => n.kind === "tool").length).toBeLessThanOrEqual(
    24,
  );
  expect(JSON.stringify(map)).not.toContain("input_schema");
});
it("canonical entity IDs and stored relationship evidence are preserved", async () => {
  const a = await repo.insert("entities", {
      entity_type: "company",
      name: "Clevaryn",
      description: "",
      metadata: {},
    }),
    b = await repo.insert("entities", {
      entity_type: "project",
      name: "Wag Trails",
      description: "",
      metadata: {},
    });
  const edge = await repo.insert("relationships", {
    source_entity_id: b.id,
    target_entity_id: a.id,
    relationship_type: "part_of",
    strength: 0.8,
    valid_from: null,
    valid_to: null,
    memory_id: null,
    metadata: {},
  });
  const map = await service.query({ root: b.id, depth: 2 });
  expect(map.nodes.map((n) => n.id)).toContain(a.id);
  expect(map.edges.find((e) => e.id === edge.id)).toMatchObject({
    source: b.id,
    target: a.id,
    provenance: "stored",
  });
});
it("owner scope, search and memory pagination do not load the entire memory collection", async () => {
  const memory = new MemoryService(repo, new LocalEmbeddingProvider());
  for (let i = 0; i < 27; i++)
    await memory.createMemory({
      content: `Recall fixture ${i}`,
      summary: `Memory ${i}`,
    });
  const page = await repo.readMapRecords("memory", "");
  expect(page.records).toHaveLength(24);
  expect(page.more).toBe(true);
  const next = await repo.readMapRecords("memory", "", page.records.at(-1)!.id);
  expect(next.records).toHaveLength(3);
  expect(
    await new LocalRepository(
      randomUUID(),
      join(dir, "data.json"),
    ).readMapRecords("memory", ""),
  ).toEqual({ records: [], more: false });
  expect(
    (await repo.readMapRecords("memory", "Memory 26")).records,
  ).toHaveLength(1);
});
it("read restrictions return explicit unavailable coverage without leaking records", async () => {
  await new MemoryService(repo, new LocalEmbeddingProvider()).createMemory({
    content: "Private fixture",
  });
  await new PermissionService(repo).savePolicy({
    tool: "memory.read",
    level: 0,
    reason: "Fixture restriction",
  });
  const map = await service.query({ kind: "memory" });
  expect(map.nodes).toEqual([]);
  expect(map.meta.warnings).toContain("memory: access restricted");
});
it("mission references use the existing saved plan, without copying its execution payload", async () => {
  const id = randomUUID(),
    entity = randomUUID(),
    memory = randomUUID();
  const record = projectMapRecord("mission", {
    id,
    updated_at: new Date().toISOString(),
    metadata: {
      plan: {
        goal: "Finish edit",
        status: "paused",
        revision: 4,
        entity_ids: [entity],
        memory_ids: [memory],
        spec: { secret: "PRIVATE" },
      },
    },
  })!;
  expect(record).toMatchObject({
    id,
    label: "Finish edit",
    kind: "mission",
    entityIds: [entity],
    memoryIds: [memory],
  });
  expect(JSON.stringify(record)).not.toContain("PRIVATE");
});
it("locations use explicit canonical metadata rather than invented coordinates", () => {
  expect(
    projectMapRecord("facets", {
      id: randomUUID(),
      name: "Studio",
      metadata: { nexus_kind: "location" },
    })?.kind,
  ).toBe("location");
  expect(
    projectMapRecord("facets", {
      id: randomUUID(),
      name: "Studio",
      metadata: {},
    }),
  ).toBeNull();
});
it("application and device nodes require actual inspection receipts and omit paths/default placeholders", () => {
  const apps = projectInspection({
    id: randomUUID(),
    tool_name: "desktop.list_apps",
    updated_at: new Date().toISOString(),
    output: {
      result: {
        apps: [{ id: "real-app-id", name: "Premiere Pro", path: "PRIVATE" }],
      },
    },
  });
  expect(apps[0]).toMatchObject({
    id: "application:real-app-id",
    status: "previously_observed",
  });
  expect(JSON.stringify(apps)).not.toContain("PRIVATE");
  const devices = projectInspection({
    tool_name: "studio.inspect",
    output: {
      result: {
        devices: [
          { id: "default", name: "Camera", adapter: "unconfigured" },
          { id: "real", name: "Amaran", adapter: "amaran" },
        ],
      },
    },
  });
  expect(devices.map((d) => d.label)).toEqual(["Amaran"]);
});
it("current explicit membership clusters without merging similar names or historical links", () => {
  const map = blank();
  map.nodes = [
    mapNode("p", "Project", "project", "Canonical entity", "", "Entities"),
    mapNode("a", "Jordan", "person", "Canonical entity", "", "Entities"),
    mapNode("b", "Jordan", "person", "Canonical entity", "", "Entities"),
  ];
  map.edges = [
    { ...mapEdge("a", "p", "part_of", "stored"), status: "current" },
    { ...mapEdge("b", "p", "part_of", "stored"), status: "historical" },
  ];
  const groups = clusters(map);
  expect(groups.get("scope:p")?.nodes.map((n) => n.id)).toEqual(["a"]);
  expect(groups.get("kind:person")?.nodes.map((n) => n.id)).toEqual(["b"]);
});
it("ten thousand records reduce to bounded semantic groups and deterministic finite orbit coordinates", () => {
  const map = blank();
  map.nodes = Array.from({ length: 10000 }, (_, i) =>
    mapNode(
      String(i),
      `Project ${i}`,
      "project",
      "Canonical entity",
      "",
      "Entities",
    ),
  );
  const start = performance.now(),
    view = projectMap(map, new Set(), false);
  expect(view.nodes).toHaveLength(1);
  expect(view.nodes[0].members).toHaveLength(10000);
  const detail = projectMap(map, new Set([view.nodes[0].id]), true);
  expect(detail.nodes.length).toBeLessThanOrEqual(100);
  const points = spatialLayout(detail, 0.5, 0.3);
  expect(
    [...points.values()].every(
      (p) => Number.isFinite(p.x) && Number.isFinite(p.y),
    ),
  ).toBe(true);
  expect(points).toEqual(spatialLayout(detail, 0.5, 0.3));
  expect(performance.now() - start).toBeLessThan(1500);
});
it("node/edge budgets never leave dangling references across many separate project groups", () => {
  const map = blank();
  for (let i = 0; i < 180; i++) {
    map.nodes.push(
      mapNode(`p${i}`, "Project", "project", "", "", "Entities"),
      mapNode(`n${i}`, "Person", "person", "", "", "Entities"),
    );
    map.edges.push(mapEdge(`n${i}`, `p${i}`, "part_of", "stored"));
  }
  const view = projectMap(map, new Set(), true);
  expect(view.nodes.length).toBeLessThanOrEqual(100);
  const ids = new Set(view.nodes.map((n) => n.id));
  expect(view.edges.every((e) => ids.has(e.source) && ids.has(e.target))).toBe(
    true,
  );
  expect(view.meta.more).toBe(true);
});
it("only fresh explicit backend co-references activate event paths; stale/client/unrelated events do not", () => {
  const entity = randomUUID(),
    map = blank();
  map.nodes = [
    mapNode(entity, "Project", "project", "", "", "Entities"),
    mapNode("tool:create_task", "Create task", "tool", "", "", "Approvals"),
  ];
  const event = createNexusEvent(
    {
      type: "tool.succeeded",
      source: { kind: "database", name: "actions" },
      related_entity_id: entity,
      payload: { tool: "create_task" },
    },
    randomUUID(),
  );
  expect(eventConnections(map, [event])).toHaveLength(1);
  expect(eventConnections(map, [event])[0].evidence).toEqual([event.id]);
  expect(
    eventConnections(map, [
      { ...event, source: { kind: "client", name: "UI" } },
    ]),
  ).toEqual([]);
  expect(
    eventConnections(map, [{ ...event, related_entity_id: randomUUID() }]),
  ).toEqual([]);
  expect(eventConnections(map, [event], Date.now() + 16000)).toEqual([]);
});
it("map service inspection never invokes an external provider", async () => {
  const spy = vi.spyOn(repo, "readMapInspection");
  await service.query({ kind: "application" });
  expect(spy).toHaveBeenCalledWith("desktop.list_apps");
  expect(
    (await repo.list("actions")).some(
      (a) => a.tool_name === "desktop.list_apps",
    ),
  ).toBe(false);
});

it("focusing a cluster retains its context until explicit expansion", () => {
  const map = blank();
  map.nodes = [mapNode("p", "Project", "project", "", "", "Entities")];
  const collapsed = projectMap(map, new Set(), false),
    id = collapsed.nodes[0].id;
  expect(
    projectMap(map, new Set(), true, id).nodes.some((n) => n.id === id),
  ).toBe(true);
  expect(
    projectMap(map, new Set([id]), true).nodes.some((n) => n.id === "p"),
  ).toBe(true);
});
it("memory/entity links come from existing link records", async () => {
  const entity = await repo.insert("entities", {
    entity_type: "project",
    name: "Evidence project",
    description: "",
    metadata: {},
  });
  const memory = await new MemoryService(
    repo,
    new LocalEmbeddingProvider(),
  ).createMemory({ content: "Linked fact" });
  await repo.insert("memory_entities", {
    memory_id: memory.id,
    entity_id: entity.id,
  });
  const map = await service.query({});
  expect(
    map.edges.some(
      (e) =>
        e.source === `memory:${memory.id}` &&
        e.target === entity.id &&
        e.provenance === "reference",
    ),
  ).toBe(true);
});
