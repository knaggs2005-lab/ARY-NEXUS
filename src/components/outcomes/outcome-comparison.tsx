"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { OutcomeEngine } from "../../services/outcome-engine";
import { api } from "../api";
import styles from "./outcomes.module.css";
type Report = Awaited<ReturnType<OutcomeEngine["report"]>>;
export default function OutcomeComparison() {
  const [report, setReport] = useState<Report | null>(null),
    [revision, refresh] = useState(0),
    [selected, select] = useState<string[]>([]),
    [focus, setFocus] = useState(""),
    [query, setQuery] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    root.current?.scrollIntoView({ block: "start", behavior: "instant" });
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    api("outcome-engine", { signal: controller.signal })
      .then((r) => r.json())
      .then(setReport)
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [revision]);
  async function act(tool: string, input: Record<string, unknown>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api("actions/request", {
        method: "POST",
        body: JSON.stringify({
          tool,
          input,
          request_key: crypto.randomUUID(),
          reason: "Owner-reviewed Outcome Engine learning",
        }),
      });
      refresh((n) => n + 1);
      setNotice("Recorded with evidence and audit history.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not record change");
    } finally {
      setBusy(false);
    }
  }
  const row = report?.rows.find((r) => r.outcome.id === focus);
  function assess(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!row) return;
    const f = new FormData(e.currentTarget);
    try {
      void act("outcome.assess", {
        outcome_id: row.outcome.id,
        revision: row.learning.revision,
        result: f.get("result"),
        achievement: f.get("achievement"),
        confidence: Number(f.get("confidence")),
        correction: f.get("correction"),
        lessons: String(f.get("lessons"))
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
        metrics: JSON.parse(String(f.get("metrics")) || "[]"),
        links: JSON.parse(String(f.get("links")) || "[]"),
        evidence: [{ table: "outcomes", id: row.outcome.id }],
      });
    } catch {
      setError("Metrics and links must be valid JSON arrays.");
    }
  }
  const chosen =
    report?.rows.filter((r) => selected.includes(r.outcome.id)) ?? [];
  return (
    <section
      ref={root}
      className={styles.workspace}
      aria-label="Outcome comparison"
      aria-busy={busy}
    >
      <header className={styles.header}>
        <div>
          <small>OUTCOMES / LEARNING</small>
          <h2>Results become perspective.</h2>
          <p>
            Compare recorded results. Review lessons. Keep every correction.
          </p>
        </div>
        <button disabled={busy} onClick={() => refresh((n) => n + 1)}>
          Refresh outcomes
        </button>
      </header>
      {error && <p role="alert">{error}</p>}
      <p role="status">
        {busy ? "Validating evidence · awaiting review or recording…" : notice}
      </p>
      {!report ? (
        <p>Reading outcome evidence…</p>
      ) : (
        <>
          <div className={styles.toolbar}>
            <input
              aria-label="Search outcomes"
              placeholder="Tool, result, project or skill"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <span>{report.total} recorded · latest 200 available</span>
            <button
              disabled={busy || selected.length < 3}
              onClick={() =>
                void act("outcome.propose", { outcome_ids: selected })
              }
            >
              Find repeated lessons
            </button>
          </div>
          <p className={styles.muted}>
            Select up to four results. Repeated lessons require three
            independent runs of the same tool with failures or explicit
            corrections. Execution success alone does not establish goal
            success.
          </p>
          <div className={styles.library} aria-label="Recorded outcomes">
            {report.rows
              .filter(
                (r) =>
                  !query ||
                  JSON.stringify([r.tool, r.outcome.summary, r.links])
                    .toLowerCase()
                    .includes(query.toLowerCase()),
              )
              .map((r) => (
                <div key={r.outcome.id} className={styles.row}>
                  <input
                    type="checkbox"
                    aria-label={`Compare ${r.outcome.id}`}
                    checked={selected.includes(r.outcome.id)}
                    disabled={
                      !selected.includes(r.outcome.id) && selected.length >= 4
                    }
                    onChange={(e) =>
                      select((old) =>
                        e.target.checked
                          ? [...old, r.outcome.id]
                          : old.filter((id) => id !== r.outcome.id),
                      )
                    }
                  />
                  <button onClick={() => setFocus(r.outcome.id)}>
                    <strong>{r.tool}</strong>
                    <span>{r.assessment?.result ?? r.outcome.summary}</span>
                  </button>
                  <span
                    data-state={r.assessment?.achievement ?? r.outcome.status}
                  >
                    {r.assessment?.achievement ??
                      `execution ${r.outcome.status}`}
                  </span>
                </div>
              ))}
            {!report.rows.length && (
              <p>
                No outcomes yet. Execute a reviewed action to begin collecting
                evidence.
              </p>
            )}
          </div>
          {!!chosen.length && (
            <div
              className={styles.comparison}
              aria-label="Selected outcome comparison"
            >
              {chosen.map((r) => (
                <article key={r.outcome.id}>
                  <small>
                    {new Date(r.outcome.created_at).toLocaleString()}
                  </small>
                  <h3>{r.tool}</h3>
                  <p>{r.assessment?.result ?? r.outcome.summary}</p>
                  <dl>
                    <dt>Execution</dt>
                    <dd>{r.outcome.status}</dd>
                    <dt>Goal achievement</dt>
                    <dd>{r.assessment?.achievement ?? "Unknown"}</dd>
                    <dt>Confidence</dt>
                    <dd>
                      {r.assessment
                        ? `${Math.round(r.assessment.confidence * 100)}% · user assessment`
                        : "Not assessed"}
                    </dd>
                    <dt>Recorded cost</dt>
                    <dd>
                      {r.cost?.amount != null
                        ? `$${r.cost.amount.toFixed(6)} · ${r.cost.basis}`
                        : "Not recorded / restricted"}
                    </dd>
                    <dt>Elapsed</dt>
                    <dd>
                      {r.duration_ms === null
                        ? "Unknown"
                        : `${(r.duration_ms / 1000).toFixed(2)} seconds`}
                    </dd>
                    <dt>Goal / plan</dt>
                    <dd>{r.plan?.goal ?? r.goal?.title ?? "Not linked"}</dd>
                    <dt>Requested by</dt>
                    <dd>{r.agents.join(", ")}</dd>
                    <dt>Corrections</dt>
                    <dd>{r.assessment?.correction || "None recorded"}</dd>
                  </dl>
                  {r.assessment?.metrics.map((m) => (
                    <p key={m.name}>
                      {m.name}:{" "}
                      <strong>
                        {m.value} {m.unit}
                      </strong>
                    </p>
                  ))}
                  {r.links.map((l, i) => (
                    <span className={styles.chip} key={i}>
                      {l.kind}: {l.label}
                    </span>
                  ))}
                  <details>
                    <summary>Source receipts and history</summary>
                    <pre>
                      {JSON.stringify(
                        {
                          outcome_id: r.outcome.id,
                          action: r.action,
                          plan: r.plan,
                          assessments: r.learning.assessments,
                          duration_basis: r.duration_basis,
                        },
                        null,
                        2,
                      )}
                    </pre>
                  </details>
                </article>
              ))}
            </div>
          )}
          {row && (
            <form
              key={`${row.outcome.id}:${row.learning.revision}`}
              className={styles.editor}
              onSubmit={assess}
              aria-label="Assess outcome"
            >
              <h3>Review {row.tool}</h3>
              <p>
                Revision {row.learning.revision}. Your assessment is attributed
                to this review action and the original outcome. It does not
                overwrite the execution receipt.
              </p>
              <label>
                Observed result
                <textarea
                  name="result"
                  required
                  minLength={3}
                  maxLength={2000}
                  defaultValue={row.assessment?.result ?? row.outcome.summary}
                />
              </label>
              <label>
                Goal achievement
                <select
                  name="achievement"
                  defaultValue={row.assessment?.achievement ?? "unknown"}
                >
                  {["unknown", "success", "partial", "failure"].map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </label>
              <label>
                Assessment confidence (0–1)
                <input
                  name="confidence"
                  type="number"
                  min="0"
                  max="1"
                  step="0.05"
                  defaultValue={row.assessment?.confidence ?? 0.5}
                  required
                />
              </label>
              <label>
                User correction
                <textarea
                  name="correction"
                  maxLength={2000}
                  defaultValue={row.assessment?.correction ?? ""}
                />
              </label>
              <label>
                Lessons · one per line
                <textarea
                  name="lessons"
                  defaultValue={row.assessment?.lessons.join("\n") ?? ""}
                />
              </label>
              <details>
                <summary>Metrics and entity / Skill / agent links</summary>
                <p>
                  Use recorded observations only. Metrics: name, value, unit.
                  Links: kind, id, optional Skill version. Strategy entities use
                  metadata.entity_facet = strategy.
                </p>
                <label>
                  Metrics JSON
                  <textarea
                    name="metrics"
                    defaultValue={JSON.stringify(row.assessment?.metrics ?? [])}
                  />
                </label>
                <label>
                  Links JSON
                  <textarea
                    name="links"
                    defaultValue={JSON.stringify(row.assessment?.links ?? [])}
                  />
                </label>
              </details>
              <button disabled={busy}>Review assessment</button>
            </form>
          )}
          <section aria-label="Learned recommendations">
            <h3>Evidence-backed recommendations</h3>
            <p>
              Accepted recommendations are advisory. Core instructions, Skills
              and permissions remain unchanged. Withdraw to reverse acceptance.
            </p>
            {report.recommendations.map((p) => (
              <article className={styles.recommendation} key={p.id}>
                <small>
                  {p.history.at(-1)?.state.toUpperCase()} ·{" "}
                  {report.recommendations.find((x) => x.id === p.id)
                    ?.evidence_current
                    ? "Evidence current"
                    : "Evidence changed — not active"}
                </small>
                <h4>{p.proposal}</h4>
                <p>{p.reason}</p>
                <details>
                  <summary>Evidence and reversible history</summary>
                  <pre>
                    {JSON.stringify(
                      { evidence: p.evidence, history: p.history },
                      null,
                      2,
                    )}
                  </pre>
                </details>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    void act("outcome.review", {
                      outcome_id: p.outcome_id,
                      recommendation_id: p.id,
                      state: f.get("state"),
                      reason: f.get("reason"),
                    });
                  }}
                >
                  <label>
                    Review reason
                    <input
                      name="reason"
                      required
                      minLength={3}
                      maxLength={2000}
                    />
                  </label>
                  {p.history.at(-1)?.state === "proposed" ? (
                    <>
                      <select name="state" aria-label="Recommendation decision">
                        <option value="accepted">
                          Accept advisory recommendation
                        </option>
                        <option value="rejected">Reject recommendation</option>
                      </select>
                      <button disabled={busy}>Review recommendation</button>
                    </>
                  ) : p.history.at(-1)?.state === "accepted" ? (
                    <>
                      <input type="hidden" name="state" value="withdrawn" />
                      <button disabled={busy}>Withdraw recommendation</button>
                    </>
                  ) : (
                    <p>Review complete. History retained.</p>
                  )}
                </form>
              </article>
            ))}
          </section>
        </>
      )}
    </section>
  );
}
