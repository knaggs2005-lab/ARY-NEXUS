import { createClient } from "@supabase/supabase-js";
import { loadEnvConfig } from "@next/env";
import { resolve } from "node:path";
import { LocalRepository } from "../src/infrastructure/repositories/local";
import { SupabaseRepository } from "../src/infrastructure/repositories/supabase";
import { DEMO_USER, services } from "../src/server/context";
import type { Repository } from "../src/domain/repository";
loadEnvConfig(process.cwd());
async function main() {
  let repository: Repository;
  let cleanup = async () => {};
  if (
    process.env.ARY_STORAGE === "demo" &&
    process.env.NODE_ENV !== "production"
  )
    repository = new LocalRepository(DEMO_USER, resolve(".data/demo.json"));
  else if (process.env.ARY_STORAGE === "supabase") {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
      key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      email = process.env.ARY_SEED_EMAIL,
      password = process.env.ARY_SEED_PASSWORD;
    if (!url || !key || !email || !password)
      throw new Error(
        "Set Supabase configuration and ARY_SEED_EMAIL / ARY_SEED_PASSWORD",
      );
    const client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await client.auth.signInWithPassword({
      email,
      password,
    });
    if (error || !data.user) throw new Error("Maintenance user sign-in failed");
    repository = new SupabaseRepository(data.user.id, client);
    cleanup = async () => {
      await client.auth.signOut();
    };
  } else throw new Error("Configure storage before re-indexing");
  try {
    const { reembedding, actions } = services(repository);
    const dryRun = process.argv.includes("--dry-run");
    do {
      const result = await actions.run(
        "memory.reembed",
        null,
        () => reembedding.run(50, dryRun),
        { source: "maintenance-cli", limit: 50, dry_run: dryRun },
      );
      console.log(JSON.stringify(result));
      if (result.failed) {
        process.exitCode = 1;
        break;
      }
      if (dryRun || result.remaining === 0 || result.updated === 0) break;
    } while (true);
  } finally {
    await cleanup();
  }
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Re-embedding failed");
  process.exitCode = 1;
});
