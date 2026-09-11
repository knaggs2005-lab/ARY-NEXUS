/** Explicit per-user worker; no service-role key, model-vendor workflow, or browser timer. */
import { loadEnvConfig } from "@next/env";
import { context, isDemo } from "../src/server/context";
loadEnvConfig(process.cwd());
if (process.env.ARY_MISSION_WORKER_ENABLED !== "true")
  throw new Error(
    "Set ARY_MISSION_WORKER_ENABLED=true to run the mission worker deliberately.",
  );
if (!isDemo() && !process.env.ARY_MISSION_ACCESS_TOKEN)
  throw new Error(
    "Provide a current user-scoped ARY_MISSION_ACCESS_TOKEN; service-role credentials are not supported.",
  );
let stopped = false;
process.on("SIGINT", () => {
  stopped = true;
});
process.on("SIGTERM", () => {
  stopped = true;
});
async function main() {
  while (!stopped) {
    try {
      const { missions, skills } = await context(
        new Request("http://127.0.0.1:3000/api/missions/worker", {
          headers: process.env.ARY_MISSION_ACCESS_TOKEN
            ? {
                authorization: `Bearer ${process.env.ARY_MISSION_ACCESS_TOKEN}`,
              }
            : {},
        }),
      );
      if (process.env.ARY_AUTOMATION_WORKER_ENABLED === "true")
        await skills.runDue();
      const result = await missions.runDue(10);
      if (result.processed.length || result.errors.length)
        console.log(JSON.stringify(result));
    } catch {
      console.error(
        "Mission worker could not authenticate or access checkpoints. No credentials logged; inspect session/migration configuration.",
      );
      process.exitCode = 1;
      break;
    }
    if (process.argv.includes("--once")) break;
    await new Promise<void>((resolve) => setTimeout(resolve, 2000));
  }
}
main().catch(() => {
  console.error("Mission worker stopped unexpectedly");
  process.exitCode = 1;
});
