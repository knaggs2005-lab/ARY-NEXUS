"use client";
import { useEffect, useRef, useState } from "react";
import { measureEditAudio } from "../../domain/edit-audio";
import { editPlanInput } from "../../domain/edit-plan";
import type { EditPlan } from "../../domain/edit-plan";
import type { Json } from "../../domain/models";
import { api } from "../api";
import styles from "../gmail/gmail.module.css";
export interface PreparedEditMarker {
  plan: string;
  request: { tool: string; input: Json };
  source_action_id: string;
  product_entity_ids: string[];
}
const example = {
  brief: "Explain the key lesson from the interview",
  destination: "Interview rough cut",
  target_seconds: 60,
  clips: [
    {
      id: "clip-1",
      name: "Interview source",
      source_ref: "user-supplied transcript version 1",
      duration: 30,
      fps: 30,
      segments: [
        {
          id: "cue-1",
          start: 2,
          end: 10,
          text: "Replace this example with your actual timed transcript.",
          speaker: "Speaker 1",
          confidence: 0.8,
        },
      ],
    },
  ],
};
export function EditIntelligencePanel({
  onPrepared,
}: {
  onPrepared: (plan: PreparedEditMarker) => void;
}) {
  const [input, setInput] = useState(""),
    [plan, setPlan] = useState<EditPlan | null>(null),
    [actionId, setActionId] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [marker, setMarker] = useState(""),
    [project, setProject] = useState(""),
    [sequence, setSequence] = useState(""),
    [seconds, setSeconds] = useState(""),
    [note, setNote] = useState("");
  const [audioClip, setAudioClip] = useState("");
  const active = useRef(false),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function work(fn: () => Promise<void>) {
    if (active.current) return;
    active.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    } finally {
      active.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  function change(value: string) {
    setInput(value);
    setPlan(null);
    setActionId("");
    setMarker("");
  }
  return (
    <section className={styles.mail} aria-label="Ary Edit Intelligence">
      <span className={styles.eyebrow}>ARY / CREATIVE / EDIT INTELLIGENCE</span>
      <h2>Find the story before the edit.</h2>
      <p>
        Ingest timed transcript JSON or SRT inside a clip’s <code>srt</code>{" "}
        field. Recommendations retain source quotes and timing. Analysis never
        changes Premiere.
      </p>
      <label>
        Transcript package JSON
        <textarea
          rows={8}
          value={input}
          disabled={busy}
          placeholder={JSON.stringify(example, null, 2)}
          onChange={(e) => change(e.target.value)}
        />
      </label>
      <label>
        Import transcript package
        <input
          type="file"
          accept="application/json,.json"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file)
              void work(async () => {
                if (file.size > 55000)
                  throw Error(
                    "Keep packages below 55 KB; split longer interviews.",
                  );
                const value = await file.text();
                JSON.parse(value);
                if (mounted.current) change(value);
              });
            e.target.value = "";
          }}
        />
      </label>
      <details>
        <summary>Measure silence from a local audio excerpt</summary>
        <p>
          Optional: select audio matching an entire source clip, up to 25 MB /
          250 seconds. Audio stays in this browser; only half-second RMS
          measurements and a file hash enter the plan. This does not record your
          microphone.
        </p>
        <label>
          Audio source clip ID
          <input
            value={audioClip}
            disabled={busy}
            onChange={(e) => setAudioClip(e.target.value)}
          />
        </label>
        <label>
          Measure local audio
          <input
            type="file"
            accept="audio/*,.wav"
            disabled={busy || !audioClip || !input}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file)
                void work(async () => {
                  if (file.size > 25 * 1024 * 1024)
                    throw Error("Audio file exceeds 25 MB");
                  const parsed = editPlanInput.parse(JSON.parse(input)),
                    clip = parsed.clips.find((c) => c.id === audioClip);
                  if (!clip)
                    throw Error("Choose a clip ID in the transcript package");
                  const bytes = await file.arrayBuffer(),
                    context = new AudioContext();
                  try {
                    const buffer = await context.decodeAudioData(
                      bytes.slice(0),
                    );
                    const measured = measureEditAudio(
                      Array.from({ length: buffer.numberOfChannels }, (_, i) =>
                        buffer.getChannelData(i),
                      ),
                      buffer.sampleRate,
                    );
                    if (Math.abs(measured.duration - clip.duration) > 0.1)
                      throw Error(
                        "Audio duration must match the source clip; use matching source-relative excerpts",
                      );
                    const digest = await crypto.subtle.digest("SHA-256", bytes),
                      hash = Array.from(new Uint8Array(digest), (b) =>
                        b.toString(16).padStart(2, "0"),
                      ).join("");
                    clip.audio_windows = measured.windows;
                    clip.audio_source_ref = `local audio ${file.name}; sha256:${hash}`;
                    if (mounted.current)
                      change(JSON.stringify(parsed, null, 2));
                  } finally {
                    await context.close();
                  }
                });
              e.target.value = "";
            }}
          />
        </label>
      </details>
      <button
        disabled={busy || !input.trim()}
        onClick={() =>
          void work(async () => {
            setPlan(null);
            setActionId("");
            const parsed = JSON.parse(input);
            if (new TextEncoder().encode(JSON.stringify(parsed)).length > 55000)
              throw Error("Keep packages below 55 KB.");
            const r = await (
              await api("actions/request", {
                method: "POST",
                body: JSON.stringify({
                  tool: "edit.plan",
                  input: parsed,
                  request_key: crypto.randomUUID(),
                  reason:
                    "User requested an advisory edit plan from supplied transcripts.",
                }),
              })
            ).json();
            if (mounted.current) {
              setPlan(r.result);
              setActionId(r.action_id);
            }
          })
        }
      >
        Analyze edit plan
      </button>
      {busy && (
        <p role="status" className={styles.pulse}>
          Preparing evidence and review instructions…
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {plan && (
        <>
          <h3>Edit plan · {plan.destination}</h3>
          <p>
            {plan.planned_seconds.toFixed(2)}s selected / {plan.target_seconds}s
            target · {plan.version} · saved action {actionId}
          </p>
          <details>
            <summary>Analysis limits and warnings</summary>
            <ul>
              {plan.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </details>
          <h3>Clip ranking</h3>
          <ol>
            {plan.clip_ranking.map((c) => (
              <li key={c.source_clip}>
                {c.source_clip} · score {c.score} ·{" "}
                {c.recommendation_ids.length} candidate passages
              </li>
            ))}
          </ol>
          <h3>Proposed rough cut</h3>
          <ol>
            {plan.rough_cut.map((c) => {
              const r = plan.recommendations.find(
                (r) => r.id === c.recommendation_id,
              )!;
              return (
                <li key={r.id}>
                  {r.source_clip} · {r.timecode.in}–{r.timecode.out} →{" "}
                  {c.destination_start.toFixed(2)}s · {r.reason}
                </li>
              );
            })}
          </ol>
          <h3>Recommendations and provenance</h3>
          {plan.recommendations.map((r) => (
            <details key={r.id} className={styles.candidate}>
              <summary>
                {r.kind.replaceAll("_", " ")} · {r.source_clip} ·{" "}
                {r.timecode.in}–{r.timecode.out} ·{" "}
                {Math.round(r.confidence * 100)}% heuristic confidence
              </summary>
              <p>{r.reason}</p>
              <p>
                Destination: {r.intended_destination} · source-relative non-drop
                at {r.timecode.fps} fps
              </p>
              {r.evidence.quotes.map((q, i) => (
                <blockquote key={i}>{q}</blockquote>
              ))}
              <p style={{ overflowWrap: "anywhere" }}>
                Source: {r.evidence.source_ref}
                <br />
                SHA-256: {r.evidence.source_hash}
                <br />
                Cues:{" "}
                {r.evidence.segment_ids.join(", ") ||
                  "Interval measurement/coverage; no spoken quote"}
              </p>
            </details>
          ))}
          <details>
            <summary>Structured instructions / export plan</summary>
            <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
              {JSON.stringify(plan.instructions, null, 2)}
            </pre>
          </details>
          <button
            onClick={() => {
              const blob = new Blob(
                  [
                    JSON.stringify(
                      { source_action_id: actionId, ...plan },
                      null,
                      2,
                    ),
                  ],
                  { type: "application/json" },
                ),
                url = URL.createObjectURL(blob),
                a = document.createElement("a");
              a.href = url;
              a.download = `${plan.id}.json`;
              a.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            }}
          >
            Download edit plan
          </button>
          <details>
            <summary>Prepare one marker for Premiere review</summary>
            <p>
              Only after verifying where this source passage sits in the
              destination sequence. This prepares a request; the existing
              approval controls below execute it.
            </p>
            <label>
              Marker recommendation
              <select
                value={marker}
                onChange={(e) => setMarker(e.target.value)}
              >
                <option value="">Choose a marker</option>
                {plan.recommendations
                  .filter((r) => r.kind === "marker")
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.id} · {r.source_clip} {r.timecode.in}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Destination Premiere project ID
              <input
                value={project}
                onChange={(e) => setProject(e.target.value)}
              />
            </label>
            <label>
              Destination Premiere sequence ID
              <input
                value={sequence}
                onChange={(e) => setSequence(e.target.value)}
              />
            </label>
            <label>
              Verified sequence seconds
              <input
                type="number"
                min="0"
                step="any"
                value={seconds}
                onChange={(e) => setSeconds(e.target.value)}
              />
            </label>
            <label>
              Source-to-sequence mapping evidence
              <input value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
            <button
              disabled={
                busy ||
                !marker ||
                !project ||
                !sequence ||
                seconds === "" ||
                note.trim().length < 10
              }
              onClick={() =>
                void work(async () => {
                  const r = await (
                    await api("actions/request", {
                      method: "POST",
                      body: JSON.stringify({
                        tool: "edit.prepare_marker",
                        input: {
                          plan_action_id: actionId,
                          recommendation_id: marker,
                          premiere_project_id: project,
                          sequence_id: sequence,
                          sequence_seconds: Number(seconds),
                          mapping_note: note,
                        },
                        source_action_id: actionId,
                        request_key: crypto.randomUUID(),
                        reason:
                          "Prepare one source-attributed marker after reviewing sequence mapping.",
                      }),
                    })
                  ).json();
                  if (mounted.current) onPrepared(r.result);
                })
              }
            >
              Prepare marker review
            </button>
          </details>
        </>
      )}
    </section>
  );
}
