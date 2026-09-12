import { loadEnvConfig } from "@next/env";
import { OpenAIRealtimeSessionProvider } from "../src/infrastructure/providers/openai-realtime";
import { OpenAIRealtimeWebSocketTransport } from "../src/infrastructure/providers/openai-realtime-transport";
import { silentTimingContext } from "./profile-realtime-voice";
import { RealtimePlayback } from "../src/components/voice/realtime-playback";
import { RealtimeOutputClient } from "../src/components/voice/realtime-output-client";
import { RealtimeOutputStream } from "../src/services/realtime-output-stream";
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
  let playbackFailure = false;
  const stream = new RealtimeOutputStream(() => {
    playbackFailure = true;
  });
  const playback = new RealtimePlayback(silentTimingContext);
  await playback.start();
  const client = new RealtimeOutputClient(
    async () => stream.open(new AbortController().signal),
    playback,
    () => {
      playbackFailure = true;
    },
  );
  await client.open("bounded-diagnostic");
  const off = session.onEvent((event) => stream.publish(event));
  let chunks = 0,
    bytes = 0,
    first = 0,
    virtualEnd = 0,
    peakQueueMs = 0;
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
          const elapsed = performance.now() - started;
          first ||= elapsed;
          virtualEnd =
            Math.max(elapsed + 15, virtualEnd) +
            event.frame.data.byteLength / 48;
          peakQueueMs = Math.max(peakQueueMs, virtualEnd - elapsed);
        }
        if (event.type === "state" && event.state === "IDLE")
          chunks ? resolve() : reject(new Error("NO_AUDIO"));
      });
      session.speakText!("Ary audio ready.");
    });
    await stream.drained();
    for (let i = 0; i < 20; i++) await Promise.resolve();
    if (playbackFailure || playback.snapshot().audio_bytes_received !== bytes)
      throw new Error("OUTPUT_PACING_FAILED");
    console.log(
      JSON.stringify({
        REALTIME_OUTPUT: "PASS",
        chunks,
        bytes,
        sample_rate_hz: 24000,
        channels: 1,
        first_audio_received_ms: Math.round(first),
        physical_playback: "NOT_RUN",
        virtual_playback_peak_queue_ms: Math.round(peakQueueMs),
        unpaced_burst_fits_one_second_budget: peakQueueMs <= 1000,
        paced_silent_playback: "PASS",
        paced_audio_bytes: playback.snapshot().audio_bytes_received,
        final_playback_queue_ms: Math.round(
          playback.snapshot().queued_audio_ms,
        ),
        server_peak_queued_bytes: stream.metrics().peak_queued_audio_bytes,
      }),
    );
  } finally {
    clearTimeout(timer!);
    off();
    stream.close();
    await client.close();
    await session.close();
  }
}
main().catch(() => {
  console.error("REALTIME_OUTPUT: FAIL (sanitized; no audio logged)");
  process.exitCode = 1;
});
