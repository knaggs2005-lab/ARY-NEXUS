import { pathToFileURL } from "node:url";
import { RealtimePlayback } from "../src/components/voice/realtime-playback";
import { RealtimeOutputClient } from "../src/components/voice/realtime-output-client";
import { RealtimeOutputStream } from "../src/services/realtime-output-stream";
import { RealtimeBrainBridge } from "../src/services/realtime-brain-bridge";
import { RealtimeVoiceRelayService } from "../src/services/realtime-voice-relay-service";
import type {
  RealtimeVoiceEvent,
  RealtimeVoiceSession,
} from "../src/domain/realtime-voice";
/** Timing-only AudioContext double. It has no connection to an output device. */
export function silentTimingContext() {
  const start = performance.now();
  const context = {
    get currentTime() {
      return (performance.now() - start) / 1000;
    },
    destination: {},
    resume: async () => {},
    close: async () => {},
    createBuffer: (_c: number, n: number) => ({
      getChannelData: () => new Float32Array(n),
    }),
    createBufferSource: () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      return {
        buffer: null,
        connect() {},
        disconnect() {},
        onended: null as (() => void) | null,
        start(_time: number) {},
        stop() {
          clearTimeout(timer);
        },
      };
    },
  };
  return context as unknown as AudioContext;
}
export async function profileVoice() {
  const events = new Set<(event: RealtimeVoiceEvent) => void>();
  let brainAt = 0;
  const session: RealtimeVoiceSession = {
    id: "synthetic",
    nexus_conversation_id: "fixture",
    provider_session_id: null,
    state: "IDLE",
    sendAudio() {},
    interrupt() {},
    close: async () => {},
    speakText() {},
    onEvent: (h) => {
      events.add(h);
      return () => events.delete(h);
    },
  };
  const bridge = new RealtimeBrainBridge(
    session,
    {
      async *respond() {
        brainAt = performance.now();
        yield {
          type: "response",
          message: { content: "Synthetic canonical text" },
        } as any;
      },
    },
    "fixture",
    () => {},
  );
  const start = performance.now();
  events.forEach((h) =>
    h({ type: "transcript_final", turn_id: "t", text: "Synthetic diagnostic" }),
  );
  await bridge.idle();
  bridge.close();
  const relay = new RealtimeVoiceRelayService({
    id: "fixture",
    availability: () => "AVAILABLE",
    capabilities: () => [],
    createSession: async () => session,
  });
  const r = await relay.start("fixture", "fixture");
  let before = performance.now();
  for (let i = 0; i < 100; i++)
    await relay.append("fixture", r.relay_id, new Uint8Array(14400));
  const appendMs = (performance.now() - before) / 100;
  await relay.stop("fixture", r.relay_id);
  let failure = false;
  const stream = new RealtimeOutputStream(() => {
      failure = true;
    }),
    p = new RealtimePlayback(silentTimingContext),
    client = new RealtimeOutputClient(
      async () => stream.open(new AbortController().signal),
      p,
      () => {
        failure = true;
      },
    );
  await p.start();
  await client.open("fixture");
  before = performance.now();
  stream.publish({
    type: "assistant_audio_delta",
    turn_id: "t",
    frame: {
      encoding: "pcm16",
      channels: 1,
      sample_rate_hz: 24000,
      data: new Uint8Array(960),
    },
  });
  for (let i = 0; i < 20; i++) await Promise.resolve();
  const pipeline = performance.now() - before;
  before = performance.now();
  stream.publish({
    type: "interruption",
    interruption: {
      kind: "BOTH",
      turn_id: "t",
      at: new Date().toISOString(),
      cancel_external_effect: false,
    },
  });
  for (let i = 0; i < 20; i++) await Promise.resolve();
  const interruption = performance.now() - before;
  stream.close();
  await client.close();
  if (failure) throw new Error("PROFILE_PIPELINE_FAILED");
  console.log(
    JSON.stringify({
      mode: "SYNTHETIC_NO_DEVICES_NO_NETWORK",
      input_batch_max_wait_ms: 300,
      input_queue_cap_ms: 600,
      server_in_process_append_mean_ms: Number(appendMs.toFixed(3)),
      final_transcript_to_fake_brain_ms: Number((brainAt - start).toFixed(3)),
      in_process_first_output_overhead_ms: Number(pipeline.toFixed(3)),
      interruption_to_cleared_buffer_ms: Number(interruption.toFixed(3)),
      playback_queue_cap_ms: 1000,
      server_transient_pcm_cap_bytes: 144000,
      wake_idle_cpu: "NOT_MEASURED_MODEL_UNAVAILABLE",
      physical_audio_latency: "NOT_RUN",
    }),
  );
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  void profileVoice();
