import { beforeAll, afterAll, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { readdir, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
let db: PGlite;
const owner = randomUUID(),
  stranger = randomUUID();

beforeAll(async () => {
  db = new PGlite({ extensions: { vector } });
  await db.exec(
    `create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;alter default privileges in schema public grant all on tables to authenticated;`,
  );
  for (const f of (await readdir("supabase/migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await db.exec(await readFile("supabase/migrations/" + f, "utf8"));
  await db.exec(
    `insert into auth.users values('${owner}'),('${stranger}');insert into public.users(id) values('${owner}'),('${stranger}');`,
  );
});
afterAll(async () => db.close());
async function asUser<T>(user: string, fn: () => Promise<T>) {
  await db.exec(
    `set role authenticated;select set_config('request.jwt.claim.sub','${user}',false);`,
  );
  try {
    return await fn();
  } finally {
    await db.exec("rollback;reset role");
  }
}
async function batch(m: unknown[]) {
  await db.query("select public.apply_memory_batch($1::jsonb)", [
    JSON.stringify(m),
  ]);
}
async function fixture() {
  const action = randomUUID(),
    outcome = randomUUID();
  await asUser(owner, () =>
    batch([
      {
        kind: "insert",
        table: "actions",
        id: action,
        data: {
          tool_name: "fixture",
          action_type: "fixture",
          permission_level: 4,
          status: "succeeded",
          input: {},
          output: {},
          metadata: {},
        },
      },
      {
        kind: "insert",
        table: "outcomes",
        id: outcome,
        data: {
          action_id: action,
          goal_id: null,
          status: "success",
          summary: "Original execution receipt",
          metrics: {},
          metadata: {},
        },
      },
    ]),
  );
  return (
    await db.query<{ id: string; updated_at: string }>(
      "select id,updated_at::text from outcomes where id=$1",
      [outcome],
    )
  ).rows[0];
}
it("existing SQL batch stores learning metadata with automatic outcome versions and RLS", async () => {
  const o = await fixture();
  await asUser(owner, () =>
    batch([
      {
        kind: "update",
        table: "outcomes",
        id: o.id,
        expected_updated_at: o.updated_at,
        data: {
          metadata: {
            nexus_outcome_engine_v1: {
              revision: 1,
              assessments: [],
              recommendations: [],
            },
          },
        },
      },
    ]),
  );
  expect(
    (
      await db.query("select * from outcome_versions where record_id=$1", [
        o.id,
      ])
    ).rows.length,
  ).toBe(2);
  await asUser(stranger, async () => {
    expect(
      (await db.query("select * from outcomes where id=$1", [o.id])).rows,
    ).toHaveLength(0);
    await expect(
      batch([
        {
          kind: "update",
          table: "outcomes",
          id: o.id,
          data: { summary: "Cross-owner overwrite" },
        },
      ]),
    ).rejects.toThrow();
  });
  expect(
    (
      await db.query<{ summary: string }>(
        "select summary from outcomes where id=$1",
        [o.id],
      )
    ).rows[0].summary,
  ).toBe("Original execution receipt");
});
it("SQL batch rolls back partial learning and its version on a downstream failure", async () => {
  const o = await fixture();
  await expect(
    asUser(owner, () =>
      batch([
        {
          kind: "update",
          table: "outcomes",
          id: o.id,
          expected_updated_at: o.updated_at,
          data: { metadata: { nexus_outcome_engine_v1: { revision: 1 } } },
        },
        {
          kind: "check",
          table: "actions",
          id: randomUUID(),
          expected_updated_at: o.updated_at,
        },
      ]),
    ),
  ).rejects.toThrow();
  expect(
    (
      await db.query<{ metadata: object }>(
        "select metadata from outcomes where id=$1",
        [o.id],
      )
    ).rows[0].metadata,
  ).toEqual({});
  expect(
    (
      await db.query("select * from outcome_versions where record_id=$1", [
        o.id,
      ])
    ).rows,
  ).toHaveLength(1);
});
it("SQL stale compare-and-swap rejects an overwrite", async () => {
  const o = await fixture();
  await asUser(owner, () =>
    batch([
      {
        kind: "update",
        table: "outcomes",
        id: o.id,
        expected_updated_at: o.updated_at,
        data: { metadata: { revision: 1 } },
      },
    ]),
  );
  await expect(
    asUser(owner, () =>
      batch([
        {
          kind: "update",
          table: "outcomes",
          id: o.id,
          expected_updated_at: o.updated_at,
          data: { metadata: { revision: 2 } },
        },
      ]),
    ),
  ).rejects.toThrow();
  expect(
    (
      await db.query<{ metadata: object }>(
        "select metadata from outcomes where id=$1",
        [o.id],
      )
    ).rows[0].metadata,
  ).toEqual({ revision: 1 });
});
