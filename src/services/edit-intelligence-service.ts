import { createHash } from "node:crypto";
import {
  editPlanInput,
  editSegment,
  parseSrt,
  sourceTimecode,
  type EditPlan,
  type EditRecommendation,
  type EditSegment,
  type EditKind,
} from "../domain/edit-plan";
const hash = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
const words = (s: string) => s.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];
const normalized = (s: string) => words(s).join(" ");
/** Pure bounded evidence analysis. No model calls, memory writes, file reads or Premiere execution. */
export class EditIntelligenceService {
  createPlan(raw: unknown): EditPlan {
    const input = editPlanInput.parse(raw);
    const clips = input.clips.map((c) => ({
      ...c,
      segments: c.srt
        ? parseSrt(c.srt).map((s) => editSegment.parse(s))
        : c.segments,
    }));
    if (new Set(clips.map((c) => c.id)).size !== clips.length)
      throw Error("Source clip IDs must be unique");
    if (clips.reduce((n, c) => n + c.segments.length, 0) > 500)
      throw Error("Limit each plan to 500 transcript cues");
    for (const [i, c] of clips.entries()) {
      if (input.clips[i].srt && input.clips[i].segments.length)
        throw Error("Use SRT or segments, not both");
      if (
        c.segments.length > 200 ||
        new Set(c.segments.map((s) => s.id)).size !== c.segments.length
      )
        throw Error("Duplicate cue IDs or too many cues");
      for (const s of [...c.segments, ...c.audio_windows])
        if (s.end <= s.start || s.end > c.duration)
          throw Error("Source range is empty or outside clip duration");
      if (c.audio_windows.length && !c.audio_source_ref)
        throw Error("Audio measurements require a source reference");
      c.segments.sort((a, b) => a.start - b.start || a.end - b.end);
      c.audio_windows.sort((a, b) => a.start - b.start);
      if (
        c.audio_windows.some(
          (w, n) => n > 0 && w.start < c.audio_windows[n - 1].end,
        )
      )
        throw Error("Audio windows must not overlap");
    }
    const digest = hash(input),
      recs: EditRecommendation[] = [];
    const warnings = [
      "Advisory plan only. No Premiere state was read or changed. Confidence is heuristic, not a calibrated probability.",
      "Transcript gaps are not proof of acoustic silence. Audio measurements and source references are caller-supplied, not independently authenticated.",
      "Exact trimmed ranges are not supported by PremiereTool v1. Never substitute a whole-clip selects operation for this cut plan.",
    ];
    const add = (
      c: (typeof clips)[number],
      kind: EditKind,
      start: number,
      end: number,
      segs: EditSegment[],
      reason: string,
      confidence: number,
      signals: Record<string, number> = {},
      related: string[] = [],
    ) => {
      const r: EditRecommendation = {
        id: `rec-${recs.length + 1}`,
        kind,
        source_clip: c.id,
        start,
        end,
        timecode: {
          in: sourceTimecode(start, c.fps),
          out: sourceTimecode(end, c.fps),
          basis: "source-relative non-drop",
          fps: c.fps,
        },
        reason,
        confidence: Math.round(confidence * 100) / 100,
        intended_destination: input.destination,
        evidence: {
          source_ref: kind === "silence" ? c.audio_source_ref! : c.source_ref,
          source_hash: hash(c),
          segment_ids: segs.map((s) => s.id),
          quotes: segs.map((s) => s.text),
        },
        related_recommendation_ids: related,
        score: Object.values(signals).reduce((a, b) => a + b, 0),
        signals,
      };
      recs.push(r);
      return r;
    };
    const terms = new Set(words(input.brief).filter((w) => w.length > 3));
    const candidates: EditRecommendation[] = [];
    const seen = new Map<string, EditRecommendation>();
    for (const c of clips) {
      if (!c.segments.length)
        warnings.push(
          `${c.id}: no timed speech; no spoken-content selects inferred.`,
        );
      let previousQuestion: EditRecommendation | null = null;
      for (let n = 0; n < c.segments.length; n++) {
        const s = c.segments[n],
          question = /\?\s*$/.test(s.text);
        const overlap = n > 0 && s.start < c.segments[n - 1].end;
        if (overlap)
          warnings.push(
            `${c.id}/${s.id}: overlapping speech cues; review speaker boundaries.`,
          );
        const segWords = words(s.text);
        const topical = Math.min(
          20,
          [...new Set(segWords)].filter((w) => terms.has(w)).length * 5,
        );
        const hook =
          /\b(secret|mistake|surprising|imagine|nobody|never|why|changed|learned)\b/i.test(
            s.text,
          );
        const answer =
          !question &&
          previousQuestion &&
          s.start - previousQuestion.end <= 3 &&
          s.start >= previousQuestion.end;
        const signals = {
          topic_match: topical,
          answer: answer ? 20 : 0,
          hook: hook ? 15 : 0,
          concrete_detail: /\d/.test(s.text) ? 5 : 0,
          substance: segWords.length >= 8 ? 10 : 0,
          transcript_confidence: Math.round(s.confidence * 10),
        };
        const r = add(
          c,
          question ? "question" : "select",
          s.start,
          s.end,
          [s],
          question
            ? "Question punctuation suggests an interviewer prompt; speaker role is unverified."
            : `Ranked from supplied transcript: topic ${topical}, answer ${signals.answer}, hook ${signals.hook}, detail ${signals.concrete_detail}, substance ${signals.substance}, transcript confidence ${signals.transcript_confidence}.`,
          s.confidence * (overlap ? 0.6 : 0.85),
          signals,
        );
        if (answer)
          add(
            c,
            "answer",
            s.start,
            s.end,
            [s],
            "Speech follows a question within three seconds. Review the speaker identity and whether the answer is complete.",
            s.confidence * 0.65,
            {},
            [previousQuestion!.id, r.id],
          );
        if (hook)
          add(
            c,
            "hook",
            s.start,
            s.end,
            [s],
            "Opening candidate contains an explicit curiosity/change phrase. This is an editorial heuristic, not evidence of audience performance.",
            s.confidence * 0.65,
            {},
            [r.id],
          );
        const key = `${question ? "question:" : "statement:"}${normalized(s.text)}`,
          prior = seen.get(key);
        if (prior && segWords.length >= 5) {
          add(
            c,
            "duplicate_take",
            s.start,
            s.end,
            [s],
            "Same normalized transcript wording as another passage; picture, delivery and audio may differ. No take is discarded automatically.",
            s.confidence * 0.7,
            {},
            [prior.id, r.id],
          );
        } else {
          if (!question) candidates.push(r);
          if (segWords.length >= 5) seen.set(key, r);
        }
        previousQuestion = question ? r : null;
      }
      // Union cue coverage before measuring transcript gaps; overlaps never manufacture gaps.
      let covered = 0;
      for (const s of c.segments) {
        if (s.start - covered >= 1.5)
          add(
            c,
            "dead_space",
            covered,
            s.start,
            [],
            "No transcript cue covers this interval. Listen before removing; it may contain music, action or untranscribed speech.",
            0.25,
          );
        covered = Math.max(covered, s.end);
      }
      if (c.segments.length && c.duration - covered >= 1.5)
        add(
          c,
          "dead_space",
          covered,
          c.duration,
          [],
          "Trailing interval has no transcript cue. Review picture/audio before shortening.",
          0.25,
        );
      let quiet: { start: number; end: number } | null = null;
      const flush = () => {
        if (quiet && quiet.end - quiet.start >= 0.8)
          add(
            c,
            "silence",
            quiet.start,
            quiet.end,
            [],
            "Contiguous supplied audio windows are at or below -45 dBFS for at least 0.8 seconds. Check intended pauses and the audio source.",
            0.75,
          );
        quiet = null;
      };
      for (const w of c.audio_windows) {
        if (w.rms_dbfs <= -45) {
          if (quiet && Math.abs(w.start - quiet.end) < 0.001) quiet.end = w.end;
          else {
            flush();
            quiet = { start: w.start, end: w.end };
          }
        } else flush();
      }
      flush();
    }
    candidates.sort(
      (a, b) =>
        b.score - a.score ||
        a.source_clip.localeCompare(b.source_clip) ||
        a.start - b.start,
    );
    const rough: EditPlan["rough_cut"] = [];
    let elapsed = 0;
    for (const r of candidates) {
      const duration = r.end - r.start;
      if (
        r.score < 20 ||
        elapsed + duration > input.target_seconds ||
        rough.some((cut) => {
          const other = recs.find((x) => x.id === cut.recommendation_id)!;
          return (
            other.source_clip === r.source_clip &&
            other.start < r.end &&
            r.start < other.end
          );
        })
      )
        continue;
      rough.push({
        order: rough.length + 1,
        recommendation_id: r.id,
        destination_start: elapsed,
        duration,
      });
      elapsed += duration;
    }
    if (!rough.length)
      warnings.push(
        "No complete passage met the score/budget threshold. No arbitrary cut was invented.",
      );
    for (const cut of rough) {
      const r = recs.find((r) => r.id === cut.recommendation_id)!;
      const c = clips.find((c) => c.id === r.source_clip)!;
      add(
        c,
        "marker",
        r.start,
        r.end,
        c.segments.filter((s) => r.evidence.segment_ids.includes(s.id)),
        `Review select ${cut.order}: ${r.reason}`,
        r.confidence,
        {},
        [r.id],
      );
    }
    if (rough.length) {
      const r = recs.find((r) => r.id === rough[0].recommendation_id)!;
      const c = clips.find((c) => c.id === r.source_clip)!;
      add(
        c,
        "export",
        r.start,
        r.end,
        [],
        "After reviewing the proposed sequence, choose an existing delivery preset and a new output path. Match delivery requirements and actual sequence settings; codec/resolution are not inferred from a transcript.",
        0.4,
        {},
        rough.map((x) => x.recommendation_id),
      );
    }
    return {
      id: `edit-${digest.slice(0, 24)}`,
      version: "edit-rules-v1",
      created_at: new Date().toISOString(),
      input_hash: digest,
      brief: input.brief,
      destination: input.destination,
      recommendations: recs,
      clip_ranking: clips
        .map((c) => {
          const list = candidates.filter((r) => r.source_clip === c.id);
          return {
            source_clip: c.id,
            score: Math.max(0, ...list.map((r) => r.score)),
            recommendation_ids: list.map((r) => r.id),
          };
        })
        .sort(
          (a, b) =>
            b.score - a.score || a.source_clip.localeCompare(b.source_clip),
        ),
      rough_cut: rough,
      planned_seconds: elapsed,
      target_seconds: input.target_seconds,
      instructions: [
        ...rough.map((cut) => {
          const r = recs.find((r) => r.id === cut.recommendation_id)!;
          return {
            recommendation_ids: [r.id],
            tool: null,
            args: {
              source_clip: r.source_clip,
              source_in_seconds: r.start,
              source_out_seconds: r.end,
              destination: input.destination,
              destination_start_seconds: cut.destination_start,
            },
            status: "manual_range_edit_required" as const,
            preconditions: [
              "Review full source context and question/answer continuity",
              "Premiere v1 cannot execute trimmed ranges; no whole-clip substitution",
            ],
          };
        }),
        ...recs
          .filter((r) => r.kind === "marker")
          .map((r) => ({
            recommendation_ids: [r.id],
            tool: "premiere.create_markers",
            args: {
              markers: [
                {
                  name: `Select ${r.related_recommendation_ids[0]}`,
                  source_clip: r.source_clip,
                  source_seconds: r.start,
                  comments: r.reason,
                },
              ],
            },
            status: "mapping_required" as const,
            preconditions: [
              "Resolve source range to the intended current sequence; source time is not sequence time",
              "Convert source_seconds to sequence seconds; remove source fields",
              "Use premiere.plan to validate live state, then request exact execution approval",
            ],
          })),
        ...(rough.length
          ? [
              {
                recommendation_ids: recs
                  .filter((r) => r.kind === "export")
                  .map((r) => r.id),
                tool: "premiere.export_sequence",
                args: {},
                status: "preset_required" as const,
                preconditions: [
                  "Review and open the intended completed sequence",
                  "Choose an existing .epr and a new output path",
                  "Use premiere.plan, then exact execution approval; submission is not render completion",
                ],
              },
            ]
          : []),
      ],
      warnings,
    };
  }
}
