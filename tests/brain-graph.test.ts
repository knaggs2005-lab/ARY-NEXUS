import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { readFile, readdir } from "node:fs/promises";
import {
  graphSample,
  graphSampleId as id,
} from "../src/infrastructure/graph-sample";
import { graphQuerySchema, type BrainGraph } from "../src/domain/brain-graph";
import { queryLocalGraph } from "../src/infrastructure/repositories/local-graph";
import { GraphQueryService } from "../src/services/graph-query-service";
const user = id(999),
  foreign = id(998);
let db: PGlite;
beforeAll(async () => {
  db = new PGlite({ extensions: { vector } });
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated;
    insert into auth.users values ('${user}'),('${foreign}');`);
  for (const file of (await readdir("supabase/migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
  await db.exec(
    `insert into public.users(id) values ('${user}'),('${foreign}')`,
  );
  for (const [table, rows] of Object.entries(graphSample(user))) {
    for (const row of rows) {
      const keys = Object.keys(row);
      await db.query(
        `insert into ${table}(${keys.join(",")}) values (${keys.map((_, i) => `$${i + 1}`).join(",")})`,
        Object.values(row).map((v) =>
          v !== null && typeof v === "object" ? JSON.stringify(v) : v,
        ),
      );
    }
  }
}, 30000);
afterAll(async () => {
  await db?.close();
});
async function sql(
  input: Record<string, unknown> = {},
  who = user,
  setup = "",
) {
  return db.transaction(async (tx) => {
    await tx.exec("set local role authenticated");
    await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [who]);
    if (setup) {
      await tx.exec("savepoint graph_fixture");
      await tx.exec(setup);
    }
    const result = await tx.query<{ graph: BrainGraph }>(
      "select query_brain_graph_v1($1::jsonb) graph",
      [JSON.stringify(input)],
    );
    if (setup) await tx.exec("rollback to savepoint graph_fixture");
    return result.rows[0].graph;
  });
}
const local = (input: Record<string, unknown> = {}) =>
  queryLocalGraph(graphSample(), graphQuerySchema.parse(input));
for (const [adapter, query] of [
  ["PostgreSQL", sql],
  ["local", local],
] as const)
  describe(adapter, () => {
    it("returns canonical nodes, memory importance, recency and goal summaries without embeddings", async () => {
      const g = await query();
      const ary = g.nodes.find((n) => n.id === id(3))!;
      expect(ary).toMatchObject({
        label: "Ary Nexus",
        type: "project",
        importance: 0.75,
        connectedMemoryCount: 1,
        status: "active",
        relatedGoalCount: 1,
      });
      expect(Date.parse(ary.recency)).toBeGreaterThan(0);
      expect(ary.relatedGoals[0].title).toBe("Sample graph release");
      expect(JSON.stringify(g)).not.toContain('"embedding"');
      expect(
        g.edges.every(
          (e) =>
            g.nodes.some((n) => n.id === e.source) &&
            g.nodes.some((n) => n.id === e.target),
        ),
      ).toBe(true);
    });
    it("bounds 1/2-hop traversal and traverses either direction", async () => {
      const one = await query({ root: id(1), depth: 1 });
      const two = await query({ root: id(1), depth: 2 });
      expect(one.nodes.map((n) => n.id)).toEqual([id(1), id(2), id(3)]);
      expect(two.nodes.map((n) => n.id)).toContain(id(4));
      expect(two.nodes.map((n) => n.id)).not.toContain(id(7));
    });
    it("filters project/company scope using explicit membership and keeps a typed-filter root anchor", async () => {
      const project = await query({ project_id: id(2) });
      expect(project.nodes.map((n) => n.id)).toEqual([id(2), id(4), id(5)]);
      const company = await query({ company_id: id(1), types: ["task"] });
      expect(company.nodes.map((n) => n.id)).toEqual([id(4), id(5)]);
      const anchored = await query({ root: id(2), types: ["task"] });
      expect(anchored.nodes.map((n) => n.id)).toEqual([id(2), id(4), id(5)]);
      expect(
        (await query({ project_id: id(2), company_id: id(1) })).nodes.map(
          (n) => n.id,
        ),
      ).toEqual(project.nodes.map((n) => n.id));
    });
    it("reports active blockers and task-associated goals", async () => {
      const g = await query({ root: id(4) });
      const task = g.nodes[0];
      expect(task.activeBlockerCount).toBe(1);
      expect(task.activeBlockers).toEqual([
        { id: id(5), label: "Sample dataset review", relationshipId: id(105) },
      ]);
      expect(task.relatedGoals[0].id).toBe(id(401));
    });
    it("separates ended, disabled and scheduled relationships", async () => {
      const historical = await query({ relationships: "historical" });
      expect(historical.edges.map((e) => e.id)).toEqual([id(108), id(110)]);
      const all = await query({ relationships: "all" });
      expect(all.edges.find((e) => e.id === id(109))?.status).toBe("scheduled");
      expect(all.edges.find((e) => e.id === id(108))?.status).toBe(
        "historical",
      );
      expect((await query()).edges).toHaveLength(7);
    });
    it("searches aliases and full text, suppresses irrelevant results", async () => {
      expect((await query({ q: "memory hq" })).nodes.map((n) => n.id)).toEqual([
        id(3),
      ]);
      expect((await query({ q: "Nexus" })).nodes.map((n) => n.id)).toEqual([
        id(3),
      ]);
      expect(
        (await query({ q: "dataset review" })).nodes.map((n) => n.id),
      ).toEqual([id(5)]);
      expect((await query({ q: "quasar telescope" })).nodes).toEqual([]);
    });
    it("paginates nodes without duplicates and exposes both truncation flags", async () => {
      const first = await query({
        limit: 2,
        relationships: "all",
        edge_limit: 1,
      });
      const second = await query({ limit: 2, after: first.meta.nextCursor! });
      expect(first.meta.nodesTruncated).toBe(true);
      expect(first.nodes.map((n) => n.id)).toEqual([id(1), id(2)]);
      expect(second.nodes.map((n) => n.id)).toEqual([id(3), id(4)]);
      expect(
        (await query({ root: id(1), depth: 2, limit: 2 })).meta.nodesTruncated,
      ).toBe(true);
      expect((await query({ edge_limit: 1 })).meta.edgesTruncated).toBe(true);
    });
  });
it("enforces tenant boundaries for roots, scopes, search and RPC helpers", async () => {
  expect((await sql({}, foreign)).nodes).toEqual([]);
  await expect(sql({ root: id(1) }, foreign)).rejects.toThrow(
    "Entity not found",
  );
  await expect(sql({ company_id: id(1) }, foreign)).rejects.toThrow(
    "Invalid company scope",
  );
  await expect(
    db.transaction(async (tx) => {
      await tx.exec("set local role anon");
      await tx.query("select query_brain_graph_v1('{}')");
    }),
  ).rejects.toThrow(/permission denied/);
});
it("validates bounds, types, scopes and cursor misuse in service and direct RPC", async () => {
  const service = new GraphQueryService({ queryGraph: async (q) => local(q) });
  for (const input of [
    { depth: 3 },
    { limit: 101 },
    { edge_limit: 501 },
    { types: ["secret"] },
    { root: id(1), after: id(2) },
  ]) {
    expect(() => service.query(input)).toThrow();
    await expect(sql(input)).rejects.toThrow("Invalid");
  }
  await expect(sql({ project_id: id(1) })).rejects.toThrow(
    "Invalid project scope",
  );
});
it("has matching local and SQL graph payloads", async () => {
  const normalize = (g: BrainGraph) =>
    JSON.parse(
      JSON.stringify(g, (key, value) =>
        ["generatedAt", "recency", "updatedAt"].includes(key)
          ? undefined
          : ["validFrom", "validTo"].includes(key) && value
            ? new Date(value).toISOString()
            : value,
      ),
    );
  for (const q of [
    {},
    { root: id(1), depth: 2 },
    { q: "Nexus" },
    { relationships: "all" },
    { project_id: id(2) },
  ]) {
    expect(normalize(await sql(q))).toEqual(normalize(local(q)));
  }
});
it("suppresses archived/future memories and edges with stale evidence", async () => {
  const setup = `update memories set archived_at=now() where id='${id(201)}';
    update memories set valid_from='2099-01-01' where id='${id(202)}';
    update relationships set memory_id='${id(201)}' where id='${id(102)}';`;
  const g = await sql({}, user, setup);
  expect(g.nodes.find((n) => n.id === id(1))).toMatchObject({
    connectedMemoryCount: 0,
    importance: null,
  });
  expect(g.nodes.find((n) => n.id === id(2))?.connectedMemoryCount).toBe(0);
  expect(g.edges.some((e) => e.id === id(102))).toBe(false);
  const sample = graphSample();
  sample.memories[0].archived_at = new Date().toISOString();
  sample.memories[1].valid_from = "2099-01-01";
  sample.relationships[1].memory_id = id(201);
  const localResult = queryLocalGraph(sample, graphQuerySchema.parse({}));
  expect(localResult.edges.map((e) => e.id)).toEqual(g.edges.map((e) => e.id));
  expect(localResult.nodes.map((n) => n.connectedMemoryCount)).toEqual(
    g.nodes.map((n) => n.connectedMemoryCount),
  );
});
it("excludes completed blocker entities and completed task records", async () => {
  for (const setup of [
    `update entities set metadata='{"status":"completed"}' where id='${id(5)}';`,
    `insert into tasks(user_id,entity_id,title,status) values ('${user}','${id(5)}','Review complete','completed');`,
  ])
    expect(
      (await sql({ root: id(4) }, user, setup)).nodes[0].activeBlockerCount,
    ).toBe(0);
  const sample = graphSample();
  sample.tasks.push({
    ...sample.tasks[0],
    id: id(502),
    entity_id: id(5),
    status: "completed",
  });
  expect(
    queryLocalGraph(sample, graphQuerySchema.parse({ root: id(4) })).nodes[0]
      .activeBlockerCount,
  ).toBe(0);
});
it("bounds high-degree hubs and cycles, including the direct RPC", async () => {
  const setup = `insert into entities(id,user_id,entity_type,name)
    select ('71000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'${user}','person','Hub sample '||n from generate_series(1,550) n;
    insert into relationships(user_id,source_entity_id,target_entity_id,relationship_type)
    select '${user}','${id(1)}',id,'mentions' from entities where user_id='${user}' and name like 'Hub sample %';
    insert into relationships(user_id,source_entity_id,target_entity_id,relationship_type) values ('${user}','${id(1)}','${id(2)}','tracks');`;
  const g = await sql(
    { root: id(1), depth: 2, limit: 100, edge_limit: 20 },
    user,
    setup,
  );
  expect(g.nodes).toHaveLength(100);
  expect(new Set(g.nodes.map((n) => n.id)).size).toBe(100);
  expect(g.edges).toHaveLength(20);
  expect(g.meta).toMatchObject({
    nodesTruncated: true,
    edgesTruncated: true,
    nextCursor: null,
  });
});
