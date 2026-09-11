import { afterAll, beforeAll, expect, it } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { createNexusEvent, type EventPage } from "../src/domain/nexus-events";
import { parseEventBatch } from "../src/components/events/event-store";
let db: PGlite;
const a = randomUUID(),
  b = randomUUID();
const migration = "supabase/migrations/202609080014_nexus_events.sql";
beforeAll(async () => {
  db = new PGlite({ extensions: { vector } });
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated;
    alter default privileges in schema public grant all on tables to authenticated;`);
  for (const file of (await readdir("supabase/migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await db.exec(await readFile("supabase/migrations/" + file, "utf8"));
  await db.exec(await readFile(migration, "utf8"));
  await db.exec(
    `insert into auth.users values ('${a}'),('${b}'); insert into public.users(id) values ('${a}'),('${b}');`,
  );
});
afterAll(async () => db.close());
async function asUser<T>(user: string, work: () => Promise<T>) {
  await db.exec(
    `set role authenticated; select set_config('request.jwt.claim.sub','${user}',false)`,
  );
  try {
    return await work();
  } finally {
    await db.exec("rollback; reset role");
  }
}
function event(
  type = "system.test",
  visibility: "systems" | "internal" = "systems",
) {
  return createNexusEvent(
    {
      type,
      source: { kind: "backend", name: "fixture" },
      visibility,
      payload: { label: "safe" },
    },
    randomUUID(),
  );
}
async function append(e = event()) {
  return (
    await db.query<{ event: unknown }>(
      "select public.nexus_append_event_v1($1::jsonb) event",
      [JSON.stringify(e)],
    )
  ).rows[0].event;
}
async function page(after: string | null = null) {
  return (
    await db.query<{ page: EventPage }>(
      "select public.nexus_read_events_v1($1::bigint,null,100) page",
      [after],
    )
  ).rows[0].page;
}
it("persists normalized rows, parses PostgreSQL timestamps, and replays idempotently", async () =>
  asUser(a, async () => {
    const e = event();
    const one = await append(e),
      two = await append(e);
    expect(one).toEqual(two);
    const p = await page();
    expect(
      parseEventBatch(JSON.stringify(p)).events.some((x) => x.id === e.id),
    ).toBe(true);
  }));
it("enforces RLS, hides internal events, and forbids direct mutation/private function calls", async () => {
  const hidden = event("system.hidden", "internal");
  await asUser(a, () => append(hidden));
  await asUser(b, async () => {
    expect((await page()).events).toEqual([]);
    expect(
      (
        await db.query("select * from public.nexus_events where user_id=$1", [
          a,
        ])
      ).rows,
    ).toEqual([]);
  });
  await asUser(a, async () => {
    expect((await page()).events.some((e) => e.id === hidden.id)).toBe(false);
    await expect(db.exec("delete from public.nexus_events")).rejects.toThrow();
    await expect(
      db.exec("update public.nexus_events set severity='critical'"),
    ).rejects.toThrow();
    await expect(
      db.query("select public.nexus_store_event_v1($1,$2::jsonb)", [
        b,
        JSON.stringify(event()),
      ]),
    ).rejects.toThrow();
  });
});
it("source mutations and their journal rows roll back together", async () =>
  asUser(a, async () => {
    const before = (await page()).cursor;
    await db.exec("begin");
    await db.query(
      "insert into public.permission_policies(user_id,level,reason,scope_key) values($1,1,'fixture','fixture')",
      [a],
    );
    expect(
      (await page(before)).events.some(
        (e) => e.type === "permission.policy_changed",
      ),
    ).toBe(true);
    await db.exec("rollback");
    expect((await page(before)).events).toEqual([]);
  }));
it("records source action status and result without inputs, output or secrets", async () =>
  asUser(a, async () => {
    const before = (await page()).cursor,
      id = randomUUID();
    await db.query(
      `insert into public.actions(id,user_id,tool_name,action_type,permission_level,approval_required,workspace,product_entity_ids,status,input,output,metadata) values($1,$2,'mock.observe','observe',1,false,'ary-nexus','{}','requested','{"api_key":"secret-fixture"}','{}','{}')`,
      [id, a],
    );
    await db.query(
      "update public.actions set status='succeeded',output=' {\"private\":\"secret-fixture\"}' where id=$1",
      [id],
    );
    const p = await page(before);
    expect(p.events.map((e) => e.type)).toEqual([
      "tool.requested",
      "tool.succeeded",
    ]);
    expect(JSON.stringify(p)).not.toContain("secret-fixture");
  }));
it("validates family and cursors, strips forbidden payload fields at the SQL boundary", async () =>
  asUser(a, async () => {
    const e = event();
    const stored = await append({
      ...e,
      payload: { label: "safe", ...{ api_key: "fixture-secret" } },
    });
    expect(JSON.stringify(stored)).not.toContain("fixture-secret");
    await expect(
      append({ ...event(), type: "unrecognized.execute" }),
    ).rejects.toThrow();
    await expect(
      db.query("select public.nexus_read_events_v1(-1,null,100)"),
    ).rejects.toThrow();
    await expect(
      db.query("select public.nexus_read_events_v1(null,null,1000)"),
    ).rejects.toThrow();
  }));
it("rerunning the migration preserves existing journal rows and does not duplicate triggers", async () => {
  const before = (
    await db.query<{ n: number }>(
      "select count(*)::int n from public.nexus_events",
    )
  ).rows[0].n;
  await db.exec(await readFile(migration, "utf8"));
  expect(
    (
      await db.query<{ n: number }>(
        "select count(*)::int n from public.nexus_events",
      )
    ).rows[0].n,
  ).toBe(before);
  expect(
    (
      await db.query<{ n: number }>(
        "select count(*)::int n from pg_trigger where tgname='nexus_activity'",
      )
    ).rows[0].n,
  ).toBe(9);
});

it("late committed events get a delivery cursor after previously delivered rows", async () =>
  asUser(a, async () => {
    const before = (await page()).cursor;
    const late = { ...event(), timestamp: new Date(0).toISOString() };
    expect(await append(late)).toMatchObject({ sequence: null });
    const delivered = await page(before);
    expect(delivered.events.map((e) => e.id)).toContain(late.id);
    expect(BigInt(delivered.cursor)).toBeGreaterThan(BigInt(before));
  }));
it("rejects nested payloads and invalid scalar types before they can poison delivery", async () =>
  asUser(a, async () => {
    for (const payload of [
      { label: { secret: "hidden" } },
      { terminal: "true" },
      { count: -1 },
      { revision: 0.5 },
      { record_id: null },
      { duration_ms: "slow" },
    ]) {
      await expect(
        append({ ...event(), payload } as ReturnType<typeof event>),
      ).rejects.toThrow();
    }
    await expect(
      append({
        ...event(),
        source: { kind: "backend", name: "fixture", secret: "hidden" },
      } as ReturnType<typeof event>),
    ).rejects.toThrow();
  }));
