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
  const t = new OpenAIRealtimeWebSocketTransport(key, model);
  try {
    await t.connect((e) => {
      if (e.type === "session.created") console.log("session.created observed");
    });
    await t.close();
    console.log("PASS: realtime handshake and clean close");
  } catch (e) {
    console.log(`FAIL: ${e instanceof Error ? e.message : "provider error"}`);
    process.exitCode = 1;
  }
}
main();
