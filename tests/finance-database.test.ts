import { beforeAll, afterAll, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
let db: PGlite;
const a = randomUUID(),
  b = randomUUID(),
  entity = randomUUID();
const payload = () => ({
  account: {
    name: "Fixture account",
    institution: "Fixture",
    kind: "cash",
    currency: "USD",
  },
  balance_minor: 100,
  coverage: null,
  transactions: [],
  bills: [],
  holdings: [],
  holdings_complete: false,
  entity_ids: [],
  goal_ids: [],
});
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    `create role anon;create role authenticated;create schema auth;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;create table public.users(id uuid primary key);create table public.entities(user_id uuid,id uuid primary key);create table public.goals(user_id uuid,id uuid primary key);grant select on entities,goals to authenticated;insert into users values('${a}'),('${b}');insert into entities values('${b}','${entity}');`,
  );
  await db.exec(
    await readFile("supabase/migrations/202609070012_finance.sql", "utf8"),
  );
  await db.exec(`set role authenticated;set request.jwt.claim.sub='${a}';`);
});
afterAll(async () => {
  await db.close();
});
async function insert(
  data: unknown = payload(),
  owner = a,
  parent: string | null = null,
  key = randomUUID(),
  asof = "2026-09-01T00:00:00Z",
  account = randomUUID(),
) {
  return (
    await db.query<{ id: string }>(
      `insert into finance_snapshots(user_id,import_key,account_key,parent_id,as_of,observed_at,source_label,source_reference,payload) values($1,$2,$3,$4,$5,$5,'Statement','page 1',$6) returning id`,
      [owner, key, account, parent, asof, JSON.stringify(data)],
    )
  ).rows[0].id;
}
it("applies additive migration and isolates authenticated owners", async () => {
  const id = await insert();
  await db.exec(`set request.jwt.claim.sub='${b}';`);
  expect(
    (await db.query(`select * from finance_snapshots where id=$1`, [id])).rows,
  ).toEqual([]);
  await expect(insert(payload(), a)).rejects.toThrow();
  await db.exec(`set request.jwt.claim.sub='${a}';`);
});
it("snapshot ledger cannot be updated or deleted", async () => {
  const id = await insert();
  await expect(
    db.query(
      "update finance_snapshots set source_label='changed' where id=$1",
      [id],
    ),
  ).rejects.toThrow();
  await expect(
    db.query("delete from finance_snapshots where id=$1", [id]),
  ).rejects.toThrow();
});
it("corrections are linear and stay within account/date/owner", async () => {
  const key = randomUUID(),
    root = await insert(
      payload(),
      a,
      null,
      randomUUID(),
      "2026-09-01T00:00:00Z",
      key,
    );
  await insert(
    { ...payload(), balance_minor: 90 },
    a,
    root,
    randomUUID(),
    "2026-09-01T00:00:00Z",
    key,
  );
  await expect(
    insert(payload(), a, root, randomUUID(), "2026-09-01T00:00:00Z", key),
  ).rejects.toThrow();
  await expect(insert(payload(), a, root)).rejects.toThrow();
});
it("rejects foreign links and fractional monetary values", async () => {
  await expect(
    insert({ ...payload(), entity_ids: [entity] }),
  ).rejects.toThrow();
  await expect(insert({ ...payload(), balance_minor: 0.1 })).rejects.toThrow();
});
it("account identity cannot change across snapshots", async () => {
  const account = randomUUID();
  await insert(
    payload(),
    a,
    null,
    randomUUID(),
    "2026-09-01T00:00:00Z",
    account,
  );
  const next = payload();
  next.account.currency = "EUR";
  await expect(
    insert(next, a, null, randomUUID(), "2026-09-02T00:00:00Z", account),
  ).rejects.toThrow();
});
it("import key uniqueness protects concurrent retries", async () => {
  const key = randomUUID();
  await insert(payload(), a, null, key);
  await expect(insert(payload(), a, null, key)).rejects.toThrow();
});
it("database rejects malformed transaction amounts and future observations", async () => {
  await expect(
    insert({
      ...payload(),
      transactions: [
        {
          source_id: "t",
          kind: "income",
          status: "posted",
          at: "2026-09-01T00:00:00Z",
          amount_minor: -1,
        },
      ],
    }),
  ).rejects.toThrow();
  await expect(
    insert(payload(), a, null, randomUUID(), "2099-01-01T00:00:00Z"),
  ).rejects.toThrow();
});
