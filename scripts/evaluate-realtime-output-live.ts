import { loadEnvConfig } from "@next/env";
import { OpenAIRealtimeSessionProvider } from "../src/infrastructure/providers/openai-realtime";
import { OpenAIRealtimeWebSocketTransport } from "../src/infrastructure/providers/openai-realtime-transport";
loadEnvConfig(process.cwd(), true);
async function main() {
  const key = process.env.OPENAI_API_KEY,
    model = process.env.OPENAI_REALTIME_MODEL;
  if (!key || !model) throw new Error("CONFIGURATION_REQUIRED");
  const transport = new OpenAIRealtimeWebSocketTransport(key, model);
  const provider = new OpenAIRealtimeSessionProvider(() => transport);
  const session = await provider.createSession({
    user_id: crypto.randomUUID(),
    conversation_id: crypto.randomUUID(),
    classic_fallback_available: false,
  });
  let chunks = 0,
    bytes = 0,
    first = 0;
  const started = performance.now();
  let timer: ReturnType<typeof setTimeout>;
  try {
    await new Promise<void>((resolve, reject) => {
      timer = setTimeout(() => reject(new Error("OUTPUT_TIMEOUT")), 15000);
      session.onEvent((event) => {
        if (event.type === "failure") reject(new Error(event.failure.code));
        if (event.type === "assistant_audio_delta") {
          if (
            event.frame.encoding !== "pcm16" ||
            event.frame.sample_rate_hz !== 24000 ||
            event.frame.channels !== 1
          )
            return reject(new Error("OUTPUT_FORMAT_MISMATCH"));
          chunks++;
          bytes += event.frame.data.byteLength;
          first ||= performance.now() - started;
        }
        if (event.type === "state" && event.state === "IDLE")
          chunks ? resolve() : reject(new Error("NO_AUDIO"));
      });
      transport.send({
        type: "response.create",
        response: {
          conversation: "none",
          input: [],
          instructions: "Say exactly: Ary audio ready.",
          max_output_tokens: 64,
        },
      });
    });
    console.log(
      JSON.stringify({
        REALTIME_OUTPUT: "PASS",
        chunks,
        bytes,
        sample_rate_hz: 24000,
        channels: 1,
        first_audio_received_ms: Math.round(first),
        physical_playback: "NOT_RUN",
      }),
    );
  } finally {
    clearTimeout(timer!);
    await session.close();
  }
}
main().catch(() => {
  console.error("REALTIME_OUTPUT: FAIL (sanitized; no audio logged)");
  process.exitCode = 1;
});
