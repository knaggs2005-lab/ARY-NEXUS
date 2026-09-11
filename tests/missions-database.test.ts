import { afterAll, beforeAll, expect, it } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { newMission } from "../src/domain/mission";
let db: PGlite;
const owner = randomUUID(),
  stranger = randomUUID(),
  conversation = randomUUID(),
  id = randomUUID(),
  source = randomUUID();
const plan = {
  version: "orchestrator-v1",
  id,
  conversation_id: conversation,
  source_message_id: source,
  goal: "Durable test",
  spec: { title: "Durable test", steps: [], questions: [] },
  states: {},
  status: "planned",
  revision: 0,
  events: [],
  summary: "Draft",
  entity_ids: [],
  memory_ids: [],
  model: "not-planned",
  mission: newMission(),
};
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
    await readFile(
      "supabase/migrations/202609090015_durable_missions.sql",
      "utf8",
    ),
  );
  await db.exec(
    `insert into auth.users values('${owner}'),('${stranger}');insert into users(id) values('${owner}'),('${stranger}');insert into conversations(id,user_id,title) values('${conversation}','${owner}','Mission fixture');`,
  );
  await db.query(
    "insert into messages(id,user_id,conversation_id,role,content,metadata) values($1,$2,$3,'assistant','Draft',$4::jsonb)",
    [
      id,
      owner,
      conversation,
      JSON.stringify({ orchestrator_version: "orchestrator-v1", plan }),
    ],
  );
});
afterAll(async () => db.close());
async function asUser<T>(user: string, work: () => Promise<T>) {
  await db.exec(
    `set role authenticated;select set_config('request.jwt.claim.sub','${user}',false)`,
  );
  try {
    return await work();
  } finally {
    await db.exec("rollback;reset role");
  }
}
async function claim(token: string) {
  return (
    await db.query<{ ok: boolean }>(
      "select nexus_claim_mission_v1($1,$2,1000) ok",
      [id, token],
    )
  ).rows[0].ok;
}
async function current() {
  return (
    await db.query<{ updated_at: Date; metadata: { plan: typeof plan } }>(
      "select updated_at,metadata from messages where id=$1",
      [id],
    )
  ).rows[0];
}
it("migration is rerunnable; only one lease can own a plan", () =>
  asUser(owner, async () => {
    const token = randomUUID();
    expect(await claim(token)).toBe(true);
    expect(await claim(randomUUID())).toBe(false);
    await db.query("select nexus_release_mission_v1($1,$2)", [id, token]);
  }));
it("rejects foreign owner claims and hides the record", () =>
  asUser(stranger, async () => {
    await expect(claim(randomUUID())).rejects.toThrow();
    expect(await current()).toBeUndefined();
  }));
it("rejects stale tokens and CAS revisions without changing the checkpoint", () =>
  asUser(owner, async () => {
    const token = randomUUID();
    await claim(token);
    const before = await current();
    await expect(
      db.query("select nexus_checkpoint_mission_v1($1,$2,$3,$4::jsonb)", [
        id,
        randomUUID(),
        before.updated_at,
        JSON.stringify({ ...plan, revision: 1 }),
      ]),
    ).rejects.toThrow(/conflict/);
    await expect(
      db.query("select nexus_checkpoint_mission_v1($1,$2,$3,$4::jsonb)", [
        id,
        token,
        new Date(0),
        JSON.stringify({ ...plan, revision: 1 }),
      ]),
    ).rejects.toThrow(/conflict/);
    expect((await current()).metadata.plan.revision).toBe(0);
    await db.query("select nexus_release_mission_v1($1,$2)", [id, token]);
  }));
it("atomically commits checkpoint and normalized lifecycle event", () =>
  asUser(owner, async () => {
    const token = randomUUID();
    await claim(token);
    const before = await current();
    const next = {
      ...plan,
      revision: 1,
      mission: { ...plan.mission, state: "PLANNING" },
    };
    await db.query("select nexus_checkpoint_mission_v1($1,$2,$3,$4::jsonb)", [
      id,
      token,
      before.updated_at,
      JSON.stringify(next),
    ]);
    expect((await current()).metadata.plan.mission.state).toBe("PLANNING");
    const e = await db.query<{ type: string; payload: unknown }>(
      "select type,payload from nexus_events where mission_id=$1 and type='mission.planning'",
      [id],
    );
    expect(e.rows).toHaveLength(1);
    expect(JSON.stringify(e.rows)).not.toContain("Durable test");
    await db.query("select nexus_release_mission_v1($1,$2)", [id, token]);
  }));
it("expired owners cannot publish even if no replacement worker claimed", () =>
  asUser(owner, async () => {
    const token = randomUUID();
    await claim(token);
    await db.query(
      "update messages set metadata=jsonb_set(metadata,'{mission_lease,until}',to_jsonb('2000-01-01T00:00:00Z'::text)) where id=$1",
      [id],
    );
    const before = await current();
    await expect(
      db.query("select nexus_checkpoint_mission_v1($1,$2,$3,$4::jsonb)", [
        id,
        token,
        before.updated_at,
        JSON.stringify(plan),
      ]),
    ).rejects.toThrow(/conflict/);
    const replacement = randomUUID();
    expect(await claim(replacement)).toBe(true);
    await db.query("select nexus_release_mission_v1($1,$2)", [id, token]);
    expect(await claim(randomUUID())).toBe(false);
    await db.query("select nexus_release_mission_v1($1,$2)", [id, replacement]);
  }));
it("rejects invalid state and source identity replacement", () =>
  asUser(owner, async () => {
    const token = randomUUID();
    await claim(token);
    const before = await current();
    for (const next of [
      { ...plan, mission: { ...plan.mission, state: "FAKE" } },
      { ...plan, conversation_id: randomUUID() },
    ])
      await expect(
        db.query("select nexus_checkpoint_mission_v1($1,$2,$3,$4::jsonb)", [
          id,
          token,
          before.updated_at,
          JSON.stringify(next),
        ]),
      ).rejects.toThrow(/Invalid/);
    await db.query("select nexus_release_mission_v1($1,$2)", [id, token]);
  }));
