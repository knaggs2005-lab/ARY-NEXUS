"use client";
import dynamic from "next/dynamic";
const OutcomeComparison = dynamic(
  () => import("./outcomes/outcome-comparison"),
);
import { useEffect, useState, type FormEvent } from "react";
import type { RoiService } from "../services/roi-service";
import { EconomicsOverview } from "./economics/economics-overview";
import { currentEntries } from "../domain/roi";
import { api } from "./api";
import styles from "./roi.module.css";
type Report = Awaited<ReturnType<RoiService["report"]>>;
const money = (value: number | null) =>
  value === null
    ? "Not recorded"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
        maximumFractionDigits: 6,
      }).format(value);
const count = (value: number | null, suffix: string) =>
  value === null ? "Not recorded" : `${Number(value.toFixed(2))} ${suffix}`;
const numberFields = [
  ["estimated_compute_cost_usd", "Estimated model compute total (USD)"],
  ["actual_model_cost_usd", "Reported actual model cost (USD)"],
  ["additional_compute_cost_usd", "Additional non-model compute (USD)"],
  ["tool_cost_usd", "Additional tool cost (USD)"],
  ["revenue_influenced_usd", "Revenue influenced (USD)"],
  ["expense_avoided_usd", "Expense avoided (USD)"],
  ["time_saved_minutes", "Time saved (minutes)"],
] as const;
export function RoiDashboard() {
  const [surface, setSurface] = useState<"economics" | "outcomes">("economics");
  return (
    <>
      <nav aria-label="Economics perspective">
        <button
          aria-pressed={surface === "economics"}
          onClick={() => setSurface("economics")}
        >
          Economics
        </button>
        <button
          aria-pressed={surface === "outcomes"}
          onClick={() => setSurface("outcomes")}
        >
          Outcome learning
        </button>
      </nav>
      {surface === "outcomes" ? <OutcomeComparison /> : <EconomicsLedger />}
    </>
  );
}
function EconomicsLedger() {
  const [month, setMonth] = useState(() =>
    new Date().toISOString().slice(0, 7),
  );
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0);
  const [mode, setMode] = useState<"costs" | "outcomes">("costs");
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setReport((previous) => (previous?.month === month ? previous : null));
    setError("");
    api(`roi?month=${encodeURIComponent(month)}`, { signal: controller.signal })
      .then((r) => r.json())
      .then((data) => {
        if (!controller.signal.aborted) setReport(data);
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          setReport(null);
          setError(e.message);
        }
      });
    return () => controller.abort();
  }, [month, revision]);
  const cost = report
    ? currentEntries(report.costHistory).find((c) => c.action_id === target)
    : undefined;
  const impact = report
    ? currentEntries(report.outcomeHistory).find((i) => i.outcome_id === target)
    : undefined;
  const entry = mode === "costs" ? cost : impact;
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload: Record<string, unknown> = {
      parent_id: entry?.id ?? null,
      confidence: Number(form.get("confidence")),
      attribution_notes: form.get("attribution_notes"),
      evidence: form.get("evidence"),
      [mode === "costs" ? "action_id" : "outcome_id"]: target,
    };
    for (const [name] of numberFields.slice(
      mode === "costs" ? 0 : 4,
      mode === "costs" ? 4 : 7,
    )) {
      const raw = String(form.get(name) ?? "").trim();
      if (
        raw === "" &&
        ["additional_compute_cost_usd", "tool_cost_usd"].includes(name) &&
        !(entry && name in entry)
      )
        continue;
      payload[name] = raw === "" ? null : Number(raw);
    }
    if (mode === "outcomes") {
      payload.status = form.get("status");
      payload.effective_at = `${form.get("effective_date")}T12:00:00.000Z`;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api(`roi/${mode}`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setNotice("Recorded. Earlier versions remain in the ledger.");
      setRevision((r) => r + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className={styles.panel} aria-label="Ary Economics">
      <div className={styles.toolbar}>
        <div>
          <span className={styles.eyebrow}>ARY / ECONOMICS</span>
          <h2>Value, made visible.</h2>
          <p>
            USD · monthly UTC · recorded compute costs and attributed outcomes
          </p>
        </div>
        <form
          className={styles.monthForm}
          onSubmit={(event) => {
            event.preventDefault();
            const value = String(
              new FormData(event.currentTarget).get("month"),
            );
            if (value) {
              setMonth(value);
              setRevision((r) => r + 1);
            }
          }}
        >
          <label>
            Accounting month
            <input name="month" type="month" required defaultValue={month} />
          </label>
          <button type="submit">View month</button>
        </form>
      </div>
      <p className={styles.note}>
        No financial accounts are connected. Successful actions carry no assumed
        financial impact. Blank amounts mean unknown, not zero.
      </p>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {!report && !error && <p role="status">Loading accounting records…</p>}
      {report && (
        <>
          <EconomicsOverview report={report} />
          <div className={styles.coverage}>
            <h3>Coverage & uncertainty</h3>
            {report.unresolvedOverlapRows > 0 && (
              <p role="status">
                {report.unresolvedOverlapRows} legacy cost assessments may
                overlap unlinked calls. They are excluded from cost totals; net
                contribution and ROI are withheld until attribution is
                reconciled.
              </p>
            )}
            <p>
              Reported actual model cost: {money(report.reportedActualCost)} ·
              Estimated model cost: {money(report.estimatedCost)}.
            </p>
            <p>
              {report.unknownCostRows} action/call rows have no cost recorded;{" "}
              {report.unknownModelRows} rows have no model cost subtotal;{" "}
              {report.unknownCalls} model calls have unknown pricing.{" "}
              {report.unlinkedCalls} unlinked calls are counted once.{" "}
              {report.unassessedOutcomes} outcomes have no impact assessment.
            </p>
            <p>
              Uncertain attribution, excluded from headline benefits: revenue{" "}
              {money(report.uncertain.revenue)} · expenses{" "}
              {money(report.uncertain.expenses)} · time{" "}
              {count(report.uncertain.minutes, "minutes")}.
            </p>
            <small>
              Totals cover known records only, not a complete operating budget.
              Hosting and tool costs are included only when explicitly
              attributed; unrecorded overhead is not included. Actual amounts
              are user-reported with evidence, not verified against a bill. A
              zero or unknown cost denominator has no ROI multiple.
            </small>
          </div>
          <details className={styles.editor}>
            <summary>Record or revise accounting evidence</summary>
            <p>
              Record model cost once per action, plus separately attributed
              compute/tool costs. Each linked outcome has its own impact
              assessment. Do not repeat the same revenue or saving across
              outcomes; attribution notes should explain the portion credited to
              Ary.
            </p>
            <div className={styles.grid}>
              <label>
                Record type
                <select
                  value={mode}
                  disabled={busy}
                  onChange={(e) => {
                    setMode(e.target.value as typeof mode);
                    setTarget("");
                  }}
                >
                  <option value="costs">Action cost</option>
                  <option value="outcomes">Outcome impact</option>
                </select>
              </label>
              <label>
                {mode === "costs" ? "Action" : "Outcome"}
                <select
                  value={target}
                  disabled={busy}
                  onChange={(e) => setTarget(e.target.value)}
                >
                  <option value="">Select a record…</option>
                  {mode === "costs"
                    ? [...report.actions].reverse().map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.label} · {a.created_at.slice(0, 16)} · {a.status} ·{" "}
                          {a.id.slice(0, 8)}
                        </option>
                      ))
                    : [...report.outcomes].reverse().map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.summary} · {o.status} · {o.id.slice(0, 8)}
                        </option>
                      ))}
                </select>
              </label>
            </div>
            {target && (
              <form key={`${mode}-${target}-${entry?.id}`} onSubmit={save}>
                <fieldset disabled={busy} className={styles.fields}>
                  <legend>
                    {entry ? "Append a revision" : "New assessment"}
                  </legend>
                  {mode === "costs" && (
                    <p>
                      Model amounts replace the linked model telemetry subtotal.
                      Additional compute and tool amounts are added once;
                      exclude any amount already represented in another
                      category. Costs are assigned to the action’s start month.
                      Leave actual cost blank unless a billed amount is
                      available. Separate compute/tool fields require the
                      Economics database migration (011).
                    </p>
                  )}
                  <div className={styles.grid}>
                    {numberFields
                      .slice(mode === "costs" ? 0 : 4, mode === "costs" ? 4 : 7)
                      .map(([name, label]) => (
                        <label key={name}>
                          {label}
                          <input
                            name={name}
                            type="number"
                            min="0"
                            max="1000000000000"
                            step="any"
                            placeholder="Unknown"
                            defaultValue={
                              (
                                entry as unknown as Record<
                                  string,
                                  number | null
                                >
                              )?.[name] ?? ""
                            }
                          />
                        </label>
                      ))}
                    <label>
                      Attribution confidence (0–1)
                      <input
                        name="confidence"
                        type="number"
                        min="0"
                        max="1"
                        step="0.01"
                        required
                        defaultValue={entry?.confidence ?? 0.5}
                      />
                    </label>
                    {mode === "outcomes" && (
                      <>
                        <label>
                          Outcome attribution status
                          <select
                            name="status"
                            defaultValue={impact?.status ?? "pending"}
                          >
                            <option value="pending">Pending evidence</option>
                            <option value="estimated">
                              Estimated / uncertain
                            </option>
                            <option value="confirmed">
                              Confirmed with evidence
                            </option>
                            <option value="rejected">
                              Rejected / excluded
                            </option>
                          </select>
                        </label>
                        <label>
                          Impact date (UTC)
                          <input
                            name="effective_date"
                            type="date"
                            required
                            defaultValue={
                              impact?.effective_at.slice(0, 10) ??
                              new Date().toISOString().slice(0, 10)
                            }
                          />
                        </label>
                      </>
                    )}
                  </div>
                  <label>
                    Attribution notes
                    <textarea
                      name="attribution_notes"
                      required
                      maxLength={4000}
                      defaultValue={entry?.attribution_notes ?? ""}
                      placeholder="What changed, supporting comparison, Ary’s contribution, and uncertainty"
                    />
                  </label>
                  <label>
                    Evidence reference
                    <input
                      name="evidence"
                      maxLength={2000}
                      defaultValue={entry?.evidence ?? ""}
                      placeholder="Record, measurement, or invoice reference; no credentials"
                    />
                  </label>
                  <small>
                    Confirmed impact requires evidence and confidence 1. Use
                    estimated when attribution is uncertain. Pending and
                    rejected assessments never contribute to totals.
                  </small>
                  <button type="submit">
                    {busy
                      ? "Saving…"
                      : entry
                        ? "Save revision"
                        : "Record evidence"}
                  </button>
                </fieldset>
              </form>
            )}
          </details>
          <h3>Outcome attribution</h3>
          {!report.impactRows.length ? (
            <p>
              No impact recorded for this month. Revenue, savings, and ROI
              remain unknown.
            </p>
          ) : (
            <div className={styles.scroll}>
              <table>
                <thead>
                  <tr>
                    <th>Outcome</th>
                    <th>Status / confidence</th>
                    <th>Revenue</th>
                    <th>Expense avoided</th>
                    <th>Minutes saved</th>
                    <th>Evidence & attribution</th>
                  </tr>
                </thead>
                <tbody>
                  {report.impactRows.map((i) => (
                    <tr key={i.id}>
                      <td>
                        {i.summary}
                        <small>
                          Operational status:{" "}
                          {i.outcome_status ?? "unavailable"}
                        </small>
                      </td>
                      <td>
                        {i.status} · {Math.round(i.confidence * 100)}%
                        <small>
                          {i.exclusion ?? "Included in confirmed totals"}
                        </small>
                      </td>
                      <td>{money(i.revenue_influenced_usd)}</td>
                      <td>{money(i.expense_avoided_usd)}</td>
                      <td>{count(i.time_saved_minutes, "min")}</td>
                      <td>
                        {i.attribution_notes}
                        <small>{i.evidence || "No evidence reference"}</small>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <details>
            <summary>Cost ledger ({report.costRows.length} rows)</summary>
            <div className={styles.scroll}>
              <table>
                <thead>
                  <tr>
                    <th>Action / call</th>
                    <th>Recorded cost</th>
                    <th>Basis</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {report.costRows.map((c) => (
                    <tr key={c.action_id}>
                      <td>
                        {c.label}
                        <small>{c.at}</small>
                      </td>
                      <td>
                        {money(c.amount)}
                        <small>
                          Model {money(c.model_amount)} · Compute{" "}
                          {money(c.compute_amount)} · Tools{" "}
                          {money(c.tool_amount)}
                        </small>
                      </td>
                      <td>
                        {`Model: ${c.basis.replaceAll("_", " ")}`}
                        {c.confidence !== null &&
                          ` · ${Math.round(c.confidence * 100)}% confidence`}
                      </td>
                      <td>{c.notes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
          <details>
            <summary>
              Immutable assessment history (
              {report.costHistory.length + report.outcomeHistory.length}{" "}
              versions)
            </summary>
            {[...report.costHistory, ...report.outcomeHistory]
              .sort((a, b) => b.created_at.localeCompare(a.created_at))
              .map((h) => (
                <article className={styles.history} key={h.id}>
                  <strong>
                    {"action_id" in h ? "Action cost" : "Outcome impact"} ·{" "}
                    {h.created_at}
                  </strong>
                  <p>{h.attribution_notes}</p>
                  <small>
                    ID {h.id} ·{" "}
                    {h.parent_id
                      ? `Revises ${h.parent_id}`
                      : "Initial assessment"}
                  </small>
                  <pre>{JSON.stringify(h, null, 2)}</pre>
                </article>
              ))}
            {!report.costHistory.length && !report.outcomeHistory.length && (
              <p>No assessments yet.</p>
            )}
          </details>
        </>
      )}
    </section>
  );
}
