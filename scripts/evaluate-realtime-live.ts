import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
import { OpenAIRealtimeWebSocketTransport } from "../src/infrastructure/providers/openai-realtime-transport";
async function main() {
  const key = process.env.OPENAI_API_KEY?.trim(),
    model = process.env.OPENAI_REALTIME_MODEL?.trim();
  if (!key || !model) {
    console.log(
      "SKIPPED: OPENAI_API_KEY or OPENAI_REALTIME_MODEL is not configured",
    );
    return;
  }
  const t = new OpenAIRealtimeWebSocketTransport(
    key,
    model,
    undefined,
    10000,
    console.log,
  );
  try {
    console.log("CONNECTING");
    await t.connect(() => {});
    await t.close();
    console.log("PASS");
  } catch (e) {
    const d = t.getDiagnostics();
    console.log(`FAIL: ${e instanceof Error ? e.message : "provider error"}`);
    console.log(`close_code: ${d.close_code ?? "unknown"}`);
    console.log(`close_reason: ${d.close_reason || "unknown"}`);
    console.log(`last_event: ${d.last_event_type || "none"}`);
    process.exitCode = 1;
  } finally {
    await t.close();
  }
}
main();
