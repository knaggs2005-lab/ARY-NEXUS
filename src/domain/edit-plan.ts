import { z } from "zod";
const ref = z.string().trim().min(1).max(200);
const seconds = z.number().min(0).max(86400);
export const editSegment = z
  .object({
    id: ref,
    start: seconds,
    end: seconds,
    text: z.string().trim().min(1).max(2000),
    speaker: z.string().max(100).optional(),
    confidence: z.number().min(0).max(1).default(0.8),
  })
  .strict();
export const editPlanInput = z
  .object({
    brief: z.string().trim().min(1).max(2000),
    destination: z.string().trim().min(1).max(160),
    clips: z
      .array(
        z
          .object({
            id: ref,
            name: ref,
            source_ref: z.string().trim().min(1).max(1000),
            duration: z.number().positive().max(86400),
            fps: z.number().min(1).max(60),
            segments: z.array(editSegment).max(200).default([]),
            srt: z.string().max(30000).optional(),
            audio_windows: z
              .array(
                z
                  .object({
                    start: seconds,
                    end: seconds,
                    rms_dbfs: z.number().min(-160).max(0),
                  })
                  .strict(),
              )
              .max(500)
              .default([]),
            audio_source_ref: z.string().min(1).max(1000).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(20),
    target_seconds: z.number().min(1).max(3600).default(60),
  })
  .strict();
export type EditPlanInput = z.infer<typeof editPlanInput>;
export type EditSegment = z.infer<typeof editSegment>;
export type EditKind =
  | "select"
  | "question"
  | "answer"
  | "hook"
  | "dead_space"
  | "silence"
  | "duplicate_take"
  | "marker"
  | "export";
export interface EditRecommendation {
  id: string;
  kind: EditKind;
  source_clip: string;
  start: number;
  end: number;
  timecode: {
    in: string;
    out: string;
    basis: "source-relative non-drop";
    fps: number;
  };
  reason: string;
  confidence: number;
  intended_destination: string;
  evidence: {
    source_ref: string;
    source_hash: string;
    segment_ids: string[];
    quotes: string[];
  };
  related_recommendation_ids: string[];
  score: number;
  signals: Record<string, number>;
}
export interface EditPlan {
  id: string;
  version: "edit-rules-v1";
  created_at: string;
  input_hash: string;
  brief: string;
  destination: string;
  recommendations: EditRecommendation[];
  clip_ranking: {
    source_clip: string;
    score: number;
    recommendation_ids: string[];
  }[];
  rough_cut: {
    order: number;
    recommendation_id: string;
    destination_start: number;
    duration: number;
  }[];
  planned_seconds: number;
  target_seconds: number;
  instructions: {
    recommendation_ids: string[];
    tool: string | null;
    args: Record<string, unknown>;
    status:
      "manual_range_edit_required" | "mapping_required" | "preset_required";
    preconditions: string[];
  }[];
  warnings: string[];
}
/** SRT cues retain timestamps/quotes; no speech provider or invented word alignment. */
export function parseSrt(text: string): EditSegment[] {
  const clock = (s: string) => {
    const p = s.replace(",", ".").split(":").map(Number);
    return p[0] * 3600 + p[1] * 60 + p[2];
  };
  return text
    .replace(/^\uFEFF/, "")
    .trim()
    .split(/\r?\n\s*\r?\n/)
    .map((block, index) => {
      const lines = block.split(/\r?\n/);
      if (/^\d+$/.test(lines[0])) lines.shift();
      const match = lines
        .shift()
        ?.match(
          /^(\d{2}:[0-5]\d:[0-5]\d[,.]\d{3})\s+-->\s+(\d{2}:[0-5]\d:[0-5]\d[,.]\d{3})$/,
        );
      if (!match) throw Error(`Invalid SRT timing in cue ${index + 1}`);
      return {
        id: `srt-${index + 1}`,
        start: clock(match[1]),
        end: clock(match[2]),
        text: lines.join("\n"),
        confidence: 0.8,
      };
    });
}
export function sourceTimecode(seconds: number, fps: number) {
  const frame = Math.floor(seconds * fps + 1e-7),
    nominal = Math.round(fps);
  const h = Math.floor(frame / (nominal * 3600)),
    m = Math.floor(frame / (nominal * 60)) % 60,
    s = Math.floor(frame / nominal) % 60,
    f = frame % nominal;
  return [h, m, s, f].map((v) => String(v).padStart(2, "0")).join(":");
}
