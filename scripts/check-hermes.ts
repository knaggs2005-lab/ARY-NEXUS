/** Read-only live readiness probe. No job submission, tool execution or credentials in output. */
import { loadEnvConfig } from "@next/env";
import { HermesAgentProvider } from "../src/infrastructure/agents/hermes-agent-provider";
async function main() {
  const flag = process.argv.indexOf("--env-dir");
  loadEnvConfig(flag >= 0 ? process.argv[flag + 1] : process.cwd());
  const health = await new HermesAgentProvider().healthCheck();
  console.log(
    JSON.stringify(
      {
        health,
        liveJobTest: "not_run",
        sideEffects:
          "This command only checks capabilities and tool inventory; no job is submitted",
      },
      null,
      2,
    ),
  );
  if (health.status !== "ready") process.exitCode = 2;
}
main().catch(() => {
  console.error("Hermes readiness check failed; no sensitive details logged");
  process.exitCode = 1;
});
