"use client";
import { MemorySources } from "./memory-sources";
import type { MemorySource } from "../domain/memory-source";
import { useState } from "react";
import { api } from "./api";
import type {
  ModelCall,
  ExtractionJob,
  Memory,
  MemoryConflict,
  MemoryEvidence,
  RecordVersion,
} from "@/domain/models";
type MemoryView = Omit<Memory, "embedding">;
export type ConflictView = MemoryConflict & {
  existing?: string;
  candidate?: string;
};
export function KnowledgeReview({
  memories,
  conflicts,
  jobs,
  refresh,
}: {
  memories: MemoryView[];
  conflicts: ConflictView[];
  jobs: ExtractionJob[];
  refresh: () => Promise<unknown>;
}) {
  const [embeddingStatus, setEmbeddingStatus] = useState<{
    total: number;
    updated: number;
    remaining: number;
    failed: number;
    error: string | null;
    embedding_model: string;
    embedding_version: string;
  } | null>(null);
  const [metrics, setMetrics] = useState<ModelCall[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<{
    versions: RecordVersion[];
    evidence: MemoryEvidence[];
    sources: MemorySource[];
  } | null>(null);
  const [timeline, setTimeline] = useState<MemoryView[] | null>(null);
  async function run(operation: () => Promise<void>) {
    setError("");
    setBusy(true);
    try {
      await operation();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>Memory review</h2>
        <span className="tag">{conflicts.length} unresolved</span>
      </div>
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      <div className="panel-heading">
        <h3>Embedding maintenance</h3>
      </div>
      <p className="small">
        Check migration progress or re-embed all memories with the configured
        provider. Completed records are skipped. Re-embedding uses paid API
        calls when OpenAI is selected.
      </p>
      <div className="inline-form">
        <button
          disabled={busy}
          onClick={() =>
            void run(async () => {
              setEmbeddingStatus(
                await (
                  await api("reembed", {
                    method: "POST",
                    body: JSON.stringify({ dry_run: true }),
                  })
                ).json(),
              );
            })
          }
        >
          Check embedding status
        </button>
        <button
          disabled={busy}
          onClick={() =>
            void run(async () => {
              let remaining = 1,
                updated = 0;
              while (remaining > 0) {
                const result = await (
                  await api("reembed", {
                    method: "POST",
                    body: JSON.stringify({ limit: 5 }),
                  })
                ).json();
                updated += result.updated;
                setEmbeddingStatus({ ...result, updated });
                remaining = result.remaining;
                if (result.failed)
                  throw new Error(
                    result.error ||
                      "Re-embedding failed. Retry after resolving the provider error.",
                  );
                if (remaining && !result.updated)
                  throw new Error(
                    "No progress. Check the provider configuration before retrying.",
                  );
              }
              await refresh();
            })
          }
        >
          {busy ? "Working…" : "Re-embed all memories"}
        </button>
      </div>
      {embeddingStatus && (
        <p role="status">
          {embeddingStatus.embedding_model} · {embeddingStatus.remaining} of{" "}
          {embeddingStatus.total} memories need migration ·{" "}
          {embeddingStatus.updated} updated this run
          <br />
          <span className="small">
            Version: {embeddingStatus.embedding_version}
          </span>
        </p>
      )}
      <button
        disabled={busy}
        onClick={() =>
          void run(async () => {
            setMetrics(await (await api("model-calls")).json());
          })
        }
      >
        View recent model usage
      </button>
      {metrics && (
        <div className="memory-grid">
          {metrics.length ? (
            metrics.map((metric) => (
              <article className="memory-card" key={metric.id}>
                <h3>
                  {metric.operation} · {metric.status}
                </h3>
                <p>{metric.model}</p>
                <p className="small">
                  Input tokens: {metric.input_tokens ?? "Unknown"} · Output
                  tokens: {metric.output_tokens ?? "Unknown"}
                  <br />
                  Latency: {metric.latency_ms} ms · Estimated cost:{" "}
                  {metric.estimated_cost_usd === null
                    ? "Unknown"
                    : `$${metric.estimated_cost_usd.toFixed(6)}`}
                  <br />
                  Retrieved: {metric.retrieval_count} · Proposed memories:{" "}
                  {metric.memories_extracted ?? "N/A"}
                </p>
                {metric.error_code && <p>{metric.error_code}</p>}
              </article>
            ))
          ) : (
            <p>No model calls recorded yet.</p>
          )}
        </div>
      )}
      <div className="memory-grid">
        {conflicts.map((conflict) => (
          <article className="memory-card" key={conflict.id}>
            <h3>Review a changed fact</h3>
            <p>
              <strong>Existing:</strong> {conflict.existing}
            </p>
            <p>
              <strong>New statement:</strong> {conflict.candidate}
            </p>
            <p>{conflict.reason}</p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const form = new FormData(e.currentTarget);
                void run(async () => {
                  await api(`conflicts/${conflict.id}`, {
                    method: "POST",
                    body: JSON.stringify({
                      resolution: form.get("resolution"),
                      effective_at: form.get("effective")
                        ? new Date(String(form.get("effective"))).toISOString()
                        : null,
                    }),
                  });
                  await refresh();
                });
              }}
            >
              <label>
                Decision
                <select name="resolution">
                  <option value="kept_existing">Keep existing fact</option>
                  <option value="replaced">Replace with new fact</option>
                  <option value="kept_both">Both facts can be true</option>
                </select>
              </label>
              <label>
                Change effective at (optional)
                <input name="effective" type="datetime-local" />
              </label>
              <p className="small">
                Leave the date empty when it is unknown. Replacing preserves the
                earlier fact and its evidence.
              </p>
              <button disabled={busy}>Apply decision</button>
            </form>
          </article>
        ))}
        {!conflicts.length && (
          <p className="empty">No facts awaiting a decision.</p>
        )}
      </div>
      <div className="panel-heading">
        <h2>Extraction jobs</h2>
      </div>
      <div className="memory-grid">
        {jobs.map((job) => (
          <article className="memory-card" key={job.id}>
            <h3>
              {job.status} · attempt {job.attempts} / 5
            </h3>
            <p>{job.error ?? "Waiting for extraction to finish."}</p>
            <p className="small">Source message: {job.source_message_id}</p>
            <button
              disabled={
                busy ||
                job.attempts >= 5 ||
                (job.status === "running" &&
                  Boolean(
                    job.lease_until && Date.parse(job.lease_until) > Date.now(),
                  ))
              }
              onClick={() =>
                void run(async () => {
                  await api(`extraction-jobs/${job.id}/retry`, {
                    method: "POST",
                  });
                  await refresh();
                })
              }
            >
              Retry extraction
            </button>
          </article>
        ))}
        {!jobs.length && (
          <p className="empty">All extraction jobs are complete.</p>
        )}
      </div>
      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          void run(async () => {
            setHistory(
              await (
                await api(`memories/${form.get("memory")}/history`)
              ).json(),
            );
          });
        }}
      >
        <h3>Evidence and version history</h3>
        <select name="memory" aria-label="Memory to inspect" required>
          {memories.map((m) => (
            <option key={m.id} value={m.id}>
              {m.status}
              {m.archived_at ? " / archived" : ""} · {m.content.slice(0, 110)}
            </option>
          ))}
        </select>
        <button disabled={busy || !memories.length}>Inspect history</button>
      </form>
      {history && (
        <div className="memory-grid">
          <article className="memory-card">
            <h3>Supporting messages</h3>
            <MemorySources sources={history.sources} />
            {history.evidence.length ? (
              history.evidence.map((e) => (
                <div key={e.id}>
                  <span className="tag">{e.evidence_type}</span>
                  <blockquote>{e.quote}</blockquote>
                  <p className="small">Message: {e.source_message_id}</p>
                </div>
              ))
            ) : (
              <p>Manual or legacy memory; no extracted message evidence.</p>
            )}
          </article>
          {history.versions.map((v) => (
            <article className="memory-card" key={v.id}>
              <span className="tag">
                {String(v.snapshot.status ?? "recorded")}
              </span>
              <h3>{String(v.snapshot.content ?? "")}</h3>
              <p className="small">
                Recorded: {new Date(v.recorded_at).toLocaleString()}
                <br />
                Valid from: {String(v.snapshot.valid_from ?? "Unknown")}
                <br />
                Valid until: {String(v.snapshot.valid_to ?? "Unknown / open")}
              </p>
            </article>
          ))}
        </div>
      )}
      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          void run(async () => {
            const query = new URLSearchParams({
              known_at: new Date(String(form.get("known"))).toISOString(),
            });
            if (form.get("valid"))
              query.set(
                "valid_at",
                new Date(String(form.get("valid"))).toISOString(),
              );
            setTimeline(await (await api(`memory-timeline?${query}`)).json());
          });
        }}
      >
        <h3>Explore past knowledge</h3>
        <label>
          What Ary knew at
          <input name="known" type="datetime-local" required />
        </label>
        <label>
          Facts valid at (optional)
          <input name="valid" type="datetime-local" />
        </label>
        <button disabled={busy}>View past knowledge</button>
      </form>
      <p className="panel-footnote">
        History begins when version tracking was enabled. Unknown effective
        dates remain unknown; a matching record does not prove it was true at
        that time.
      </p>
      {timeline && (
        <div className="memory-grid">
          {timeline.length ? (
            timeline.map((m) => (
              <article className="memory-card" key={m.id}>
                <h3>{m.content}</h3>
                <p>
                  {m.valid_from ?? "Start unknown"} →{" "}
                  {m.valid_to ?? "End unknown / open"}
                </p>
              </article>
            ))
          ) : (
            <p className="empty">No recorded knowledge matches this time.</p>
          )}
        </div>
      )}
    </section>
  );
}
