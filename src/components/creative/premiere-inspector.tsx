"use client";
import { useState, useRef } from "react";
import type { PremiereState } from "../../domain/premiere";
import type { Json } from "../../domain/models";
import { api } from "../api";
import { useNexusEvents } from "../events/event-store";
import styles from "../gmail/gmail.module.css";
export function PremiereInspector({
  state,
  disabled,
  onPrepared,
}: {
  state: PremiereState | null;
  disabled: boolean;
  onPrepared: (p: {
    plan: string;
    request: { tool: string; input: Json };
  }) => void;
}) {
  const { events } = useNexusEvents();
  const [query, setQuery] = useState(""),
    [mediaId, setMediaId] = useState(""),
    [start, setStart] = useState(0),
    [duration, setDuration] = useState(30),
    [speech, setSpeech] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const pending = useRef(false);
  const recent = events
    .filter((e) => String(e.payload.tool ?? "").startsWith("premiere."))
    .slice(-8)
    .reverse();
  const media = state?.items.filter((i) => i.kind === "media") ?? [],
    q = query.trim().toLocaleLowerCase();
  const clips =
    state?.clips.filter((c) => !q || c.name.toLocaleLowerCase().includes(q)) ??
    [];
  async function prepare() {
    if (pending.current || !state) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const r = await (
        await api("actions/request", {
          method: "POST",
          body: JSON.stringify({
            tool: "premiere.prepare_analysis",
            request_key: crypto.randomUUID(),
            reason: "Review this Premiere source excerpt before media analysis",
            input: {
              media_id: mediaId,
              expected_revision: state.revision,
              start_seconds: start,
              duration_seconds: duration,
              transcribe: speech,
            },
          }),
        })
      ).json();
      if (!r.result?.request)
        throw Error(
          "The analysis plan was not created; check permissions and Action History.",
        );
      onPrepared(r.result);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <section aria-label="Premiere workspace intelligence">
      <h3>Project & timeline</h3>
      {state ? (
        <>
          <p>
            {state.items.filter((i) => i.kind === "bin").length} bins ·{" "}
            {state.sequences.length} sequences · {media.length} source items ·{" "}
            {state.clips.length} timeline instances{" "}
            {state.complete ? "" : "· Incomplete inventory: narrow the project"}
          </p>
          <label>
            Find clips
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Clip name"
            />
          </label>
          <div className={styles.toolbar}>
            {state.sequences.slice(0, 20).map((s) => (
              <span key={s.id} title={s.id}>
                {s.id === state.sequence_id ? "● " : ""}
                {s.name}
              </span>
            ))}
          </div>
          <details open={!!q}>
            <summary>Timeline · {clips.length} matches</summary>
            <div style={{ overflowX: "auto", maxHeight: 280 }}>
              <table>
                <thead>
                  <tr>
                    <th>Clip / source</th>
                    <th>Track</th>
                    <th>Timeline seconds</th>
                    <th>Source seconds</th>
                    <th>State</th>
                  </tr>
                </thead>
                <tbody>
                  {clips.slice(0, 100).map((c) => (
                    <tr key={c.id}>
                      <td>
                        {c.name}
                        <small style={{ display: "block" }}>
                          {c.id} · {c.source_id ?? "source unreported"}
                        </small>
                      </td>
                      <td>
                        {c.track_kind ?? "—"} {c.track_index ?? ""}
                      </td>
                      <td>
                        {(Number(c.start) / 254016000000).toFixed(2)}–
                        {(Number(c.end) / 254016000000).toFixed(2)}
                      </td>
                      <td>
                        {c.source_in
                          ? `${(Number(c.source_in) / 254016000000).toFixed(2)}–${(Number(c.source_out) / 254016000000).toFixed(2)}`
                          : "Unreported"}
                      </td>
                      <td>
                        {c.disabled === undefined
                          ? "Unreported"
                          : c.disabled
                            ? "Disabled"
                            : "Enabled"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {clips.length > 100 && <p>Showing first 100; refine the search.</p>}
          </details>
          {q && (
            <ul>
              {media
                .filter((i) => i.name.toLocaleLowerCase().includes(q))
                .slice(0, 30)
                .map((i) => (
                  <li key={i.id}>
                    {i.name} · {i.id} ·{" "}
                    {i.offline
                      ? "offline"
                      : i.media_path
                        ? "source available"
                        : "source path unavailable"}
                  </li>
                ))}
            </ul>
          )}
          <h3>Listen to the source</h3>
          <p>
            Measure an excerpt and propose hooks. No timeline changes.
            Transcription uses the configured speech provider only after
            approval; timing remains excerpt-level.
          </p>
          <div className={styles.toolbar}>
            <label>
              Source media
              <select
                disabled={disabled || busy}
                value={mediaId}
                onChange={(e) => setMediaId(e.target.value)}
              >
                <option value="">Choose media</option>
                {media
                  .filter((i) => i.media_path && !i.offline)
                  .map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Source start (seconds)
              <input
                type="number"
                min={0}
                max={86400}
                value={start}
                onChange={(e) => setStart(Number(e.target.value))}
              />
            </label>
            <label>
              Excerpt duration (seconds)
              <input
                type="number"
                min={1}
                max={60}
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={speech}
                onChange={(e) => setSpeech(e.target.checked)}
              />
              Transcribe audio with speech provider
            </label>
          </div>
          <button
            disabled={disabled || busy || !mediaId}
            onClick={() => void prepare()}
          >
            {busy ? "Pinning source evidence…" : "Prepare media analysis"}
          </button>
          {error && <p role="alert">{error}</p>}
        </>
      ) : (
        <p>
          Inspect Premiere to see real project state. No simulated project
          activity.
        </p>
      )}
      <h3>Premiere activity</h3>
      {recent.length ? (
        <ol aria-label="Premiere activity timeline">
          {recent.map((e) => (
            <li key={e.id}>
              <time>{new Date(e.timestamp).toLocaleTimeString()}</time> ·{" "}
              {String(e.payload.tool)} · {String(e.payload.state ?? e.type)}{" "}
              {e.correlation_id && <small>· {e.correlation_id}</small>}
            </li>
          ))}
        </ol>
      ) : (
        <p>
          No Premiere activity received in this session. Saved receipts remain
          in Action History.
        </p>
      )}
    </section>
  );
}

export function PremiereAnalysisReceipt({
  result,
}: {
  result: Json | undefined;
}) {
  if (!result?.source || !result?.plan) return null;
  const source = result.source as {
      start_seconds: number;
      end_seconds: number;
      media_id: string;
      excerpt_sha256: string;
    },
    plan = result.plan as unknown as import("../../domain/edit-plan").EditPlan;
  return (
    <section aria-label="Premiere analysis findings">
      <h4>Source evidence · {source.media_id}</h4>
      <p>
        Source {source.start_seconds.toFixed(2)}–{source.end_seconds.toFixed(2)}{" "}
        seconds · {String(result.decoder)} · audio discarded
      </p>
      {typeof result.transcript === "string" && (
        <blockquote>{result.transcript}</blockquote>
      )}
      <p>
        Transcript timing covers the excerpt only. Review before choosing edit
        boundaries.
      </p>
      <ul>
        {plan.recommendations
          .filter((r) => ["hook", "silence"].includes(r.kind))
          .slice(0, 20)
          .map((r) => (
            <li key={r.id}>
              <strong>
                {r.kind} · {r.start.toFixed(2)}–{r.end.toFixed(2)} s
              </strong>
              <p>{r.reason}</p>
              <small>
                Heuristic confidence {Math.round(r.confidence * 100)}% · source
                evidence {r.evidence.source_hash.slice(0, 12)}
              </small>
            </li>
          ))}
      </ul>
      {!plan.recommendations.some((r) =>
        ["hook", "silence"].includes(r.kind),
      ) && <p>No hook or sustained acoustic silence met the current rules.</p>}
      <details>
        <summary>Evidence provenance</summary>
        <p style={{ overflowWrap: "anywhere" }}>
          Decoded audio SHA-256 {source.excerpt_sha256}
        </p>
        {plan.warnings.map((w) => (
          <p key={w}>{w}</p>
        ))}
      </details>
    </section>
  );
}
