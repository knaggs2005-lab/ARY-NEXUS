"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import {
  priorityPolicy,
  rankPriorities,
  type PriorityReport,
  type PriorityEvidence,
} from "../../domain/priority";
import { useRankMotion } from "./use-rank-motion";
import styles from "./priority.module.css";
function Evidence({ rows }: { rows: PriorityEvidence[] }) {
  const unique = [
    ...new Map(rows.map((r) => [`${r.table}:${r.id}:${r.field}`, r])).values(),
  ];
  return (
    <ul className={styles.evidence}>
      {unique.map((r) => (
        <li key={`${r.table}:${r.id}:${r.field}`}>
          <p>{r.detail}</p>
          <code>
            {r.table}/{r.id} · {r.field}
          </code>
          <small>
            Source updated {new Date(r.updated_at).toLocaleString()}
          </small>
        </li>
      ))}
    </ul>
  );
}
export function PriorityView({ onGraph }: { onGraph: (id: string) => void }) {
  const [report, setReport] = useState<PriorityReport | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [kind, setKind] = useState("all"),
    [selected, setSelected] = useState<string | null>(null),
    [horizon, setHorizon] = useState(0);
  const [deadlineEmphasis, setDeadlineEmphasis] = useState(1),
    [strategyEmphasis, setStrategyEmphasis] = useState(1);
  const [view, setView] = useState<"rank" | "timeline">("rank");
  const controller = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setBusy(true);
    setError("");
    try {
      const next = await (
        await api("priorities", { signal: request.signal })
      ).json();
      if (!request.signal.aborted) setReport(next);
    } catch (e) {
      if (!request.signal.aborted) {
        setReport(null);
        setError((e as Error).message);
      }
    } finally {
      if (!request.signal.aborted) setBusy(false);
    }
  }, []);
  useEffect(() => {
    void load();
    const wake = () => {
      if (!document.hidden) void load();
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);
    return () => {
      controller.current?.abort();
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("focus", wake);
    };
  }, [load]);
  const at = report
    ? new Date(
        Date.parse(report.evaluated_at) + horizon * 86400000,
      ).toISOString()
    : "";
  const scenario =
    !!horizon || deadlineEmphasis !== 1 || strategyEmphasis !== 1;
  const ranked = useMemo(
    () =>
      report
        ? rankPriorities(
            report,
            {
              ...priorityPolicy.weights,
              deadline: 20 * deadlineEmphasis,
              strategy: 15 * strategyEmphasis,
            },
            at,
          )
        : [],
    [report, at, deadlineEmphasis, strategyEmphasis],
  );
  const baseline = useMemo(
    () =>
      report
        ? new Map(rankPriorities(report).map((r) => [r.id, r.rank]))
        : new Map<string, number>(),
    [report],
  );
  const filtered = ranked.filter((r) => kind === "all" || r.kind === kind);
  const shown =
    view === "timeline"
      ? [...filtered].sort(
          (a, b) =>
            (a.due_at ?? "9999").localeCompare(b.due_at ?? "9999") ||
            a.rank - b.rank,
        )
      : filtered;
  const revision =
    shown.map((r) => `${r.id}:${r.rank}:${r.score}`).join("|") +
    view +
    selected;
  const list = useRankMotion(revision);
  const focus = filtered.find((r) => r.id === selected) ?? filtered[0];
  return (
    <section
      className={styles.root}
      aria-label="Ary Priority Intelligence"
      aria-busy={busy}
    >
      <header className={styles.hero}>
        <div>
          <span className={styles.eyebrow}>ARY / PRIORITY INTELLIGENCE</span>
          <h2>Attention, with intention.</h2>
          <p>Understand the work. Choose the next move.</p>
        </div>
        <button onClick={() => void load()} disabled={busy}>
          {busy ? "Reading evidence…" : "Refresh evidence"}
        </button>
      </header>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <div className={styles.summary}>
        <span>
          <strong>{ranked.length}</strong> active work items
        </span>
        <span>
          <strong>
            {
              ranked.filter((r) =>
                r.paths.some((p) => p.direction === "requires"),
              ).length
            }
          </strong>{" "}
          with prerequisites
        </span>
        <span>
          <strong>
            {
              ranked.filter(
                (r) =>
                  r.factors.find((f) => f.factor === "revenue")?.value === null,
              ).length
            }
          </strong>{" "}
          revenue unassessed
        </span>
      </div>
      <div className={styles.toolbar}>
        <label>
          Work type
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="all">All work</option>
            <option value="task">Tasks</option>
            <option value="goal">Goals</option>
            <option value="project">Projects</option>
          </select>
        </label>
        <div>
          <button
            aria-pressed={view === "rank"}
            onClick={() => setView("rank")}
          >
            Priority order
          </button>
          <button
            aria-pressed={view === "timeline"}
            onClick={() => setView("timeline")}
          >
            Deadline order
          </button>
        </div>
        <small>
          {report
            ? `Snapshot ${new Date(report.evaluated_at).toLocaleString()}`
            : "Loading source records…"}
        </small>
      </div>
      <details className={styles.policy}>
        <summary>Scoring policy & what-if planning</summary>
        <p>
          {priorityPolicy.version}: additive policy points out of 100, not a
          probability or financial forecast. Unknown signals earn no points;
          coverage is separate from confidence. Ties use deadline then stable
          canonical ID. Blockers increase attention, not execution readiness.
        </p>
        <p>
          Base weights: deadline 20 · urgency 15 · strategy 15 · goals 15 ·
          dependencies 10 · blockers 5 · revenue 10 · effort 5 · confidence 5.
        </p>
        <div className={styles.sliders}>
          <label>
            Deadline emphasis · {deadlineEmphasis}×
            <input
              aria-label="Deadline emphasis"
              type="range"
              min="0"
              max="2"
              step="0.25"
              value={deadlineEmphasis}
              onChange={(e) => setDeadlineEmphasis(Number(e.target.value))}
            />
          </label>
          <label>
            Strategy emphasis · {strategyEmphasis}×
            <input
              aria-label="Strategy emphasis"
              type="range"
              min="0"
              max="2"
              step="0.25"
              value={strategyEmphasis}
              onChange={(e) => setStrategyEmphasis(Number(e.target.value))}
            />
          </label>
          <label>
            Deadline preview · +{horizon} days
            <input
              aria-label="Deadline preview days"
              type="range"
              min="0"
              max="30"
              value={horizon}
              onChange={(e) => setHorizon(Number(e.target.value))}
            />
          </label>
        </div>
        <p>
          Preview changes only weights and deadline bands against this snapshot.
          It does not predict task completion or future relationships. All
          weights are normalized to 100. Nothing is saved to your work records.
        </p>
        <button
          onClick={() => {
            setHorizon(0);
            setDeadlineEmphasis(1);
            setStrategyEmphasis(1);
          }}
        >
          Reset preview
        </button>
      </details>
      {scenario && (
        <p className={styles.preview} role="status">
          WHAT-IF PREVIEW · {new Date(at).toLocaleDateString()} · canonical
          records unchanged
        </p>
      )}
      <div className={styles.layout}>
        <ol
          ref={list}
          className={styles.ranking}
          aria-label="Ranked priorities"
        >
          {shown.map((row) => (
            <li
              key={row.id}
              data-priority-id={row.id}
              data-top={row.rank === 1}
              data-selected={focus?.id === row.id}
            >
              <button
                className={styles.select}
                onClick={() => setSelected(row.id)}
                aria-pressed={focus?.id === row.id}
              >
                <span className={styles.rank}>
                  {String(row.rank).padStart(2, "0")}
                </span>
                <span className={styles.work}>
                  <small>
                    {row.kind} · {row.status}
                  </small>
                  <strong>{row.title}</strong>
                  <span>{row.readiness}</span>
                  <span className={styles.date}>
                    {row.due_at
                      ? `Due ${new Date(row.due_at).toLocaleDateString()}`
                      : "No deadline recorded"}
                  </span>
                  <span className={styles.reason}>
                    {row.factors
                      .filter((f) => f.points > 0)
                      .sort((a, b) => b.points - a.points)
                      .slice(0, 2)
                      .map((f) => `${f.label} +${f.points.toFixed(1)}`)
                      .join(" · ") || "Insufficient evidence to prioritize"}
                  </span>
                </span>
                <span className={styles.score}>
                  <strong>{row.score.toFixed(1)}</strong>
                  <small>policy points</small>
                  {scenario && <small>was #{baseline.get(row.id)}</small>}
                </span>
              </button>
              <div className={styles.scoreTrack}>
                <i style={{ width: `${row.score}%` }} />
              </div>
            </li>
          ))}
        </ol>
        {focus && (
          <aside className={styles.inspector} aria-label="Priority explanation">
            <span className={styles.eyebrow}>WHY THIS RANK</span>
            <h3>{focus.title}</h3>
            <p>
              #{focus.rank} · {focus.score.toFixed(1)} policy points ·{" "}
              {(focus.coverage * 100).toFixed(0)}% weighted evidence coverage
            </p>
            <p>
              {focus.readiness}. A high rank is a recommendation for attention;
              it does not authorize an action.
            </p>
            <code>
              {focus.kind}/{focus.record_id}
            </code>
            {focus.entity_id && (
              <button onClick={() => onGraph(focus.entity_id!)}>
                Explore linked Brain Graph ↗
              </button>
            )}
            {focus.warnings.map((w) => (
              <p key={w} className={styles.warning}>
                {w}
              </p>
            ))}
            {focus.factors.map((f) => (
              <details key={f.factor} className={styles.factor}>
                <summary>
                  <span>{f.label}</span>
                  <strong>
                    {f.value === null ? "Unknown" : `+${f.points.toFixed(1)}`}
                  </strong>
                </summary>
                <p>{f.explanation}</p>
                <Evidence rows={f.evidence} />
                <p>
                  <strong>What would change it:</strong> {f.would_change}
                </p>
                <small>
                  Up to {f.available.toFixed(1)} additional points under this
                  policy. Rank also depends on other work.
                </small>
              </details>
            ))}
            <h4>Dependency paths</h4>
            {!focus.paths.length && (
              <p>
                No explicit dependency paths recorded. Absence of links does not
                prove readiness.
              </p>
            )}
            {focus.paths.map((path, i) => (
              <details className={styles.path} key={`${path.direction}:${i}`}>
                <summary>
                  {path.direction === "requires" ? "Requires" : "Can unblock"} ·{" "}
                  {path.nodes.length - 1} hop(s)
                </summary>
                <ol>
                  {path.nodes.map((node, j) => (
                    <li key={node.id}>
                      <span>{j ? "↓" : "◉"}</span>
                      {node.label}
                    </li>
                  ))}
                </ol>
                <Evidence rows={path.evidence} />
              </details>
            ))}
            {!!focus.historical_revenue.length && (
              <details>
                <summary>
                  Historical revenue context · excluded from score
                </summary>
                {focus.historical_revenue.map((r, i) => (
                  <div key={i}>
                    <p>
                      ${r.amount.toLocaleString()} USD · {r.status} attribution
                      · {(r.confidence * 100).toFixed(0)}% confidence. This is
                      not expected revenue for this work.
                    </p>
                    <Evidence rows={r.evidence} />
                  </div>
                ))}
              </details>
            )}
          </aside>
        )}
      </div>
      {report && !busy && !shown.length && (
        <p className={styles.empty}>
          No active work matches this view. Existing task, goal and project
          records will appear here when available.
        </p>
      )}
      {report?.warnings.map((w) => (
        <p key={w} className={styles.warning}>
          {w}
        </p>
      ))}
      {!!report?.excluded.length && (
        <details className={styles.policy}>
          <summary>
            {report.excluded.length} completed, paused or inactive items
            excluded
          </summary>
          <ul>
            {report.excluded.map((row) => (
              <li key={row.id}>
                {row.title} — {row.reason}
              </li>
            ))}
          </ul>
        </details>
      )}
      <p className={styles.footer} aria-live="polite">
        {busy
          ? "Updating evidence"
          : `${shown.length} items shown. ${scenario ? "Preview" : "Recorded evidence"} ranking. No business records modified.`}
      </p>
    </section>
  );
}
