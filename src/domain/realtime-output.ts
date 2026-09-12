import { z } from "zod";
import type { RealtimeVoiceAudioFrame } from "./realtime-voice";

export const relayOutput = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ready") }).strict(),
  z
    .object({
      type: z.literal("audio"),
      sequence: z.number().int().nonnegative(),
      turn_id: z.string().max(200),
      encoding: z.literal("pcm16"),
      sample_rate_hz: z.literal(24000),
      channels: z.literal(1),
      audio: z
        .string()
        .min(4)
        .max(64000)
        .regex(
          /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/,
        ),
    })
    .strict(),
  z.object({ type: z.literal("state"), state: z.string().max(40) }).strict(),
  z
    .object({
      type: z.literal("interrupted"),
      turn_id: z.string().max(200),
      cancel_external_effect: z.literal(false),
    })
    .strict(),
  z
    .object({
      type: z.literal("closed"),
      failure_code: z
        .string()
        .regex(/^[A-Za-z0-9_.-]{1,120}$/)
        .optional(),
    })
    .strict(),
]);
export type RelayOutput = z.infer<typeof relayOutput>;
export function outputFrame(
  event: Extract<RelayOutput, { type: "audio" }>,
): RealtimeVoiceAudioFrame {
  return {
    encoding: event.encoding,
    sample_rate_hz: event.sample_rate_hz,
    channels: event.channels,
    data: Uint8Array.from(atob(event.audio), (c) => c.charCodeAt(0)),
  };
}
