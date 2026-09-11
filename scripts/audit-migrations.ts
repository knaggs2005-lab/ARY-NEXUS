/** Read-only live audit SQL, derived from executing the actual migrations in PGlite.
 * Run with tsx; paste the emitted SQL in Supabase SQL Editor. No credentials needed.
 */
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const catalog = `
select 'table:'||c.relname as name, jsonb_build_object(
 'columns',(select jsonb_agg(jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,pg_get_expr(d.adbin,d.adrelid)) order by a.attname) from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
 'constraints',(select jsonb_agg(pg_get_constraintdef(oid) order by pg_get_constraintdef(oid) collate "C") from pg_constraint where conrelid=c.oid and contype<>'n'),
 'indexes',(select jsonb_agg(jsonb_build_array(pg_get_indexdef(indexrelid),indisvalid) order by pg_get_indexdef(indexrelid)) from pg_index where indrelid=c.oid),
 'triggers',(select jsonb_agg(jsonb_build_array(pg_get_triggerdef(oid),tgenabled) order by tgname) from pg_trigger where tgrelid=c.oid and not tgisinternal),
 'rls',c.relrowsecurity,
 'policies',(select jsonb_agg(jsonb_build_array(policyname,permissive,roles,cmd,qual,with_check) order by policyname) from pg_policies where schemaname='public' and tablename=c.relname),
 'grants',(select jsonb_agg(jsonb_build_array(r,p,has_table_privilege(r,c.oid,p)) order by r,p) from unnest(array['anon','authenticated']) r cross join unnest(array['SELECT','INSERT','UPDATE','DELETE']) p)
) as definition from pg_class c join pg_namespace n on c.relnamespace=n.oid where n.nspname='public' and c.relkind='r'
union all
select 'function:'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')', jsonb_build_object('definition',regexp_replace(regexp_replace(pg_get_functiondef(p.oid),'--[^\\n]*','','g'),'[[:space:]]+','','g'),'authenticated',has_function_privilege('authenticated',p.oid,'EXECUTE'),'anon',has_function_privilege('anon',p.oid,'EXECUTE')) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f'
`;
async function main() {
  const files = (await readdir("supabase/migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort();
  if (new Set(files.map((f) => f.split("_")[0])).size !== files.length)
    throw new Error("Duplicate migration version");
  const db = new PGlite({ extensions: { vector } });
  await db.exec(
    "create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema auth to authenticated;",
  );
  const manifest = [];
  for (const file of files) {
    const sql = await readFile(`supabase/migrations/${file}`, "utf8");
    await db.exec(sql);
    manifest.push({
      file,
      sha256: createHash("sha256").update(sql).digest("hex"),
    });
  }
  const { rows } = await db.query<{ name: string; definition: unknown }>(
    catalog,
  );
  const hashes = await db.query<{ name: string; hash: string }>(
    `select name,md5(definition::text) hash from (${catalog}) x order by name`,
  );
  const values = hashes.rows
    .map((r) => `('${r.name.replaceAll("'", "''")}','${r.hash}')`)
    .join(",\n");
  const sql = `set search_path=public;\n-- Read-only parity check generated from all ${files.length} local migrations.\nwith expected(name,hash) as (values ${values}), actual as (select name,md5(definition::text) hash from (${catalog}) x) select jsonb_build_object('expected_objects',(select count(*) from expected),'matched_objects',(select count(*) from expected e join actual a using(name) where e.hash=a.hash),'differences',(select jsonb_agg(jsonb_build_object('name',e.name,'expected',e.hash,'actual',a.hash)) from expected e left join actual a using(name) where e.hash is distinct from a.hash),'unexpected_public_objects',(select jsonb_agg(a.name) from actual a left join expected e using(name) where e.name is null)) as audit;`;
  await writeFile("/tmp/ary-migration-audit.sql", sql);
  // Emit, never execute, a guarded adoption for databases originally installed
  // in SQL Editor. This records the verified baseline, not fictional run dates.
  const cte = sql.slice(
    sql.indexOf("with expected"),
    sql.indexOf(" select jsonb_build_object('expected_objects'"),
  );
  const historyValues = manifest
    .map(({ file, sha256 }) => {
      const [version, ...name] = file.replace(/\.sql$/, "").split("_");
      return `('${version}','${name.join("_")}',array['-- Verified manual baseline; source SHA256 ${sha256}. Original execution timestamp unavailable.'])`;
    })
    .join(",\n");
  const versions = files.map((f) => `'${f.split("_")[0]}'`).join(",");
  const adoption = `-- Inspect the read-only audit first. Explicit operator application required.\nbegin;\nset local search_path=public;\ndo $integrity$ declare drift integer; begin\n${cte} select count(*) into drift from expected e full join actual a using(name) where e.hash is distinct from a.hash;\nif drift<>0 then raise exception 'Schema drift: baseline adoption refused'; end if; end $integrity$;\ncreate schema if not exists supabase_migrations;\ncreate table if not exists supabase_migrations.schema_migrations(version text primary key, statements text[], name text);\nalter table supabase_migrations.schema_migrations enable row level security;\nrevoke all on supabase_migrations.schema_migrations from anon, authenticated;\ndo $history$ begin if exists(select 1 from supabase_migrations.schema_migrations where version not in (${versions})) then raise exception 'Unexpected migration history; inspect before adoption'; end if; end $history$;\ninsert into supabase_migrations.schema_migrations(version,name,statements) values ${historyValues} on conflict(version) do nothing;\ncommit;\nselect version,name from supabase_migrations.schema_migrations order by version;`;
  await writeFile("/tmp/ary-migration-adopt.sql", adoption);
  // Exercise the generated operational SQL only in the disposable database.
  await db.exec(adoption);
  await db.exec(adoption);
  await db.exec("drop index public.actions_execution_key");
  let refusedDrift = false;
  try {
    await db.exec(adoption);
  } catch {
    refusedDrift = true;
    await db.exec("rollback");
  }
  if (!refusedDrift)
    throw new Error("Migration baseline guard accepted schema drift");
  await writeFile(
    "/tmp/ary-migration-expected.json",
    JSON.stringify({ manifest, objects: rows }, null, 2),
  );
  console.log(sql);
  await db.close();
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
