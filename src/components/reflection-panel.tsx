"use client";
import { useEffect, useState } from "react";
import { api } from "./api";
import type { Conversation } from "@/domain/models";
import type { ReflectionJob, ReflectionProposal } from "@/domain/reflection";
type ReflectionData = {
  jobs: ReflectionJob[];
  proposals: ReflectionProposal[];
};
export function ReflectionPanel({
  conversations,
  refresh,
}: {
  conversations: Conversation[];
  refresh: () => Promise<unknown>;
}) {
  const [data, setData] = useState<ReflectionData>({ jobs: [], proposals: [] });
  const [conversation, setConversation] = useState(conversations[0]?.id ?? "");
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function load() {
    setData(await (await api("reflection")).json());
  }
  useEffect(() => {
    let disposed = false;
    const poll = async () => {
      try {
        const next = await (await api("reflection")).json();
        if (!disposed) setData(next);
      } catch (e) {
        if (!disposed)
          setError(
            e instanceof Error ? e.message : "Could not load reflection",
          );
      }
    };
    void poll();
    const timer = setInterval(() => {
      void poll();
    }, 5000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, []);
  async function run(operation: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await operation();
      await load();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reflection operation failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel" style={{ padding: 24 }}>
      <h2>Reflection · development only</h2>
      <p>
        Reflection v1 reviews evidence after a conversation turn. It uses
        explicit rules, not an additional model call. Proposals stay pending
        until you accept or reject them. Confirmed fact content is never
        rewritten.
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="inline-form">
        <label>
          Conversation to inspect
          <select
            aria-label="Reflection conversation"
            value={conversation}
            onChange={(e) => setConversation(e.target.value)}
          >
            {conversations.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </label>
        <button
          disabled={busy || !conversation}
          onClick={() =>
            void run(() =>
              api("reflection/run", {
                method: "POST",
                body: JSON.stringify({ conversation_id: conversation }),
              }),
            )
          }
        >
          Queue reflection
        </button>
        <button disabled={busy} onClick={() => void run(load)}>
          Refresh reflection
        </button>
      </div>
      <h3>What Ary noticed</h3>
      {!data.jobs.length && (
        <p>
          No reflection jobs yet. The next conversation turn will queue one
          automatically.
        </p>
      )}
      {data.jobs.map((job) => (
        <details key={job.id}>
          <summary>
            {conversations.find((c) => c.id === job.conversation_id)?.title ??
              "Conversation"}{" "}
            · {job.status} · {new Date(job.created_at).toLocaleString()}
          </summary>
          <p className="small">
            {job.version} · attempt {job.attempts}/5 · source message{" "}
            {job.source_message_id}
          </p>
          {job.error && <p role="alert">{job.error}</p>}
          {job.status !== "completed" && (
            <button
              disabled={
                busy ||
                (job.status === "running" &&
                  Date.parse(job.lease_until ?? "1970") > Date.now())
              }
              onClick={() =>
                void run(() =>
                  api(`reflection/jobs/${job.id}/retry`, {
                    method: "POST",
                    body: "{}",
                  }),
                )
              }
            >
              Retry reflection
            </button>
          )}
          <ul>
            {job.observations.map((o, i) => (
              <li key={i}>
                <strong>{o.category}</strong>: {o.noticed}
                <details>
                  <summary>Evidence ({o.evidence.length})</summary>
                  <pre
                    style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
                  >
                    {JSON.stringify(o.evidence, null, 2)}
                  </pre>
                </details>
              </li>
            ))}
          </ul>
        </details>
      ))}
      <h3>Proposed changes and review history</h3>
      <p>
        {data.proposals.filter((p) => p.status === "pending").length} pending ·{" "}
        {data.proposals.filter((p) => p.status === "accepted").length} accepted
        · {data.proposals.filter((p) => p.status === "rejected").length}{" "}
        rejected
      </p>
      {!data.proposals.length && <p>No evidence-backed changes proposed.</p>}
      {data.proposals.map((p) => (
        <article className="memory-card" key={p.id}>
          <h3>
            {p.kind.replaceAll("_", " ")} · {p.status}
          </h3>
          <p>
            <strong>Noticed:</strong> {p.noticed}
          </p>
          <p>
            <strong>Why proposed:</strong> {p.reason}
          </p>
          <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
            {JSON.stringify(p.change, null, 2)}
          </pre>
          <details>
            <summary>
              Evidence and preserved snapshots ({p.evidence.length})
            </summary>
            <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
              {JSON.stringify(p.evidence, null, 2)}
            </pre>
          </details>
          {p.status === "pending" ? (
            <div>
              <label>
                Review reason
                <textarea
                  aria-label={`Review reason ${p.id}`}
                  value={reasons[p.id] ?? ""}
                  maxLength={2000}
                  onChange={(e) =>
                    setReasons({ ...reasons, [p.id]: e.target.value })
                  }
                  placeholder="Explain why you accept or reject this change"
                />
              </label>
              {(["accepted", "rejected"] as const).map((decision) => (
                <button
                  key={decision}
                  disabled={busy || !reasons[p.id]?.trim()}
                  onClick={() =>
                    void run(() =>
                      api(`reflection/proposals/${p.id}`, {
                        method: "POST",
                        body: JSON.stringify({
                          decision,
                          reason: reasons[p.id],
                        }),
                      }),
                    )
                  }
                >
                  {decision === "accepted"
                    ? "Accept proposal"
                    : "Reject proposal"}
                </button>
              ))}
            </div>
          ) : (
            <div>
              <p>
                <strong>
                  {p.status === "accepted" ? "Accepted" : "Rejected"} because:
                </strong>{" "}
                {p.review_reason}
              </p>
              <p className="small">
                Reviewed{" "}
                {p.reviewed_at && new Date(p.reviewed_at).toLocaleString()} ·{" "}
                {p.reviewed_by}
              </p>
              {p.applied_changes.length > 0 && (
                <details>
                  <summary>Applied changes · before / after</summary>
                  <pre
                    style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
                  >
                    {JSON.stringify(p.applied_changes, null, 2)}
                  </pre>
                </details>
              )}
            </div>
          )}
        </article>
      ))}
    </section>
  );
}
