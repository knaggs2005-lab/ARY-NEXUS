"use client";
import { useEffect, useRef, useState } from "react";
import {
  boardRoles,
  type BoardEvent,
  type BoardReport,
  type BoardRoleResult,
} from "@/domain/board";
import { presenceOperation } from "../presence/store";
import { api } from "../api";
import styles from "./board.module.css";
export function BoardView({ onGraph }: { onGraph: (id: string) => void }) {
  const [focus, setFocus] = useState("");
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState("Ready when you are");
  const [running, setRunning] = useState<string[]>([]);
  const [roles, setRoles] = useState<BoardRoleResult[]>([]);
  const [report, setReport] = useState<BoardReport | null>(null);
  const [history, setHistory] = useState<BoardReport[]>([]);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    api("board/meetings", { signal: abort.signal })
      .then((r) => r.json())
      .then(setHistory)
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      });
    return () => {
      abort.abort();
      controller.current?.abort();
    };
  }, []);
  function show(saved: BoardReport) {
    setReport(saved);
    setRoles(saved.roles);
    setStage(
      saved.status === "complete"
        ? "Brief ready"
        : "Partial brief — review gaps",
    );
    setError("");
  }
  async function start() {
    if (controller.current) return;
    const activity = presenceOperation("Waiting for Board Meeting");
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setReport(null);
    setRoles([]);
    setRunning([]);
    setError("");
    setStage("Opening the shared workspace");
    let completed = false;
    try {
      const response = await api("board/meetings", {
        method: "POST",
        body: JSON.stringify({ focus, request_key: crypto.randomUUID() }),
        signal: abort.signal,
      });
      const reader = response.body!.getReader(),
        decoder = new TextDecoder();
      let buffer = "";
      const receive = (event: BoardEvent) => {
        if (event.type === "stage") {
          activity.update({
            operation: event.role ?? "board",
            state: "delegating",
            label: event.stage,
          });
          setStage(event.stage);
          if (event.role) setRunning((v) => [...new Set([...v, event.role!])]);
        }
        if (event.type === "role") {
          activity.update({
            operation: event.result.role,
            state: event.result.status === "failed" ? "error" : "complete",
            label: event.result.role,
            terminal: true,
          });
          setRoles((v) => [
            ...v.filter((r) => r.role !== event.result.role),
            event.result,
          ]);
          setRunning((v) => v.filter((r) => r !== event.result.role));
        }
        if (event.type === "error") throw new Error(event.error);
        if (event.type === "complete") {
          completed = true;
          activity.finish(
            event.report.status === "partial" ? "error" : "complete",
            event.report.status === "partial"
              ? "Board brief has gaps"
              : "Board brief saved",
          );
          show(event.report);
          setHistory((v) =>
            [event.report, ...v.filter((r) => r.id !== event.report.id)].slice(
              0,
              20,
            ),
          );
        }
      };
      for (;;) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split("\n");
        buffer = lines.pop()!;
        for (const line of lines) if (line.trim()) receive(JSON.parse(line));
        if (done) {
          if (buffer.trim()) receive(JSON.parse(buffer));
          break;
        }
      }
      if (!completed)
        throw new Error(
          "Connection ended before a saved brief was confirmed. Check previous meetings before retrying.",
        );
    } catch (e) {
      activity.finish(
        abort.signal.aborted ? "waiting" : "error",
        "Board Meeting stopped",
      );
      setError(
        abort.signal.aborted
          ? "Meeting stopped. Any completed brief remains in previous meetings; no tasks were executed."
          : e instanceof Error
            ? e.message
            : "Meeting failed",
      );
      setStage("Meeting stopped");
    } finally {
      controller.current = null;
      setBusy(false);
      setRunning([]);
    }
  }
  const findings = roles.flatMap((r) => r.findings);
  return (
    <section className={styles.board} aria-label="Daily Board Meeting">
      <div className={styles.toolbar}>
        <div>
          <span className={styles.eyebrow}>ARY / DAILY BOARD</span>
          <h2>Make today count.</h2>
          <p>
            Shared memory. Six perspectives. Recommendations for your review.
          </p>
        </div>
        <div className={styles.controls}>
          <label>
            Meeting focus{" "}
            <input
              value={focus}
              maxLength={300}
              disabled={busy}
              onChange={(e) => setFocus(e.target.value)}
              placeholder="Optional: focus the daily review"
            />
          </label>
          {busy ? (
            <button onClick={() => controller.current?.abort()}>
              Stop meeting
            </button>
          ) : (
            <button className="primary" onClick={start}>
              Start daily meeting
            </button>
          )}
        </div>
      </div>
      <div className={styles.stage} role="status">
        <span className={busy ? styles.pulse : styles.dot} />
        {stage}
        <small>Advisory only</small>
      </div>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <div className={styles.agents}>
        {boardRoles.map((role, i) => {
          const result = roles.find((r) => r.role === role);
          const active = running.includes(role);
          return (
            <article
              key={role}
              className={`${styles.agent} ${active ? styles.active : ""}`}
              data-state={result?.status ?? (active ? "running" : "waiting")}
            >
              <span className={styles.agentNumber}>0{i + 1}</span>
              <h3>{role}</h3>
              <small>
                {result?.status ??
                  (active ? "Reviewing shared evidence" : "Waiting")}
              </small>
              <p>
                {result?.summary ??
                  (role === "CEO Ary"
                    ? "Consolidates the daily plan"
                    : role === "Analyst Ary"
                      ? "Ranks findings and explains tradeoffs"
                      : "Reads the central workspace")}
              </p>
              {result?.error && <p className={styles.error}>{result.error}</p>}
              {result && (
                <small>
                  {result.provider} · {result.model}
                  {result.metrics
                    ? ` · ${(result.metrics.latency_ms / 1000).toFixed(1)}s`
                    : ""}
                </small>
              )}
            </article>
          );
        })}
      </div>
      <div className={styles.flow} aria-hidden="true">
        <span /> Perspectives → Analyst ranking → CEO brief <span />
      </div>
      <div className={styles.content}>
        <section aria-label="Consolidated daily plan" className={styles.brief}>
          <span className={styles.eyebrow}>TODAY’S DIRECTION</span>
          <h3>
            {report ? report.summary : "Your next clear move starts here."}
          </h3>
          {report?.status === "partial" && (
            <p className={styles.error}>
              Partial meeting. Review failed roles before relying on this brief.
            </p>
          )}
          {!report && (
            <p>
              Findings will arrive as each review completes. The final plan
              appears after ranking and consolidation.
            </p>
          )}
          {report && report.plan.length === 0 && (
            <p>
              No consolidated actions proposed. Review findings and missing
              evidence below.
            </p>
          )}
          <ol className={styles.plan}>
            {report?.plan.map((item, i) => {
              const finding = findings.find((f) => f.id === item.finding_id);
              return (
                <li key={item.finding_id}>
                  <span>{String(i + 1).padStart(2, "0")}</span>
                  <div>
                    <strong>{item.next_step}</strong>
                    <p>{finding?.observation}</p>
                    <small>{finding?.role} · proposal</small>
                    <div className={styles.links}>
                      {finding?.evidence.map((key) => {
                        const evidence = report.evidence.find(
                          (e) => e.key === key,
                        );
                        return evidence ? (
                          <button
                            key={key}
                            disabled={!evidence.entity_id}
                            title={evidence.detail}
                            onClick={() =>
                              evidence.entity_id && onGraph(evidence.entity_id)
                            }
                          >
                            {evidence.label}
                            {evidence.entity_id ? " ↗" : ""}
                          </button>
                        ) : null;
                      })}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
          {report && (
            <footer>
              {(report.latency_ms / 1000).toFixed(1)}s ·{" "}
              {report.created_at.slice(0, 10)} · Saved in shared conversation
              history<p>{report.warnings.join(" ")}</p>
            </footer>
          )}
        </section>
        <aside className={styles.findings} aria-label="Board findings">
          <h3>
            Evidence coming together <small>{findings.length}</small>
          </h3>
          {findings.length === 0 && <p>No findings yet.</p>}
          {(report?.ranked_findings.length
            ? report.ranked_findings.map((id) =>
                findings.find((f) => f.id === id)!,
              )
            : findings
          ).map((f, i) => (
            <details key={f.id}>
              <summary>
                {report?.ranked_findings.length ? `${i + 1}. ` : ""}
                {f.observation}
              </summary>
              <p>{f.next_step}</p>
              <small>
                {f.role} · {Math.round(f.confidence * 100)}% model confidence
              </small>
              {f.evidence.map((key) => {
                const e = report?.evidence.find((e) => e.key === key);
                return (
                  <p key={key}>
                    {e
                      ? `${e.label} · ${e.score === null ? "Retrieved evidence" : `${e.score} priority points`}`
                      : `Evidence ${key}`}
                  </p>
                );
              })}
            </details>
          ))}
        </aside>
      </div>
      {report && (
        <details className={styles.evidence}>
          <summary>Shared evidence · {report.evidence.length} records</summary>
          {report.evidence.map((e) => (
            <article key={e.key}>
              <strong>
                {e.key} · {e.label}
              </strong>
              <p>{e.detail}</p>
              <small>
                {e.table} / {e.id}
              </small>
            </article>
          ))}
        </details>
      )}
      <div className={styles.history}>
        <h3>Previous meetings</h3>
        {history.length === 0 ? (
          <p>No saved meetings yet.</p>
        ) : (
          history.map((r) => (
            <button key={r.id} disabled={busy} onClick={() => show(r)}>
              {new Date(r.created_at).toLocaleString()} · {r.status} ·{" "}
              {r.focus || "Daily review"}
            </button>
          ))
        )}
      </div>
    </section>
  );
}
