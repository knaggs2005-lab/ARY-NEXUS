import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { LocalEmbeddingProvider } from "../src/infrastructure/providers/local";
const a = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  b = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const own = "11111111-1111-4111-8111-111111111111",
  foreign = "22222222-2222-4222-8222-222222222222";
const model = new LocalEmbeddingProvider();
let db: PGlite;
beforeAll(async () => {
  db = new PGlite({ extensions: { vector } });
  // Minimal Supabase Auth contract; the actual migration is executed unchanged.
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated;
    insert into auth.users values ('${a}'),('${b}');`);
  // Supabase pre-grants table privileges. Test the real deployment defaults,
  // not only a bare PostgreSQL instance where GRANT appears restrictive.
  await db.exec(
    "alter default privileges in schema public grant all on tables to authenticated;",
  );
  await db.exec(
    await readFile("supabase/migrations/202609060001_initial.sql", "utf8"),
  );
  await db.exec(
    await readFile(
      "supabase/migrations/202609060002_memory_foundation.sql",
      "utf8",
    ),
  );
  await db.exec(
    await readFile(
      "supabase/migrations/202609060003_openai_embeddings.sql",
      "utf8",
    ),
  );
  await db.exec(
    await readFile(
      "supabase/migrations/202609060004_hybrid_retrieval.sql",
      "utf8",
    ),
  );
  // Rerunning the RPC migration must preserve data and grants.
  await db.exec(
    await readFile(
      "supabase/migrations/202609060004_hybrid_retrieval.sql",
      "utf8",
    ),
  );
  await db.exec(
    await readFile("supabase/migrations/202609060005_reflection.sql", "utf8"),
  );
  for (let i = 0; i < 2; i++)
    await db.exec(
      await readFile(
        "supabase/migrations/202609060006_brain_graph.sql",
        "utf8",
      ),
    );
  await db.exec(
    await readFile("supabase/migrations/202609060007_permissions.sql", "utf8"),
  );
  await db.exec(
    await readFile("supabase/migrations/202609060008_roi.sql", "utf8"),
  );
  await db.exec(
    await readFile(
      "supabase/migrations/202609060009_memory_sources.sql",
      "utf8",
    ),
  );
  for (let i = 0; i < 2; i++)
    await db.exec(
      await readFile(
        "supabase/migrations/202609070010_action_execution_keys.sql",
        "utf8",
      ),
    );
  for (let i = 0; i < 2; i++)
    await db.exec(
      await readFile(
        "supabase/migrations/202609070011_roi_economics.sql",
        "utf8",
      ),
    );
  for (let i = 0; i < 2; i++)
    await db.exec(
      await readFile(
        "supabase/migrations/202609070013_audit_grants.sql",
        "utf8",
      ),
    );
  await db.exec(`insert into public.users(id) values ('${a}'),('${b}');
    insert into entities(id,user_id,entity_type,name) values ('${own}','${a}','project','Ary Nexus'),('${foreign}','${b}','project','Private project');`);
  const embedding = JSON.stringify(
    await model.embed("Ary Nexus persistent memory"),
  );
  for (const user of [a, b])
    await db.query(
      "insert into memories(user_id,memory_type,content,embedding,embedding_model) values ($1,$2,$3,$4,$5)",
      [user, "fact", "Ary Nexus persistent memory", embedding, model.modelId],
    );
}, 30000);
afterAll(async () => {
  await db?.close();
});
async function asUser<T>(
  id: string,
  operation: (
    tx: Parameters<Parameters<PGlite["transaction"]>[0]>[0],
  ) => Promise<T>,
) {
  return db.transaction(async (tx) => {
    await tx.exec("set local role authenticated");
    await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [id]);
    return operation(tx);
  });
}
describe("PostgreSQL migration and tenant boundary", () => {
  it("removes Supabase default mutation grants from telemetry and review history", async () => {
    const { rows } = await db.query<{
      telemetry_update: boolean;
      telemetry_delete: boolean;
      jobs_delete: boolean;
      proposals_delete: boolean;
      telemetry_insert: boolean;
      review_update: boolean;
    }>(`select
      has_table_privilege('authenticated','public.model_calls','UPDATE') telemetry_update,
      has_table_privilege('authenticated','public.model_calls','DELETE') telemetry_delete,
      has_table_privilege('authenticated','public.reflection_jobs','DELETE') jobs_delete,
      has_table_privilege('authenticated','public.reflection_proposals','DELETE') proposals_delete,
      has_table_privilege('authenticated','public.model_calls','INSERT') telemetry_insert,
      has_table_privilege('authenticated','public.reflection_proposals','UPDATE') review_update`);
    expect(rows[0]).toEqual({
      telemetry_update: false,
      telemetry_delete: false,
      jobs_delete: false,
      proposals_delete: false,
      telemetry_insert: true,
      review_update: true,
    });
  });
  it("creates all requested tables with RLS enabled", async () => {
    const { rows } = await db.query<{
      relname: string;
      relrowsecurity: boolean;
    }>(
      "select relname,relrowsecurity from pg_class join pg_namespace n on n.oid=relnamespace where n.nspname='public' and relkind='r'",
    );
    expect(rows.map((r) => r.relname).sort()).toEqual(
      [
        "roi_cost_entries",
        "roi_outcome_entries",
        "permission_policies",
        "action_approvals",
        "reflection_jobs",
        "reflection_proposals",
        "outcome_versions",
        "model_calls",
        "entity_aliases",
        "memory_versions",
        "relationship_versions",
        "memory_sources",
        "memory_evidence",
        "memory_conflicts",
        "extraction_jobs",
        "users",
        "entities",
        "memories",
        "relationships",
        "memory_entities",
        "conversations",
        "messages",
        "goals",
        "decisions",
        "tasks",
        "actions",
        "outcomes",
      ].sort(),
    );
    expect(rows.every((r) => r.relrowsecurity)).toBe(true);
  });
  it("scopes reads and vector search to auth.uid, even with identical vectors", async () => {
    const embedding = JSON.stringify(
      await model.embed("Ary Nexus persistent memory"),
    );
    await asUser(a, async (tx) => {
      const { rows } = await tx.query<{ user_id: string }>(
        "select user_id from memories",
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].user_id).toBe(a);
      const hits = await tx.query("select * from search_memories($1,$2,$3,8)", [
        "Ary Nexus memory",
        embedding,
        model.modelId,
      ]);
      expect(hits.rows).toHaveLength(1);
      const users = await tx.query("select id from users");
      expect(users.rows).toEqual([{ id: a }]);
    });
  });
  it("rejects forged tenant writes and cross-tenant edges at the database layer", async () => {
    await expect(
      asUser(a, (tx) =>
        tx.query(
          "insert into entities(user_id,entity_type,name) values ($1,'company','forged')",
          [b],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
    await expect(
      asUser(a, (tx) =>
        tx.query(
          "insert into relationships(user_id,source_entity_id,target_entity_id,relationship_type) values ($1,$2,$3,'owns')",
          [a, own, foreign],
        ),
      ),
    ).rejects.toThrow(/foreign key/);
    await expect(
      asUser(a, (tx) =>
        tx.query(
          "insert into messages(user_id,conversation_id,role,content) values ($1,$2,'user','bad')",
          [a, foreign],
        ),
      ),
    ).rejects.toThrow(/foreign key/);
  });
  it("validates score bounds and action permissions in SQL", async () => {
    await expect(
      asUser(a, (tx) =>
        tx.query(
          "insert into memories(user_id,memory_type,content,embedding_model,importance_score) values ($1,'fact','bad','model',1.1)",
          [a],
        ),
      ),
    ).rejects.toThrow(/check constraint/);
    await expect(
      asUser(a, (tx) =>
        tx.query(
          "insert into actions(user_id,tool_name,action_type,permission_level,status) values ($1,'send','external',0,'succeeded')",
          [a],
        ),
      ),
    ).rejects.toThrow(/check constraint/);
  });
  it("excludes archived records and incompatible vectors; zero query vectors do not match everything", async () => {
    const zero = JSON.stringify(Array(384).fill(0));
    await asUser(a, async (tx) => {
      expect(
        (
          await tx.query("select * from search_memories($1,$2,$3,8)", [
            "unrelated",
            zero,
            model.modelId,
          ])
        ).rows,
      ).toHaveLength(0);
      const vector = JSON.stringify(
        await model.embed("Ary Nexus persistent memory"),
      );
      expect(
        (
          await tx.query("select * from search_memories($1,$2,$3,8)", [
            "unrelated",
            vector,
            "incompatible-model",
          ])
        ).rows,
      ).toHaveLength(0);
      await tx.exec("update memories set archived_at=now()");
      expect(
        (
          await tx.query("select * from search_memories($1,$2,$3,8)", [
            "Ary Nexus",
            vector,
            model.modelId,
          ])
        ).rows,
      ).toHaveLength(0);
    });
  });
});

it("atomically rolls back RPC writes and rejects cross-tenant evidence", async () => {
  await expect(
    asUser(a, async (tx) => {
      const id = "33333333-3333-4333-8333-333333333333";
      await tx.query("select apply_memory_batch($1::jsonb)", [
        JSON.stringify([
          {
            kind: "insert",
            table: "memories",
            id,
            data: {
              content: "rollback fixture",
              memory_type: "fact",
              embedding_model: "test",
            },
          },
          {
            kind: "insert",
            table: "memory_entities",
            data: { memory_id: id, entity_id: foreign },
          },
        ]),
      ]);
    }),
  ).rejects.toThrow();
  const rows = await db.query(
    "select id from memories where content='rollback fixture'",
  );
  expect(rows.rows).toHaveLength(0);
});
it("automatically versions edits, protects history, and enforces compare-and-swap", async () => {
  await asUser(a, async (tx) => {
    const id = "44444444-4444-4444-8444-444444444444";
    await tx.query("select apply_memory_batch($1::jsonb)", [
      JSON.stringify([
        {
          kind: "insert",
          table: "memories",
          id,
          data: {
            content: "first version",
            memory_type: "fact",
            embedding_model: "test",
          },
        },
        {
          kind: "update",
          table: "memories",
          id,
          data: { content: "second version" },
        },
      ]),
    ]);
    const { rows } = await tx.query<{ snapshot: { content: string } }>(
      "select snapshot from memory_versions where record_id=$1 order by recorded_at",
      [id],
    );
    expect(rows.map((r) => r.snapshot.content)).toEqual([
      "first version",
      "second version",
    ]);
    await tx.query("update memories set last_accessed_at=now() where id=$1", [
      id,
    ]);
    expect(
      (
        await tx.query("select id from memory_versions where record_id=$1", [
          id,
        ])
      ).rows,
    ).toHaveLength(2);
  });
  await expect(
    asUser(a, (tx) => tx.exec("delete from memory_versions")),
  ).rejects.toThrow();
  await expect(
    asUser(a, (tx) =>
      tx.query("select apply_memory_batch($1::jsonb)", [
        JSON.stringify([
          {
            kind: "update",
            table: "memories",
            id: "44444444-4444-4444-8444-444444444444",
            expected_updated_at: "2000-01-01T00:00:00Z",
            data: { content: "stale" },
          },
        ]),
      ]),
    ),
  ).rejects.toThrow();
  const foreignVersions = await asUser(b, (tx) =>
    tx.query(
      "select id from memory_versions where record_id='44444444-4444-4444-8444-444444444444'",
    ),
  );
  expect(foreignVersions.rows).toHaveLength(0);
});
it("retrieves lexical-only facts and filters non-current states", async () => {
  await asUser(a, async (tx) => {
    await tx.exec(
      "insert into memories(user_id,memory_type,content,embedding_model) values(auth.uid(),'fact','uniquelexicalword','different-model')",
    );
    const { rows } = await tx.query(
      "select * from search_memories('uniquelexicalword',null,'test',8)",
    );
    expect(rows).toHaveLength(1);
    await tx.exec(
      "update memories set status='disputed' where content='uniquelexicalword'",
    );
    expect(
      (
        await tx.query(
          "select * from search_memories('uniquelexicalword',null,'test',8)",
        )
      ).rows,
    ).toHaveLength(0);
  });
});

it("v3 retrieval isolates embedding versions and invalidates vectors after direct text edits", async () => {
  const embedding = JSON.stringify(
    await model.embed("version isolation fixture"),
  );
  for (const user of [a, b])
    await db.query(
      "insert into memories(user_id,memory_type,content,embedding,embedding_model,embedding_version,embedding_input_hash) values($1,'fact','version isolation fixture',$2,'text-embedding-3-large','fixture-v1','hash')",
      [user, embedding],
    );
  await asUser(a, async (tx) => {
    const search = (version: string) =>
      tx.query<{ id: string }>(
        "select * from search_memories_v3('unrelated', $1, 'text-embedding-3-large',8,$2,0.4)",
        [embedding, version],
      );
    expect((await search("fixture-v2")).rows).toHaveLength(0);
    const rows = (await search("fixture-v1")).rows;
    expect(rows).toHaveLength(1);
    await tx.query("update memories set content='edited fixture' where id=$1", [
      rows[0].id,
    ]);
    expect((await search("fixture-v1")).rows).toHaveLength(0);
    expect(
      (
        await tx.query(
          "select * from search_memories_v3('edited fixture',null,'text-embedding-3-large',8,'fixture-v1',0.4)",
        )
      ).rows,
    ).toHaveLength(1);
  });
});
it("model usage cannot be forged across tenants or read by another user", async () => {
  await asUser(a, (tx) =>
    tx.query(
      "insert into model_calls(user_id,operation,model,latency_ms,pricing_version,status) values($1,'embed','fixture',1,'test','failed')",
      [a],
    ),
  );
  expect(
    (await asUser(b, (tx) => tx.query("select * from model_calls"))).rows,
  ).toHaveLength(0);
  await expect(
    asUser(b, (tx) =>
      tx.query(
        "insert into model_calls(user_id,operation,model,latency_ms,pricing_version,status) values($1,'embed','fixture',1,'test','failed')",
        [a],
      ),
    ),
  ).rejects.toThrow(/row-level security/);
});

it("v4 exposes independent PostgreSQL semantic and full-text scores with tenant/status/time filters", async () => {
  const vector = JSON.stringify([1, ...Array(383).fill(0)]);
  const orthogonal = JSON.stringify([0, 1, ...Array(382).fill(0)]);
  const insert = async (user: string, content: string, value: string) =>
    (
      await db.query<{ id: string }>(
        "insert into memories(user_id,memory_type,content,embedding,embedding_model,embedding_version,embedding_input_hash) values($1,'fact',$2,$3,'hybrid-fixture','v1','hash') returning id",
        [user, content, value],
      )
    ).rows[0].id;
  const both = await insert(a, "saffron observatories", vector);
  const semanticOnly = await insert(a, "distant stars", vector);
  const textOnly = await insert(a, "saffron observatory", orthogonal);
  await insert(b, "saffron observatory", vector);
  for (const state of [
    "status='superseded'",
    "status='disputed'",
    "archived_at=now()",
    "valid_to=now()-interval '1 day'",
    "valid_from=now()+interval '1 day'",
  ]) {
    const id = await insert(a, "saffron observatory", vector);
    await db.query(`update memories set ${state} where id=$1`, [id]);
  }
  await asUser(a, async (tx) => {
    const search = (query: string, embedding: string, version = "v1") =>
      tx.query<{
        id: string;
        score: number;
        semantic_score: number | null;
        text_score: number | null;
        semantic_rank: number | null;
        text_rank: number | null;
      }>(
        "select * from search_memories_v4($1,$2,'hybrid-fixture',200,$3,0.4)",
        [query, embedding, version],
      );
    // PostgreSQL stemming matches observatories / observatory; tests the actual GIN expression.
    const hits = (await search("saffron observatory", vector)).rows;
    expect(hits.map((m) => m.id).sort()).toEqual(
      [both, semanticOnly, textOnly].sort(),
    );
    const combined = hits.find((m) => m.id === both)!;
    expect(combined.semantic_score).toBeCloseTo(1);
    expect(combined.text_score).toBeGreaterThan(0);
    expect(combined.score).toBeCloseTo(
      1 / (60 + combined.semantic_rank!) + 1 / (60 + combined.text_rank!),
      12,
    );
    expect(hits.find((m) => m.id === semanticOnly)?.text_rank).toBeNull();
    expect(hits.find((m) => m.id === textOnly)?.semantic_rank).toBeNull();
    expect(
      (await search("quasar invoices", orthogonal, "wrong-space")).rows,
    ).toEqual([]);
    const lexical = (await search("saffron observatory", vector, "wrong-space"))
      .rows;
    expect(lexical.map((m) => m.id).sort()).toEqual([both, textOnly].sort());
    expect(lexical.every((m) => m.semantic_score === null)).toBe(true);
  });
});

it("reflection queues and reviews are tenant scoped, immutable, and atomic with evidence checks", async () => {
  const conversationId = "77777777-7777-4777-8777-777777777771";
  const sourceId = "77777777-7777-4777-8777-777777777772";
  const jobId = "77777777-7777-4777-8777-777777777773";
  const proposalId = "77777777-7777-4777-8777-777777777774";
  const memoryId = "77777777-7777-4777-8777-777777777775";
  await asUser(a, async (tx) => {
    await tx.query(
      "insert into conversations(id,user_id,title) values($1,auth.uid(),'Reflection SQL fixture')",
      [conversationId],
    );
    await tx.query(
      "insert into messages(id,user_id,conversation_id,role,content) values($1,auth.uid(),$2,'user','Confirmed fixture')",
      [sourceId, conversationId],
    );
    await tx.query(
      "insert into reflection_jobs(id,user_id,conversation_id,source_message_id,version) values($1,auth.uid(),$2,$3,'rules-v1')",
      [jobId, conversationId, sourceId],
    );
    await tx.query(
      "insert into memories(id,user_id,memory_type,content,embedding_model) values($1,auth.uid(),'fact','Confirmed fixture','fixture')",
      [memoryId],
    );
    await tx.query(
      "insert into reflection_proposals(id,user_id,job_id,fingerprint,kind,noticed,reason,change,evidence) values($1,auth.uid(),$2,'test-fingerprint','memory_update','No summary','Literal summary',$3,$4)",
      [
        proposalId,
        jobId,
        JSON.stringify({
          kind: "memory_update",
          memory_id: memoryId,
          summary: "Confirmed fixture",
        }),
        JSON.stringify([
          {
            table: "memories",
            id: memoryId,
            snapshot: { content: "Confirmed fixture" },
          },
        ]),
      ],
    );
  });
  expect(
    (await asUser(b, (tx) => tx.query("select * from reflection_proposals")))
      .rows,
  ).toEqual([]);
  await expect(
    asUser(b, (tx) =>
      tx.query(
        "insert into reflection_jobs(user_id,conversation_id,source_message_id,version) values(auth.uid(),$1,$2,'v1')",
        [conversationId, sourceId],
      ),
    ),
  ).rejects.toThrow();
  await expect(
    asUser(a, (tx) =>
      tx.query(
        "update reflection_proposals set reason='tampered' where id=$1",
        [proposalId],
      ),
    ),
  ).rejects.toThrow("immutable");
  const timestamp = (
    await asUser(a, (tx) =>
      tx.query<{ updated_at: string }>(
        "select updated_at::text from memories where id=$1",
        [memoryId],
      ),
    )
  ).rows[0].updated_at;
  // Failing review must roll back the preceding memory update and its history trigger.
  await expect(
    asUser(a, (tx) =>
      tx.query("select apply_memory_batch($1)", [
        JSON.stringify([
          {
            kind: "check",
            table: "memories",
            id: memoryId,
            expected_updated_at: timestamp,
          },
          {
            kind: "update",
            table: "memories",
            id: memoryId,
            data: { summary: "Confirmed fixture" },
          },
          {
            kind: "update",
            table: "reflection_proposals",
            id: proposalId,
            data: {
              status: "accepted",
              review_reason: "",
              reviewed_at: new Date().toISOString(),
              reviewed_by: a,
            },
          },
        ]),
      ]),
    ),
  ).rejects.toThrow();
  expect(
    (
      await asUser(a, (tx) =>
        tx.query<{ summary: string }>(
          "select summary from memories where id=$1",
          [memoryId],
        ),
      )
    ).rows[0].summary,
  ).toBe("");
  await asUser(a, (tx) =>
    tx.query("select apply_memory_batch($1)", [
      JSON.stringify([
        {
          kind: "check",
          table: "memories",
          id: memoryId,
          expected_updated_at: timestamp,
        },
        {
          kind: "update",
          table: "memories",
          id: memoryId,
          data: { summary: "Confirmed fixture" },
        },
        {
          kind: "update",
          table: "reflection_proposals",
          id: proposalId,
          data: {
            status: "accepted",
            review_reason: "Reviewed literal summary",
            reviewed_at: new Date().toISOString(),
            reviewed_by: a,
            applied_changes: [
              {
                table: "memories",
                id: memoryId,
                before: { summary: "" },
                after: { summary: "Confirmed fixture" },
              },
            ],
          },
        },
      ]),
    ]),
  );
  expect(
    (
      await asUser(a, (tx) =>
        tx.query("select id from memory_versions where record_id=$1", [
          memoryId,
        ]),
      )
    ).rows,
  ).toHaveLength(2);
  await expect(
    asUser(a, (tx) =>
      tx.query(
        "update reflection_proposals set review_reason='changed mind' where id=$1",
        [proposalId],
      ),
    ),
  ).rejects.toThrow("immutable");
  await expect(
    asUser(a, (tx) =>
      tx.query("delete from reflection_proposals where id=$1", [proposalId]),
    ),
  ).rejects.toThrow();
});

it("permission policies are tenant scoped, append-only and reject foreign products", async () => {
  const scope = "permission-sql-test";
  await asUser(a, (tx) =>
    tx.query(
      "insert into permission_policies(user_id,scope_key,tool,level,reason) values ($1,$2,'memory.create',4,'Review')",
      [a, scope],
    ),
  );
  expect(
    (
      await asUser(b, (tx) =>
        tx.query("select * from permission_policies where scope_key=$1", [
          scope,
        ]),
      )
    ).rows,
  ).toHaveLength(0);
  await expect(
    asUser(a, (tx) =>
      tx.query("update permission_policies set level=5 where scope_key=$1", [
        scope,
      ]),
    ),
  ).rejects.toThrow(/permission denied/);
  await expect(
    asUser(a, (tx) =>
      tx.query("delete from permission_policies where scope_key=$1", [scope]),
    ),
  ).rejects.toThrow(/permission denied/);
  await expect(
    asUser(a, (tx) =>
      tx.query(
        "insert into permission_policies(user_id,scope_key,level,reason,product_entity_id) values ($1,'foreign-scope',0,'Foreign',$2)",
        [a, foreign],
      ),
    ),
  ).rejects.toThrow(/foreign key/);
});
it("SQL approval consumption is tenant-bound, exact, single-use and expiry checked", async () => {
  const attempt = await asUser(a, (tx) =>
    tx.query<{ id: string }>(
      "insert into actions(user_id,tool_name,action_type,permission_level,approval_required,status,metadata) values ($1,'memory.create','create',4,true,'approval_required','{\"fingerprint\":\"exact\",\"policy_hash\":\"policy\"}') returning id",
      [a],
    ),
  );
  const approval = await asUser(a, (tx) =>
    tx.query<{ id: string }>(
      "insert into action_approvals(user_id,action_id,decision,reason,fingerprint,policy_hash,expires_at) values ($1,$2,'approved','Exact request','exact','policy',now()+interval '10 minutes') returning id",
      [a, attempt.rows[0].id],
    ),
  );
  const id = approval.rows[0].id;
  const consume = (user: string, fp: string) =>
    asUser(user, (tx) =>
      tx.query<{ used: boolean }>(
        "select consume_action_approval_v1($1,$2,'policy') as used",
        [id, fp],
      ),
    );
  expect((await consume(b, "exact")).rows[0].used).toBe(false);
  expect((await consume(a, "changed")).rows[0].used).toBe(false);
  expect((await consume(a, "exact")).rows[0].used).toBe(true);
  expect((await consume(a, "exact")).rows[0].used).toBe(false);
  await expect(
    asUser(a, (tx) =>
      tx.query("update action_approvals set consumed_at=null where id=$1", [
        id,
      ]),
    ),
  ).rejects.toThrow(/permission denied/);
  await expect(
    asUser(a, (tx) =>
      tx.query("update actions set permission_level=5 where id=$1", [
        attempt.rows[0].id,
      ]),
    ),
  ).rejects.toThrow(/immutable/);
});

it("ROI SQL ledger enforces ownership, immutable revisions, and accounting validation", async () => {
  const {
    rows: [action],
  } = await db.query<{ id: string }>(
    "insert into actions(user_id,tool_name,action_type,permission_level,status) values ($1,'roi-fixture','test',5,'succeeded') returning id",
    [a],
  );
  const {
    rows: [outcome],
  } = await db.query<{ id: string }>(
    "insert into outcomes(user_id,action_id,status,summary) values ($1,$2,'success','Synthetic SQL fixture') returning id",
    [a, action.id],
  );
  const {
    rows: [first],
  } = await asUser(a, (tx) =>
    tx.query<{ id: string }>(
      "insert into roi_cost_entries(user_id,action_id,estimated_compute_cost_usd,confidence,attribution_notes) values ($1,$2,2,0.5,'fixture') returning id",
      [a, action.id],
    ),
  );
  expect(
    (await asUser(b, (tx) => tx.query("select * from roi_cost_entries"))).rows,
  ).toHaveLength(0);
  await expect(
    asUser(b, (tx) =>
      tx.query(
        "insert into roi_cost_entries(user_id,action_id,confidence,attribution_notes) values ($1,$2,1,'foreign')",
        [b, action.id],
      ),
    ),
  ).rejects.toThrow();
  await expect(
    asUser(a, (tx) =>
      tx.query(
        "update roi_cost_entries set estimated_compute_cost_usd=99 where id=$1",
        [first.id],
      ),
    ),
  ).rejects.toThrow(/permission denied/);
  await expect(
    db.query("delete from roi_cost_entries where id=$1", [first.id]),
  ).rejects.toThrow(/append-only/);
  await asUser(a, (tx) =>
    tx.query(
      "insert into roi_cost_entries(user_id,action_id,parent_id,actual_model_cost_usd,confidence,attribution_notes,evidence) values ($1,$2,$3,1,1,'correction','fixture:bill')",
      [a, action.id, first.id],
    ),
  );
  await expect(
    asUser(a, (tx) =>
      tx.query(
        "insert into roi_cost_entries(user_id,action_id,parent_id,confidence,attribution_notes) values ($1,$2,$3,1,'stale')",
        [a, action.id, first.id],
      ),
    ),
  ).rejects.toThrow(/unique/);
  await expect(
    asUser(a, (tx) =>
      tx.query(
        "insert into roi_outcome_entries(user_id,outcome_id,effective_at,status,confidence,attribution_notes,revenue_influenced_usd) values ($1,$2,now(),'estimated',0.5,'fixture',-1)",
        [a, outcome.id],
      ),
    ),
  ).rejects.toThrow(/check/);
  await expect(
    asUser(a, (tx) =>
      tx.query(
        "insert into roi_outcome_entries(user_id,outcome_id,effective_at,status,confidence,attribution_notes) values ($1,$2,now(),'confirmed',1,'fixture')",
        [a, outcome.id],
      ),
    ),
  ).rejects.toThrow(/check/);
  await asUser(a, (tx) =>
    tx.query(
      "insert into roi_outcome_entries(user_id,outcome_id,effective_at,status,confidence,attribution_notes,evidence,revenue_influenced_usd) values ($1,$2,now(),'confirmed',1,'fixture','fixture:evidence',0)",
      [a, outcome.id],
    ),
  );
  expect(
    (await asUser(b, (tx) => tx.query("select * from roi_outcome_entries")))
      .rows,
  ).toHaveLength(0);
});
it("model cost telemetry cannot be linked to another tenant's action", async () => {
  const {
    rows: [action],
  } = await db.query<{ id: string }>(
    "insert into actions(user_id,tool_name,action_type,permission_level,status) values ($1,'private','read',5,'succeeded') returning id",
    [b],
  );
  await expect(
    asUser(a, (tx) =>
      tx.query(
        "insert into model_calls(user_id,action_id,operation,model,latency_ms,pricing_version,status) values($1,$2,'reason','fixture',1,'test','succeeded')",
        [a, action.id],
      ),
    ),
  ).rejects.toThrow(/foreign key/);
});

it("captures owned source provenance without changing facts and preserves edit history", async () => {
  const {
    rows: [memory],
  } = await asUser(a, (tx) =>
    tx.query<{ id: string }>(
      "insert into memories(user_id,memory_type,embedding_model,content,metadata) values($1,'fact','fixture','Source fixture','{\"origin\":\"manual\"}') returning id",
      [a],
    ),
  );
  const sources = await asUser(a, (tx) =>
    tx.query<{ kind: string; quote: string }>(
      "select kind,quote from memory_sources where memory_id=$1",
      [memory.id],
    ),
  );
  expect(sources.rows).toEqual([{ kind: "manual", quote: "Source fixture" }]);
  await asUser(a, (tx) =>
    tx.query("update memories set content='Revised fixture' where id=$1", [
      memory.id,
    ]),
  );
  expect(
    (
      await asUser(a, (tx) =>
        tx.query("select * from memory_sources where memory_id=$1", [
          memory.id,
        ]),
      )
    ).rows,
  ).toHaveLength(2);
  expect(
    (
      await asUser(b, (tx) =>
        tx.query("select * from memory_sources where memory_id=$1", [
          memory.id,
        ]),
      )
    ).rows,
  ).toHaveLength(0);
  await expect(
    asUser(a, (tx) =>
      tx.query("delete from memory_sources where memory_id=$1", [memory.id]),
    ),
  ).rejects.toThrow(/permission denied/);
  const {
    rows: [legacy],
  } = await db.query<{ id: string }>(
    "insert into memories(user_id,memory_type,embedding_model,content) values($1,'fact','fixture','Unverified fixture') returning id",
    [a],
  );
  await db.query(
    "select write_memory_source_v1(m,'backfill') from memories m where id=$1",
    [legacy.id],
  );
  const backfill = await db.query<{ kind: string; quote: null }>(
    "select kind,quote from memory_sources where memory_id=$1",
    [legacy.id],
  );
  expect(backfill.rows).toEqual([{ kind: "legacy_unknown", quote: null }]);
});
it("SQL rejects fabricated evidence and prevents editing accepted source quotes", async () => {
  const {
    rows: [c],
  } = await db.query<{ id: string }>(
    "insert into conversations(user_id,title) values($1,'Source test') returning id",
    [a],
  );
  const {
    rows: [m],
  } = await db.query<{ id: string }>(
    "insert into messages(user_id,conversation_id,role,content) values($1,$2,'user','Exact evidence') returning id",
    [a, c.id],
  );
  const {
    rows: [fact],
  } = await db.query<{ id: string }>(
    "insert into memories(user_id,memory_type,embedding_model,content,source_message_id) values($1,'fact','fixture','Exact evidence',$2) returning id",
    [a, m.id],
  );
  await expect(
    asUser(a, (tx) =>
      tx.query(
        "insert into memory_evidence(user_id,memory_id,source_message_id,quote,evidence_type) values($1,$2,$3,'invented','supports')",
        [a, fact.id, m.id],
      ),
    ),
  ).rejects.toThrow(/Evidence must quote/);
  await asUser(a, (tx) =>
    tx.query(
      "insert into memory_evidence(user_id,memory_id,source_message_id,quote,evidence_type) values($1,$2,$3,'Exact evidence','supports')",
      [a, fact.id, m.id],
    ),
  );
  await expect(
    asUser(a, (tx) =>
      tx.query(
        "update memory_evidence set quote='modified' where memory_id=$1",
        [fact.id],
      ),
    ),
  ).rejects.toThrow(/permission denied/);
});

it("enforces durable execution keys per owner and exposes migration readiness only to authenticated callers", async () => {
  const insert = (user: string) =>
    asUser(user, (tx) =>
      tx.query(
        "insert into actions(user_id,tool_name,action_type,permission_level,status,metadata) values ($1,'mock.observe','mock_read',1,'requested',$2::jsonb)",
        [user, JSON.stringify({ execution_key: "sql-execution-key" })],
      ),
    );
  await insert(a);
  await expect(insert(a)).rejects.toThrow(/duplicate key/);
  await insert(b);
  const readiness = await asUser(a, (tx) =>
    tx.query<{ ready: boolean }>("select action_execution_ready_v1() as ready"),
  );
  expect(readiness.rows[0].ready).toBe(true);
});

it("commits task/action/outcome together and rolls back all three on a late SQL failure", async () => {
  const actionId = "ceeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  const taskId = "deeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  await asUser(a, (tx) =>
    tx.query(
      "insert into actions(id,user_id,tool_name,action_type,permission_level,status,metadata) values ($1,$2,'create_task','create_task',5,'requested',$3)",
      [
        actionId,
        a,
        JSON.stringify({ execution_key: "real-task-transaction-test" }),
      ],
    ),
  );
  const mutations = [
    {
      kind: "insert",
      table: "tasks",
      id: taskId,
      data: {
        title: "Transactional task",
        entity_id: own,
        priority: 2,
        metadata: { action_id: actionId },
      },
    },
    {
      kind: "update",
      table: "actions",
      id: actionId,
      data: {
        status: "succeeded",
        output: { completed: true, result: { task_id: taskId } },
      },
    },
    {
      kind: "insert",
      table: "outcomes",
      data: {
        action_id: actionId,
        status: "success",
        summary: "Task committed",
        metadata: {},
      },
    },
  ];
  // Task, terminal action and outcome have all been written before the final FK failure.
  await expect(
    asUser(a, (tx) =>
      tx.query("select apply_memory_batch($1::jsonb)", [
        JSON.stringify([
          ...mutations,
          {
            kind: "insert",
            table: "tasks",
            data: { title: "Invalid foreign project", entity_id: foreign },
          },
        ]),
      ]),
    ),
  ).rejects.toThrow();
  expect(
    (await db.query("select id from tasks where id=$1", [taskId])).rows,
  ).toHaveLength(0);
  expect(
    (await db.query("select status from actions where id=$1", [actionId])).rows,
  ).toEqual([{ status: "requested" }]);
  expect(
    (await db.query("select id from outcomes where action_id=$1", [actionId]))
      .rows,
  ).toHaveLength(0);
  await asUser(a, (tx) =>
    tx.query("select apply_memory_batch($1::jsonb)", [
      JSON.stringify(mutations),
    ]),
  );
  expect(
    (await db.query("select id from tasks where id=$1", [taskId])).rows,
  ).toHaveLength(1);
  expect(
    (await db.query("select status from actions where id=$1", [actionId])).rows,
  ).toEqual([{ status: "succeeded" }]);
  expect(
    (
      await db.query("select status from outcomes where action_id=$1", [
        actionId,
      ])
    ).rows,
  ).toEqual([{ status: "success" }]);
  expect(
    (
      await asUser(b, (tx) =>
        tx.query("select id from tasks where id=$1", [taskId]),
      )
    ).rows,
  ).toHaveLength(0);
});

it("atomically updates task/action/outcome and rejects stale task versions in PostgreSQL", async () => {
  const taskId = "afeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    actionId = "bfeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  await asUser(a, async (tx) => {
    await tx.query(
      "insert into tasks(id,user_id,title,entity_id) values ($1,$2,'Before update',$3)",
      [taskId, a, own],
    );
    await tx.query(
      "insert into actions(id,user_id,tool_name,action_type,permission_level,status) values ($1,$2,'update_task','update_task',5,'requested')",
      [actionId, a],
    );
  });
  const before = (
    await db.query<{ version: string }>(
      "select updated_at::text as version from tasks where id=$1",
      [taskId],
    )
  ).rows[0].version;
  const mutations = [
    {
      kind: "update",
      table: "tasks",
      id: taskId,
      expected_updated_at: before,
      data: { title: "After update", status: "completed", priority: 3 },
    },
    {
      kind: "update",
      table: "actions",
      id: actionId,
      data: {
        status: "succeeded",
        output: { completed: true, result: { task_id: taskId } },
      },
    },
    {
      kind: "insert",
      table: "outcomes",
      data: {
        action_id: actionId,
        status: "success",
        summary: "Updated task",
        metadata: {},
      },
    },
  ];
  await expect(
    asUser(a, (tx) =>
      tx.query("select apply_memory_batch($1::jsonb)", [
        JSON.stringify([
          ...mutations,
          {
            kind: "insert",
            table: "tasks",
            data: { title: "Invalid foreign project", entity_id: foreign },
          },
        ]),
      ]),
    ),
  ).rejects.toThrow();
  expect(
    (await db.query("select title,status from tasks where id=$1", [taskId]))
      .rows,
  ).toEqual([{ title: "Before update", status: "pending" }]);
  expect(
    (await db.query("select status from actions where id=$1", [actionId])).rows,
  ).toEqual([{ status: "requested" }]);
  expect(
    (await db.query("select id from outcomes where action_id=$1", [actionId]))
      .rows,
  ).toHaveLength(0);
  await asUser(a, (tx) =>
    tx.query("select apply_memory_batch($1::jsonb)", [
      JSON.stringify(mutations),
    ]),
  );
  await expect(
    asUser(a, (tx) =>
      tx.query("select apply_memory_batch($1::jsonb)", [
        JSON.stringify([mutations[0]]),
      ]),
    ),
  ).rejects.toThrow();
  expect(
    (
      await db.query("select title,status,priority from tasks where id=$1", [
        taskId,
      ])
    ).rows,
  ).toEqual([{ title: "After update", status: "completed", priority: 3 }]);
});

it("atomically commits project metadata, blocker, goal, action and outcome with rollback and temporal history", async () => {
  const projectId = "ceeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    blockerId = "cdeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    goalId = "cceeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    edgeId = "cbeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    actionId = "caeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  await asUser(a, async (tx) => {
    await tx.query(
      "insert into entities(id,user_id,entity_type,name,metadata) values ($1,$2,'project','Project test','{\"custom\":true}'),($3,$2,'task','Blocker','{}')",
      [projectId, a, blockerId],
    );
    await tx.query(
      "insert into goals(id,user_id,title) values ($1,$2,'Goal')",
      [goalId, a],
    );
    await tx.query(
      "insert into actions(id,user_id,tool_name,action_type,permission_level,status) values ($1,$2,'update_project_status','update_project_status',5,'requested')",
      [actionId, a],
    );
  });
  const version = (
    await db.query<{ v: string }>(
      "select updated_at::text v from entities where id=$1",
      [projectId],
    )
  ).rows[0].v;
  const mutations = [
    {
      kind: "update",
      table: "entities",
      id: projectId,
      expected_updated_at: version,
      data: {
        metadata: { custom: true, status: "blocked", health: "at_risk" },
      },
    },
    {
      kind: "insert",
      table: "relationships",
      id: edgeId,
      data: {
        source_entity_id: blockerId,
        target_entity_id: projectId,
        relationship_type: "blocks",
        strength: 1,
        valid_from: "2026-01-01T00:00:00Z",
        valid_to: null,
        metadata: { action_id: actionId },
      },
    },
    {
      kind: "update",
      table: "goals",
      id: goalId,
      data: { entity_id: projectId },
    },
    {
      kind: "update",
      table: "actions",
      id: actionId,
      data: {
        status: "succeeded",
        output: { result: { project_id: projectId } },
      },
    },
    {
      kind: "insert",
      table: "outcomes",
      data: {
        action_id: actionId,
        status: "success",
        summary: "Project saved",
        metadata: {},
      },
    },
  ];
  const apply = (m: unknown[]) =>
    asUser(a, (tx) =>
      tx.query("select apply_memory_batch($1::jsonb)", [JSON.stringify(m)]),
    );
  await expect(
    apply([
      ...mutations,
      {
        kind: "insert",
        table: "tasks",
        data: { title: "Foreign reference", entity_id: foreign },
      },
    ]),
  ).rejects.toThrow();
  expect(
    (await db.query("select metadata from entities where id=$1", [projectId]))
      .rows,
  ).toEqual([{ metadata: { custom: true } }]);
  expect(
    (await db.query("select entity_id from goals where id=$1", [goalId])).rows,
  ).toEqual([{ entity_id: null }]);
  expect(
    (await db.query("select id from relationships where id=$1", [edgeId])).rows,
  ).toHaveLength(0);
  expect(
    (await db.query("select status from actions where id=$1", [actionId])).rows,
  ).toEqual([{ status: "requested" }]);
  expect(
    (await db.query("select id from outcomes where action_id=$1", [actionId]))
      .rows,
  ).toHaveLength(0);
  await apply(mutations);
  await expect(apply([mutations[0]])).rejects.toThrow();
  await apply([
    {
      kind: "update",
      table: "relationships",
      id: edgeId,
      data: { valid_to: "2026-02-01T00:00:00Z" },
    },
  ]);
  await apply([
    {
      kind: "update",
      table: "relationships",
      id: edgeId,
      data: { valid_from: "2026-03-01T00:00:00Z", valid_to: null },
    },
  ]);
  expect(
    (await db.query("select id from relationships where id=$1", [edgeId])).rows,
  ).toHaveLength(1);
  expect(
    (
      await db.query(
        "select id from relationship_versions where record_id=$1",
        [edgeId],
      )
    ).rows,
  ).toHaveLength(3);
  expect(
    (
      await asUser(b, (tx) =>
        tx.query("select id from entities where id=$1", [projectId]),
      )
    ).rows,
  ).toHaveLength(0);
});

it("keeps additional compute/tool costs in the existing protected append-only ledger", async () => {
  const {
    rows: [action],
  } = await db.query<{ id: string }>(
    "insert into actions(user_id,tool_name,action_type,permission_level,status) values ($1,'fixture','read',1,'succeeded') returning id",
    [a],
  );
  const {
    rows: [cost],
  } = await asUser(a, (tx) =>
    tx.query<{ id: string; tool_cost_usd: number }>(
      "insert into roi_cost_entries(user_id,action_id,additional_compute_cost_usd,tool_cost_usd,confidence,attribution_notes) values ($1,$2,2,3,0.5,'fixture additional costs') returning id,tool_cost_usd",
      [a, action.id],
    ),
  );
  expect(cost.tool_cost_usd).toBe(3);
  expect(
    (
      await asUser(b, (tx) =>
        tx.query("select id from roi_cost_entries where id=$1", [cost.id]),
      )
    ).rows,
  ).toEqual([]);
  await expect(
    asUser(a, (tx) =>
      tx.query("update roi_cost_entries set tool_cost_usd=5 where id=$1", [
        cost.id,
      ]),
    ),
  ).rejects.toThrow();
  await expect(
    asUser(a, (tx) =>
      tx.query(
        "insert into roi_cost_entries(user_id,action_id,parent_id,tool_cost_usd,confidence,attribution_notes) values ($1,$2,$3,-1,0.5,'invalid')",
        [a, action.id, cost.id],
      ),
    ),
  ).rejects.toThrow();
});
