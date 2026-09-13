import type { LiveMetric } from "./live-voice-client";
/** Browser estimates only. Never relabel these as physical acoustic measurements. */
export function liveTiming(metrics: LiveMetric[]) {
  const samples: number[] = [];
  const interruptions: number[] = [];
  let end: number | undefined, interrupt: number | undefined;
  for (const event of metrics) {
    if (event.name === "user_speech_started") end = undefined;
    if (event.name === "user_speech_ended") end = event.ms;
    if (event.name === "first_audio_played_estimate" && end !== undefined) {
      if (event.ms >= end) samples.push(event.ms - end);
      end = undefined;
    }
    if (event.name === "interruption_detected") interrupt = event.ms;
    if (
      event.name === "remote_audio_stopped_local_mute" &&
      interrupt !== undefined
    ) {
      interruptions.push(Math.max(0, event.ms - interrupt));
      interrupt = undefined;
    }
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const percentile = (p: number) =>
    sorted.length
      ? sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)]
      : null;
  return {
    basis: "browser energy/playback estimate; physical acceptance required",
    samples: samples.length,
    p50_ms: percentile(0.5),
    p95_ms: percentile(0.95),
    worst_ms: percentile(1),
    local_mute_ms: interruptions,
  };
}
