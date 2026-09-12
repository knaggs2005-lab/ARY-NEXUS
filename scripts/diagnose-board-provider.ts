import { loadEnvConfig } from "@next/env";
import { OpenAIResponsesProvider } from "../src/infrastructure/providers/openai";
import { createModelRouter } from "../src/infrastructure/providers/model-router-config";
loadEnvConfig(process.cwd());
async function main() {
  const provider = createModelRouter(
    new OpenAIResponsesProvider(async () => {}),
    "openai",
    async () => {},
    async () => {},
  );
  const started = performance.now();
  try {
    const result = await provider.reasonWithUsage({
      input:
        'Return ONLY JSON: {"summary":"diagnostic","findings":[],"order":[],"plan":[]}',
      intent: "advisory_board",
      entities: [],
      memories: [],
      history: [],
    });
    console.log(
      JSON.stringify({
        route_selected: result.routing?.selected ?? null,
        provider: result.routing?.attempts.at(-1)?.provider ?? result.provider,
        model: result.routing?.attempts.at(-1)?.model ?? result.model,
        provider_call_attempted: Boolean(result.routing?.attempts.length),
        elapsed_ms:
          result.routing?.latency_ms ?? Math.round(performance.now() - started),
        provider_error: result.routing?.attempts.at(-1)?.error_code ?? null,
        response_received:
          result.routing?.attempts.at(-1)?.status === "succeeded",
        json_parsing_attempted: true,
        json_parsing_failure: (() => {
          try {
            JSON.parse(result.content);
            return null;
          } catch (error) {
            return error instanceof Error ? error.message : "invalid JSON";
          }
        })(),
        fallback_reason: result.routing?.reason ?? null,
      }),
    );
  } catch (error) {
    const e = error as {
      code?: string;
      routing?: {
        selected?: string | null;
        attempts?: Array<{
          provider?: string;
          model?: string;
          error_code?: string;
          status?: string;
        }>;
        latency_ms?: number;
        reason?: string;
      };
    };
    const trace = e.routing;
    const attempt = trace?.attempts?.at(-1);
    console.log(
      JSON.stringify({
        route_selected: trace?.selected ?? null,
        provider: attempt?.provider ?? "openai",
        model:
          attempt?.model ?? process.env.OPENAI_REASONING_MODEL ?? "gpt-5.6-sol",
        provider_call_attempted: true,
        elapsed_ms:
          trace?.latency_ms ?? Math.round(performance.now() - started),
        provider_error: attempt?.error_code ?? e.code ?? "unknown",
        response_received: attempt?.status === "succeeded",
        json_parsing_attempted: true,
        json_parsing_failure:
          "provider did not return a board response; fallback text was not parsed as board JSON",
        fallback_reason:
          trace?.reason ?? (error instanceof Error ? error.message : "unknown"),
      }),
    );
  }
}
void main();
