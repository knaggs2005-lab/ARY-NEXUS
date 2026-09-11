import { beforeAll, afterAll, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { readdir, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
let db: PGlite;
const owner = randomUUID(),
  stranger = randomUUID();
const migration = "supabase/migrations/202609090017_permission_engine.sql";
beforeAll(async () => {
  db = new PGlite({ extensions: { vector } });
  await db.exec(
    `create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;alter default privileges in schema public grant all on tables to authenticated;`,
  );
  for (const f of (await readdir("supabase/migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await db.exec(await readFile("supabase/migrations/" + f, "utf8"));
  await db.exec(await readFile(migration, "utf8"));
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
async function insertPolicy(extra: Record<string, unknown> = {}) {
  const row = {
    id: randomUUID(),
    user_id: owner,
    scope_key: randomUUID(),
    level: 5,
    reason: "Isolated validation",
    ...extra,
  };
  return db.query(
    `insert into public.permission_policies(${Object.keys(row).join(",")}) values(${Object.keys(
      row,
    )
      .map((_, i) => `$${i + 1}`)
      .join(",")}) returning id`,
    Object.values(row),
  );
}
it("migration is rerunnable and legacy policies remain valid", async () => {
  await asUser(owner, async () => {
    expect((await insertPolicy()).rows).toHaveLength(1);
  });
});
it("class/behavior policies remain owner-scoped and append-only", async () => {
  const id = randomUUID();
  await asUser(owner, () =>
    insertPolicy({
      id,
      permission_class: "COMMUNICATE",
      behavior: "ask_every_time",
    }),
  );
  await asUser(stranger, async () =>
    expect(
      (await db.query("select id from permission_policies where id=$1", [id]))
        .rows,
    ).toHaveLength(0),
  );
  await asUser(owner, async () => {
    await expect(
      db.query("update permission_policies set level=0 where id=$1", [id]),
    ).rejects.toThrow();
  });
});
it.each([
  { permission_class: "UNRESTRICTED" },
  { behavior: "sometimes" },
  { behavior: "deny", level: 5 },
  { behavior: "always_allow", level: 0 },
])("rejects inconsistent policy dimensions %j", async (row) => {
  await expect(asUser(owner, () => insertPolicy(row))).rejects.toThrow();
});
it("agent dimension references existing owned agent messages, never another store", async () => {
  const conversation = randomUUID(),
    agent = randomUUID(),
    ordinary = randomUUID();
  await db.query(
    "insert into conversations(id,user_id,title) values($1,$2,'Isolated')",
    [conversation, owner],
  );
  for (const id of [agent, ordinary])
    await db.query(
      "insert into messages(id,user_id,conversation_id,role,content,metadata) values($1,$2,$3,'system','Fixture',$4::jsonb)",
      [
        id,
        owner,
        conversation,
        JSON.stringify(id === agent ? { agent_version: "agent-v1" } : {}),
      ],
    );
  await asUser(owner, async () => {
    expect(
      (
        await insertPolicy({
          subject_agent_id: agent,
          permission_class: "WRITE",
        })
      ).rows,
    ).toHaveLength(1);
    await expect(insertPolicy({ subject_agent_id: ordinary })).rejects.toThrow(
      "owned registered agent",
    );
    await expect(
      insertPolicy({ subject_agent_id: randomUUID() }),
    ).rejects.toThrow();
  });
  await expect(
    asUser(stranger, () =>
      insertPolicy({ user_id: stranger, subject_agent_id: agent }),
    ),
  ).rejects.toThrow();
});
