import { beforeAll, afterAll, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { readdir, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
let db: PGlite;
const owner = randomUUID(),
  stranger = randomUUID();
const migration = "supabase/migrations/202609090016_nexus_memory.sql";
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
async function memory() {
  const id = randomUUID();
  const result = await db.query<{ id: string; updated_at: string }>(
    "insert into public.memories(id,user_id,memory_type,content,summary,embedding_model,metadata) values($1,$2,'fact','Isolated evidence','Fixture','local-concepts-v1:384','{\"origin\":\"manual\"}') returning id,updated_at::text",
    [id, owner],
  );
  return result.rows[0];
}
async function batch(m: unknown[]) {
  await db.query("select public.apply_memory_batch($1::jsonb)", [
    JSON.stringify(m),
  ]);
}
it("rerunnable migration preserves canonical memory table and owner-isolated knowledge", async () => {
  const id = randomUUID();
  await asUser(owner, () =>
    batch([
      {
        kind: "insert",
        table: "knowledge_documents",
        id,
        data: {
          title: "Reference",
          content: "Isolated reference",
          reference: "Manual 1",
          confidence: 0.7,
        },
      },
    ]),
  );
  await asUser(stranger, async () => {
    expect(
      (
        await db.query("select * from public.knowledge_documents where id=$1", [
          id,
        ])
      ).rows,
    ).toHaveLength(0);
  });
  await asUser(owner, async () => {
    expect(
      (
        await db.query("select * from public.knowledge_documents where id=$1", [
          id,
        ])
      ).rows,
    ).toHaveLength(1);
    expect(
      (await db.query("select * from public.memories where id=$1", [id])).rows,
    ).toHaveLength(0);
  });
});
it("knowledge keeps immutable revisions and rejects duplicate successors", async () => {
  const id = randomUUID(),
    next = randomUUID();
  await asUser(owner, () =>
    batch([
      {
        kind: "insert",
        table: "knowledge_documents",
        id,
        data: {
          title: "Original",
          content: "Version one",
          reference: "Manual 1",
          confidence: 0.8,
        },
      },
      {
        kind: "insert",
        table: "knowledge_documents",
        id: next,
        data: {
          title: "Revised",
          content: "Version two",
          reference: "Manual 2",
          confidence: 0.8,
          supersedes_id: id,
        },
      },
    ]),
  );
  await expect(
    asUser(owner, () =>
      batch([
        {
          kind: "update",
          table: "knowledge_documents",
          id,
          data: { content: "Silent edit" },
        },
      ]),
    ),
  ).rejects.toThrow("versioned");
  await expect(
    asUser(owner, () =>
      batch([
        {
          kind: "insert",
          table: "knowledge_documents",
          data: {
            title: "Fork",
            content: "Version fork",
            reference: "Manual 3",
            confidence: 0.8,
            supersedes_id: id,
          },
        },
      ]),
    ),
  ).rejects.toThrow();
});
it("deletion removes evidence and versions atomically under the owning user", async () => {
  const m = await memory();
  await asUser(owner, () =>
    batch([
      {
        kind: "delete_memory",
        table: "memories",
        id: m.id,
        expected_updated_at: m.updated_at,
      },
    ]),
  );
  for (const table of ["memories", "memory_sources", "memory_versions"]) {
    const column =
      table === "memories"
        ? "id"
        : table === "memory_sources"
          ? "memory_id"
          : "record_id";
    expect(
      (
        await db.query(`select * from public.${table} where ${column}=$1`, [
          m.id,
        ])
      ).rows,
    ).toHaveLength(0);
  }
});
it("failed trailing mutation rolls back deletion including immutable history", async () => {
  const m = await memory();
  await expect(
    asUser(owner, () =>
      batch([
        {
          kind: "delete_memory",
          table: "memories",
          id: m.id,
          expected_updated_at: m.updated_at,
        },
        {
          kind: "check",
          table: "entities",
          id: randomUUID(),
          expected_updated_at: m.updated_at,
        },
      ]),
    ),
  ).rejects.toThrow();
  expect(
    (await db.query("select * from memories where id=$1", [m.id])).rows,
  ).toHaveLength(1);
  expect(
    (await db.query("select * from memory_sources where memory_id=$1", [m.id]))
      .rows,
  ).toHaveLength(1);
  expect(
    (await db.query("select * from memory_versions where record_id=$1", [m.id]))
      .rows,
  ).toHaveLength(1);
});
it("rejects foreign-user, missing revision, stale revision and arbitrary deletion targets", async () => {
  const m = await memory();
  await expect(
    asUser(stranger, () =>
      batch([
        {
          kind: "delete_memory",
          table: "memories",
          id: m.id,
          expected_updated_at: m.updated_at,
        },
      ]),
    ),
  ).rejects.toThrow();
  await expect(
    asUser(owner, () =>
      batch([{ kind: "delete_memory", table: "memories", id: m.id }]),
    ),
  ).rejects.toThrow();
  await expect(
    asUser(owner, () =>
      batch([
        {
          kind: "delete_memory",
          table: "memories",
          id: m.id,
          expected_updated_at: "2000-01-01T00:00:00Z",
        },
      ]),
    ),
  ).rejects.toThrow();
  await expect(
    asUser(owner, () =>
      batch([
        {
          kind: "delete_memory",
          table: "entities",
          id: m.id,
          expected_updated_at: m.updated_at,
        },
      ]),
    ),
  ).rejects.toThrow();
  expect(
    (await db.query("select * from memories where id=$1", [m.id])).rows,
  ).toHaveLength(1);
});
it("cannot delete evidence backing another memory version or consolidation", async () => {
  const m = await memory(),
    derived = await memory();
  await db.query(
    "update public.memories set metadata=jsonb_build_object('nexus_memory',jsonb_build_object('consolidated_from',jsonb_build_array(jsonb_build_object('id',$1::text)))) where id=$2",
    [m.id, derived.id],
  );
  await expect(
    asUser(owner, () =>
      batch([
        {
          kind: "delete_memory",
          table: "memories",
          id: m.id,
          expected_updated_at: m.updated_at,
        },
      ]),
    ),
  ).rejects.toThrow("dependants");
  expect(
    (await db.query("select * from memories where id=$1", [m.id])).rows,
  ).toHaveLength(1);
});
it("knowledge refuses entity references owned by another user", async () => {
  const id = randomUUID();
  await db.query(
    "insert into public.entities(id,user_id,entity_type,name) values($1,$2,'project','Private')",
    [id, stranger],
  );
  await expect(
    asUser(owner, () =>
      batch([
        {
          kind: "insert",
          table: "knowledge_documents",
          data: {
            title: "Reference",
            content: "Not allowed",
            reference: "Manual 1",
            confidence: 0.8,
            entity_ids: [id],
          },
        },
      ]),
    ),
  ).rejects.toThrow("entity not found");
});
it("filters working scope and expiry before SQL candidate limits", async () => {
  const m = await memory(),
    conversation = randomUUID();
  await db.query(
    `insert into public.memories(user_id,memory_type,content,summary,embedding_model,metadata) select $1,'fact','Isolated evidence','Fixture','local-concepts-v1:384',jsonb_build_object('nexus_memory',jsonb_build_object('class','WORKING','conversation_id',$2::text,'expires_at',(now()+interval '1 hour')::text)) from generate_series(1,110)`,
    [owner, conversation],
  );
  await asUser(owner, async () => {
    const result = await db.query<{ id: string }>(
      "select * from public.search_memories_v5('Isolated evidence',null,'local-concepts-v1:384',200,'legacy-v1',0.2,null)",
    );
    expect(result.rows.some((r) => r.id === m.id)).toBe(true);
    expect(result.rows.length).toBeLessThan(100);
  });
  const expired = await memory();
  await db.query(
    `update public.memories set metadata=jsonb_build_object('nexus_memory',jsonb_build_object('class','WORKING','conversation_id',$1::text,'expires_at',(now()-interval '1 hour')::text)) where id=$2`,
    [conversation, expired.id],
  );
  await asUser(owner, async () => {
    const result = await db.query<{ id: string }>(
      "select * from public.search_memories_v5('Isolated evidence',null,'local-concepts-v1:384',200,'legacy-v1',0.2,$1)",
      [conversation],
    );
    expect(result.rows.some((r) => r.id === expired.id)).toBe(false);
  });
});
