import { createClient } from "@supabase/supabase-js";
import { loadEnvConfig } from "@next/env";
import { SupabaseRepository } from "../src/infrastructure/repositories/supabase";
import { services } from "../src/server/context";
import { seed } from "../src/infrastructure/seed";
loadEnvConfig(process.cwd());
async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const email = process.env.ARY_SEED_EMAIL;
  const password = process.env.ARY_SEED_PASSWORD;
  if (!url || !key || !email || !password)
    throw new Error(
      "Set Supabase URL/anon key and ARY_SEED_EMAIL / ARY_SEED_PASSWORD for an existing auth user",
    );
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password,
  });
  if (error || !data.user) throw new Error("Seed user sign-in failed");
  const { error: profileError } = await client
    .from("users")
    .upsert({ id: data.user.id }, { onConflict: "id", ignoreDuplicates: true });
  if (profileError) throw profileError;
  const deps = services(new SupabaseRepository(data.user.id, client));
  await deps.actions.run(
    "workspace.seed",
    null,
    () => seed(deps.repository, deps.entities, deps.memories),
    { source: "seed-cli" },
  );
  await client.auth.signOut();
  console.log(
    "Seeded Clevaryn, Wag Trails, and Ary Nexus for the authenticated user.",
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
