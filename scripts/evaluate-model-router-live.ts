/** One paid, synthetic OpenAI request. No repository/database records or credentials are written. */
import { loadEnvConfig } from "@next/env";
import {
  OpenAIResponsesProvider,
  OPENAI_REASONING_MODEL,
} from "../src/infrastructure/providers/openai";
import { createModelRouter } from "../src/infrastructure/providers/model-router-config";
async function main() {
  if (!process.argv.includes("--live"))
    throw new Error("Pass --live to authorize this synthetic provider check");
  loadEnvConfig(process.cwd());
  if (!process.env.OPENAI_API_KEY?.trim())
    throw new Error("OPENAI_API_KEY is not configured");
  const model = process.env.OPENAI_REASONING_MODEL || OPENAI_REASONING_MODEL;
  const router = createModelRouter(
    new OpenAIResponsesProvider(async () => {}, model),
    "openai",
    async () => {},
    async () => {},
    undefined,
    true,
  );
  const r = await router.reasonWithUsage({
    input: "Reply with the words Router ready.",
    intent: "general",
    entities: [],
    memories: [],
    history: [],
  });
  if (r.provider !== "openai" || !r.content.trim())
    throw new Error(
      "Configured OpenAI model did not complete; inspect routing/configuration",
    );
  console.log(
    JSON.stringify({
      success: true,
      provider: r.provider,
      model: r.model,
      latency_ms: r.routing?.latency_ms,
      input_tokens: r.metrics.input_tokens,
      output_tokens: r.metrics.output_tokens,
      estimated_cost_usd: r.metrics.estimated_cost_usd,
      routing: r.routing?.reason,
    }),
  );
}
main().catch(() => {
  console.error(
    "Live routing verification failed. No settings or stored data were changed.",
  );
  process.exitCode = 1;
});
