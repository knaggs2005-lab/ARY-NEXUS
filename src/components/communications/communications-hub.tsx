"use client";
import { useEffect, useState } from "react";
import type {
  CommunicationsSnapshot,
  CommunicationSource,
} from "../../domain/communications";
import { api } from "../api";
import { CommunicationPlanner } from "./communication-planner";
import styles from "../gmail/gmail.module.css";

export function CommunicationsHub({
  onSource,
  onNavigate,
}: {
  onSource: (source: CommunicationSource) => void;
  onNavigate: (
    tab: "Calls" | "Calendar" | "Approvals" | "Action history" | "Activity",
  ) => void;
}) {
  const [data, setData] = useState<CommunicationsSnapshot | null>(null);
  const [error, setError] = useState("");
  const [revision, refresh] = useState(0);
  const [entity, setEntity] = useState("");
  const [offset, setOffset] = useState(0);
  const [followOnly, setFollowOnly] = useState(false);
  const [busy, setBusy] = useState(true);
  useEffect(() => {
    let alive = true;
    setBusy(true);
    setError("");
    void api(
      `communications?offset=${offset}${entity ? `&entity_id=${encodeURIComponent(entity)}` : ""}`,
    )
      .then((r) => r.json())
      .then((result: CommunicationsSnapshot) => {
        if (alive) setData(result);
      })
      .catch((e) => {
        if (alive) {
          setError((e as Error).message);
          setData(null);
        }
      })
      .finally(() => {
        if (alive) setBusy(false);
      });
    return () => {
      alive = false;
    };
  }, [revision, entity, offset]);
  const date = (value: string | null) =>
    value ? new Date(value).toLocaleString() : "Not established";
  return (
    <section
      className={styles.mail}
      aria-label="Ary Communications Hub"
      aria-busy={busy}
    >
      <header>
        <span className={styles.eyebrow}>
          ARY / SHARED COMMUNICATION CONTEXT
        </span>
        <h2>Every conversation, in context.</h2>
        <p>
          Source-linked history. Deliberate follow-ups. Nothing sends
          automatically.
        </p>
      </header>
      <CommunicationPlanner onHistory={() => onNavigate("Action history")} />
      <div className={styles.toolbar}>
        <button aria-pressed={!followOnly} onClick={() => setFollowOnly(false)}>
          Unified timeline
        </button>
        <button aria-pressed={followOnly} onClick={() => setFollowOnly(true)}>
          Who do I need to follow up with?
        </button>
        <button disabled={busy} onClick={() => refresh((v) => v + 1)}>
          Refresh observed history
        </button>
        <button onClick={() => onNavigate("Approvals")}>
          Open approval queue
        </button>
        {entity && (
          <button
            onClick={() => {
              setEntity("");
              setOffset(0);
            }}
          >
            All people and projects
          </button>
        )}
      </div>
      {busy && (
        <p role="status" className={styles.pulse}>
          Connecting observed context…
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {data && !busy && (
        <>
          <p className={styles.fine}>
            Observed at {date(data.observed_at)} · {data.total} source records ·{" "}
            {data.follow_ups.length} open follow-ups · {data.approvals.length}{" "}
            pending approvals
          </p>
          <div className={styles.layout}>
            <aside
              className={styles.rail}
              aria-label="Communication contacts and projects"
            >
              {data.people.map((p) => (
                <article className={styles.candidate} key={p.entity.id}>
                  <button
                    aria-pressed={entity === p.entity.id}
                    onClick={() => {
                      setEntity(p.entity.id);
                      setOffset(0);
                    }}
                  >
                    {p.entity.type} · {p.entity.name}
                  </button>
                  <small>Last observed contact · {date(p.last_contact)}</small>
                  <p>{p.suggested_next_action}</p>
                  <small>
                    {p.open_follow_ups} follow-ups · {p.unanswered_threads}{" "}
                    awaiting observed reply · {p.pending_approvals} approvals
                  </small>
                  <details>
                    <summary>Why this priority · {p.score}</summary>
                    <p>{p.reasons.join(" · ") || "Scheduled context only."}</p>
                    <p>
                      Score: overdue task 100, approval 50, open task 30,
                      inbound review 20, outbound without observed reply 10,
                      call review 5. Counts add; these are review priorities,
                      not outreach instructions.
                    </p>
                  </details>
                </article>
              ))}
              {!data.people.length && (
                <p>
                  No linked communication history yet. Read a relevant Gmail
                  thread, inspect a call, or load Calendar context through the
                  existing tools.
                </p>
              )}
            </aside>
            <div className={styles.context}>
              {followOnly ? (
                <>
                  <h3>Follow-up intelligence</h3>
                  <p>
                    Review existing commitments first. Refresh source
                    conversations before deciding to contact anyone.
                  </p>
                  {!data.follow_ups.length &&
                    !data.approvals.length &&
                    !data.people.some((p) => p.score > 0) && (
                      <p>No supported follow-up is currently recorded.</p>
                    )}
                  {data.follow_ups.map((t) => (
                    <article key={t.id} className={styles.message}>
                      <strong>{t.title}</strong>
                      <p>
                        {t.status} · Due {date(t.due_at)}
                      </p>
                      <small>
                        Task {t.id} · Source action {t.source_action_id}
                      </small>
                      <button onClick={() => onNavigate("Activity")}>
                        Review existing task
                      </button>
                    </article>
                  ))}
                  {data.approvals.map((p) => (
                    <article key={p.action_id} className={styles.candidate}>
                      <strong>
                        {p.tool} · {p.state.replaceAll("_", " ")}
                      </strong>
                      <p>{p.reason}</p>
                      <small>
                        {date(p.created_at)} · Action {p.action_id}
                      </small>
                      <button onClick={() => onNavigate("Approvals")}>
                        Inspect approval
                      </button>
                    </article>
                  ))}
                </>
              ) : (
                <>
                  <h3>Unified timeline</h3>
                  {!data.timeline.length && (
                    <p>No observed source records for this selection.</p>
                  )}
                  {data.timeline.map((entry) => (
                    <article key={entry.id} className={styles.message}>
                      <span className={styles.eyebrow}>
                        {entry.source.channel} ·{" "}
                        {entry.state.replaceAll("_", " ")}
                      </span>
                      <h3>{entry.title}</h3>
                      <small>{date(entry.occurred_at)}</small>
                      <p>{entry.summary}</p>
                      <div className={styles.chips}>
                        {entry.context_entity_ids.map((id) => {
                          const p = data.people.find((p) => p.entity.id === id);
                          return p ? (
                            <button
                              key={id}
                              onClick={() => {
                                setEntity(id);
                                setOffset(0);
                              }}
                            >
                              {p.entity.name}
                              {!entry.entity_ids.includes(id)
                                ? " · related"
                                : ""}
                            </button>
                          ) : null;
                        })}
                      </div>
                      <p className={styles.fine}>{entry.evidence}</p>
                      <small>
                        Source {entry.source.record_id} · Action{" "}
                        {entry.source.action_id} · Observed{" "}
                        {date(entry.observed_at)}
                      </small>
                      <div className={styles.toolbar}>
                        <button onClick={() => onSource(entry.source)}>
                          Open {entry.source.channel} source
                        </button>
                        <button onClick={() => onNavigate("Action history")}>
                          Inspect audit history
                        </button>
                      </div>
                    </article>
                  ))}
                  <div className={styles.toolbar}>
                    <button
                      disabled={offset === 0}
                      onClick={() => setOffset((v) => Math.max(0, v - 50))}
                    >
                      Previous sources
                    </button>
                    <button
                      disabled={!data.has_more}
                      onClick={() => setOffset((v) => v + 50)}
                    >
                      More sources
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
          <details>
            <summary>Coverage and evidence boundaries</summary>
            {data.coverage.map((note) => (
              <p key={note}>{note}</p>
            ))}
          </details>
        </>
      )}
    </section>
  );
}
