"use client";
import { useEffect, useState, useRef, type FormEvent } from "react";
import type { GmailProvider } from "../../domain/gmail";
import type { CommunicationSource } from "../../domain/communications";
import type { GmailService } from "../../services/gmail-service";
import { api } from "../api";
import { MailReview } from "./mail-review";
import styles from "./gmail.module.css";
type Thread = Awaited<ReturnType<GmailService["read"]>>;
type Analysis = Awaited<ReturnType<GmailService["summarize"]>>;
const steps = ["Read", "Understand", "Draft", "Approval", "Sent"];
export function GmailView({ source }: { source?: CommunicationSource }) {
  const [status, setStatus] = useState<Awaited<
      ReturnType<GmailProvider["status"]>
    > | null>(null),
    [query, setQuery] = useState("newer_than:14d"),
    [list, setList] = useState<Awaited<
      ReturnType<GmailProvider["search"]>
    > | null>(null),
    [thread, setThread] = useState<Thread | null>(null),
    [analysis, setAnalysis] = useState<Analysis | null>(null),
    [analysisId, setAnalysisId] = useState(""),
    [draftId, setDraftId] = useState("");
  const [instruction, setInstruction] = useState(
      "Prepare a concise response grounded in this conversation. Do not invent commitments.",
    ),
    [to, setTo] = useState(""),
    [cc, setCc] = useState(""),
    [subject, setSubject] = useState(""),
    [body, setBody] = useState(""),
    [operation, setOperation] = useState(() => crypto.randomUUID());
  const [phase, setPhase] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [launch, setLaunch] = useState(""),
    [sent, setSent] = useState<{
      message_id: string;
      thread_id: string;
      recovered: boolean;
    } | null>(null);
  const alive = useRef(true),
    activeWork = useRef(false),
    connectionId = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    alive.current = true;
    void connection();
    return () => {
      alive.current = false;
    };
  }, []);
  const openedSource = useRef("");
  useEffect(() => {
    if (!source || !status || openedSource.current === source.action_id) return;
    openedSource.current = source.action_id;
    if (!status.connected || status.connection_id !== source.connection_id) {
      setNotice(
        "This source belongs to a disconnected or different Gmail connection. Reconnect its account before reading it.",
      );
      return;
    }
    void read(source.record_id, source.connection_id);
  }, [source, status]);
  function clear() {
    setThread(null);
    setAnalysis(null);
    setDraftId("");
    setAnalysisId("");
    setSent(null);
    setList(null);
    setPhase(0);
  }
  async function connection() {
    try {
      const value = await (await api("gmail/status")).json();
      if (alive.current) {
        if (connectionId.current !== value.connection_id) {
          clear();
          connectionId.current = value.connection_id;
        }
        setStatus(value);
      }
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    }
  }
  async function work(run: () => Promise<void>) {
    if (activeWork.current) return;
    activeWork.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await run();
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      activeWork.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function request(tool: string, input: unknown) {
    return await (
      await api("actions/request", {
        method: "POST",
        body: JSON.stringify({
          tool,
          input,
          request_key: crypto.randomUUID(),
          reason:
            tool === "gmail.send"
              ? "User reviewed the exact recipients and message text."
              : "User selected this conversation and requested " + tool,
        }),
      })
    ).json();
  }
  async function search(e: FormEvent) {
    e.preventDefault();
    await work(async () => {
      clear();
      const result = await request("gmail.search", { query });
      if (alive.current) setList(result.result);
    });
  }
  async function read(id: string, sourceConnection?: string) {
    await work(async () => {
      setThread(null);
      setAnalysis(null);
      setDraftId("");
      setSent(null);
      setPhase(0);
      const result = await request("gmail.read", {
        connection_id: sourceConnection ?? list?.connection_id,
        thread_id: id,
      });
      if (alive.current) setThread(result.result);
    });
  }
  async function understand() {
    if (!thread) return;
    await work(async () => {
      const result = await request("gmail.summarize", {
        connection_id: thread.connection_id,
        thread_id: thread.id,
      });
      if (alive.current) {
        setAnalysis(result.result);
        setAnalysisId(result.action_id);
        setThread(result.result.thread);
        setPhase(1);
      }
    });
  }
  async function draft() {
    if (!thread) return;
    await work(async () => {
      const result = await request("gmail.draft", {
        connection_id: thread.connection_id,
        thread_id: thread.id,
        instruction,
      });
      if (alive.current) {
        setDraftId(result.action_id);
        setSubject(result.result.subject);
        setBody(result.result.body);
        setTo("");
        setCc("");
        setOperation(crypto.randomUUID());
        setSent(null);
        setPhase(2);
      }
    });
  }
  const recipients = (s: string) =>
    s
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
  const sendInput = {
    connection_id: thread?.connection_id,
    operation_id: operation,
    draft_action_id: draftId,
    from_account: thread?.account,
    to: recipients(to),
    cc: recipients(cc),
    subject,
    body,
    source_thread_id: thread?.id,
  };
  async function send(e: FormEvent) {
    e.preventDefault();
    await work(async () => {
      setPhase(3);
      try {
        const result = await request("gmail.send", sendInput);
        if (alive.current) {
          setSent(result.result);
          setPhase(4);
          setNotice(
            result.result.recovered
              ? "Existing send receipt recovered. No second email was sent."
              : "Gmail accepted this message. Delivery is not independently confirmed.",
          );
        }
      } catch (e) {
        setPhase(2);
        throw e;
      }
    });
  }
  return (
    <section className={styles.mail} aria-label="Ary Communications">
      <header>
        <span className={styles.eyebrow}>ARY / COMMUNICATIONS</span>
        <h2>Context before correspondence.</h2>
        <p>
          Read deliberately. Understand the conversation. Review every send.
        </p>
        <nav aria-label="Communication stage" className={styles.steps}>
          {steps.map((step, i) => (
            <span
              key={step}
              aria-current={phase === i ? "step" : undefined}
              data-done={phase > i}
            >
              {String(i + 1).padStart(2, "0")} · {step}
            </span>
          ))}
        </nav>
      </header>
      <div className={styles.toolbar}>
        <span>
          {status?.connected ? status.account : "Gmail is not connected"}
        </span>
        <button disabled={busy} onClick={() => void connection()}>
          Refresh connection
        </button>
        <button
          disabled={busy || !status?.configured}
          onClick={() =>
            void work(async () =>
              setLaunch(
                (
                  await (
                    await api("gmail/connect", {
                      method: "POST",
                      body: JSON.stringify({ write: false }),
                    })
                  ).json()
                ).launch_url,
              ),
            )
          }
        >
          Connect read-only
        </button>
        <button
          disabled={busy || !status?.configured}
          onClick={() =>
            void work(async () =>
              setLaunch(
                (
                  await (
                    await api("gmail/connect", {
                      method: "POST",
                      body: JSON.stringify({ write: true }),
                    })
                  ).json()
                ).launch_url,
              ),
            )
          }
        >
          Enable approved sending
        </button>
        {status?.connected && (
          <button
            disabled={busy}
            onClick={() =>
              void work(async () => {
                const result = await (
                  await api("gmail/disconnect", { method: "POST", body: "{}" })
                ).json();
                clear();
                setLaunch("");
                await connection();
                setNotice(
                  result.revoked
                    ? "Gmail disconnected."
                    : "Disconnected locally; remove Ary's grant in Google because remote revocation failed.",
                );
              })
            }
          >
            Disconnect
          </button>
        )}
        {launch && (
          <a target="_blank" rel="noreferrer" href={launch}>
            Continue securely in Google →
          </a>
        )}
      </div>
      {!status?.configured && (
        <p className={styles.note}>
          Gmail OAuth setup is required on the Ary server. Calendar consent does
          not grant email access.
        </p>
      )}
      <form onSubmit={search} className={styles.toolbar}>
        <label>
          Find relevant conversations
          <input
            required
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="project name, from:person, newer_than:14d"
          />
        </label>
        <button disabled={busy || !status?.connected}>Find context</button>
      </form>
      {busy && (
        <p className={styles.pulse} role="status">
          Working through context and permissions…
        </p>
      )}
      {error && (
        <p role="alert" className={styles.note}>
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <div className={styles.layout}>
        <aside className={styles.rail} aria-label="Relevant conversations">
          {list?.threads.map((t) => (
            <button
              disabled={busy}
              key={t.id}
              aria-pressed={thread?.id === t.id}
              onClick={() => void read(t.id)}
            >
              {t.snippet.slice(0, 220)}
              <small>Open conversation →</small>
            </button>
          ))}
          {list?.threads.length === 0 && <p>No matching conversations.</p>}
          {list?.next_page && (
            <p>More matches exist. Narrow the search for focused context.</p>
          )}
        </aside>
        <div className={styles.context}>
          {!thread && (
            <p>
              Select a relevant conversation. Reading does not create long-term
              memories.
            </p>
          )}
          {thread && (
            <>
              <div className={styles.chips}>
                {thread.entities.map((e) => (
                  <span key={e.id}>
                    {e.type} · {e.name}
                  </span>
                ))}
              </div>
              <h3>{thread.messages.at(-1)?.subject || "Conversation"}</h3>
              {thread.truncated && (
                <p className={styles.note}>
                  Partial conversation: only the last bounded messages are
                  available.
                </p>
              )}
              <details open={!analysis && !draftId}>
                <summary>
                  Conversation context · {thread.messages.length} messages
                </summary>
                {thread.messages.map((m) => (
                  <article className={styles.message} key={m.id}>
                    <strong>{m.from}</strong>
                    <small>
                      {Number.isFinite(Date.parse(m.date))
                        ? new Date(m.date).toLocaleString()
                        : "Date unavailable"}{" "}
                      · To {m.to}
                    </small>
                    <p>
                      {m.body_available
                        ? m.text
                        : "No supported plain-text body. HTML and attachments are not loaded."}
                    </p>
                    {m.truncated && (
                      <small>
                        Text truncated; excluded from memory proposals.
                      </small>
                    )}
                  </article>
                ))}
              </details>
              <div className={styles.toolbar}>
                <button disabled={busy} onClick={() => void understand()}>
                  Understand conversation
                </button>
              </div>
              {analysis && (
                <section
                  className={styles.analysis}
                  aria-label="Ary email summary"
                >
                  <span className={styles.eyebrow}>ARY UNDERSTANDING</span>
                  <p>{analysis.summary}</p>
                  <p className={styles.fine}>
                    Email content is attributed evidence, not independently
                    verified truth. Summarizing alone never writes memory. Only
                    individually approved evidence is retained.
                  </p>
                  {analysis.candidates.length === 0 && (
                    <p>No important memory candidates were supported.</p>
                  )}
                  {analysis.candidates.map((c, i) => (
                    <article key={i} className={styles.candidate}>
                      <strong>
                        {c.kind} · importance {Math.round(c.importance * 100)}%
                      </strong>
                      <blockquote>{c.quote}</blockquote>
                      <p>{c.reason}</p>
                      <small>
                        Source message {c.message_id} · confidence{" "}
                        {Math.round(c.confidence * 100)}%
                      </small>
                      <button
                        disabled={busy}
                        onClick={() =>
                          void work(async () => {
                            const r = await request("gmail.evidence", {
                              analysis_action_id: analysisId,
                              candidate_index: i,
                              quote: c.quote,
                            });
                            setNotice(
                              `Reviewed email evidence ${r.result.recovered ? "already exists" : "saved"}. Memory ${r.result.memory_id}`,
                            );
                          })
                        }
                      >
                        Review for memory
                      </button>
                    </article>
                  ))}
                </section>
              )}
              <label className={styles.instruction}>
                Draft intent
                <textarea
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  maxLength={2000}
                />
              </label>
              <button disabled={busy} onClick={() => void draft()}>
                Prepare draft
              </button>
              {draftId && (
                <form
                  onSubmit={send}
                  className={styles.draft}
                  aria-label="Proposed email draft"
                  onChange={() => {
                    setOperation(crypto.randomUUID());
                    setSent(null);
                    setPhase(2);
                  }}
                >
                  <fieldset disabled={busy}>
                    <legend>Proposed draft · unsent until approved</legend>
                    <label>
                      To — email addresses, comma separated
                      <input
                        required
                        value={to}
                        onChange={(e) => setTo(e.target.value)}
                      />
                    </label>
                    <label>
                      Cc
                      <input
                        value={cc}
                        onChange={(e) => setCc(e.target.value)}
                      />
                    </label>
                    <label>
                      Subject
                      <input
                        required
                        maxLength={200}
                        value={subject}
                        onChange={(e) => setSubject(e.target.value)}
                      />
                    </label>
                    <label>
                      Message
                      <textarea
                        required
                        maxLength={16000}
                        rows={8}
                        value={body}
                        onChange={(e) => setBody(e.target.value)}
                      />
                    </label>
                    <MailReview input={sendInput} />
                    <p className={styles.fine}>
                      Recipients are explicit. This sends a new plain-text
                      message, with no attachments or automatic reply-all.
                    </p>
                    <button disabled={!status?.writable || !!sent}>
                      Review and send
                    </button>
                  </fieldset>
                </form>
              )}
              {sent && (
                <article className={styles.receipt}>
                  <strong>GMAIL ACCEPTED</strong>
                  <p>Message {sent.message_id}</p>
                  <small>
                    Approval and provider receipt are recorded in Action
                    History.
                  </small>
                </article>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
