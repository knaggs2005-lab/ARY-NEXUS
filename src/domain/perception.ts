import { z } from "zod";
export const perceptionSources = [
  "upload",
  "screenshot",
  "screen",
  "window",
  "studio_camera",
  "webcam",
] as const;
export type PerceptionSource = (typeof perceptionSources)[number];
export const frameReference = z
  .object({
    id: z.uuid(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    source: z.enum(perceptionSources),
    source_id: z.string().min(1).max(200),
    width: z.number().int().min(1).max(2048),
    height: z.number().int().min(1).max(2048),
    received_at: z.iso.datetime(),
    expires_at: z.iso.datetime(),
  })
  .strict();
export type FrameReference = z.infer<typeof frameReference>;
export const perceptionInput = z
  .object({
    mode: z.enum(["inspect", "verify", "compare"]),
    question: z.string().trim().min(3).max(1000),
    frames: z.array(frameReference).min(1).max(2),
    related_action_id: z.uuid().optional(),
  })
  .strict()
  .refine(
    (v) => new Set(v.frames.map((f) => f.id)).size === v.frames.length,
    "Duplicate frame",
  )
  .refine(
    (v) => v.mode !== "compare" || v.frames.length === 2,
    "Comparison needs before and after frames",
  );
export type PerceptionInput = z.infer<typeof perceptionInput>;
export const visionFinding = z
  .object({
    summary: z.string().max(1500),
    observations: z
      .array(
        z
          .object({
            frame: z.number().int().min(1).max(2),
            evidence: z.string().min(1).max(500),
          })
          .strict(),
      )
      .max(12),
    differences: z.array(z.string().max(500)).max(8),
    verification: z
      .object({
        verdict: z.enum([
          "supported",
          "not_supported",
          "inconclusive",
          "not_requested",
        ]),
        reason: z.string().min(1).max(1000),
        confidence: z.number().min(0).max(1),
      })
      .strict(),
    limitations: z.array(z.string().max(500)).min(1).max(8),
  })
  .strict();
export type VisionFinding = z.infer<typeof visionFinding>;
export interface VisionProvider {
  readonly model: string;
  analyze(
    input: PerceptionInput,
    images: { data: Buffer; mime: "image/png" | "image/jpeg" }[],
    signal?: AbortSignal,
  ): Promise<{
    finding: VisionFinding;
    model: string;
    provider: string;
    latency_ms: number;
  }>;
}
