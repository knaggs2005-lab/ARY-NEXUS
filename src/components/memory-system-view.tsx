"use client";
import { useEffect, useRef, useState } from "react";
import {
  memoryClasses,
  policyFor,
  type KnowledgeDocument,
} from "../domain/nexus-memory";
import type {
  Memory,
  MemoryHit,
  Entity,
  Outcome,
  Conversation,
} from "../domain/models";
import type { NexusMemoryService } from "../services/nexus-memory-service";
import { api } from "./api";
import { MemorySources } from "./memory-sources";
import styles from "./agents/agents.module.css";
import memoryStyles from "./memory-system.module.css";
type Detail = Awaited<ReturnType<NexusMemoryService["inspect"]>>;
export function MemorySystemView({
  entities = [],
  outcomes = [],
  conversations = [],
  onChanged,
}: {
  entities?: Entity[];
  outcomes?: Outcome[];
  conversations?: Conversation[];
  onChanged?: () => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false),
    [mode, setMode] = useState("learned"),
    [rows, setRows] = useState<Omit<Memory, "embedding">[]>([]),
    [knowledge, setKnowledge] = useState<KnowledgeDocument[]>([]),
    [selected, setSelected] = useState(""),
    [detail, setDetail] = useState<Detail | null>(null),
    [filter, setFilter] = useState("ALL"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const [kind, setKind] = useState("SEMANTIC"),
    [content, setContent] = useState(""),
    [summary, setSummary] = useState(""),
    [reference, setReference] = useState(""),
    [entity, setEntity] = useState(""),
    [outcome, setOutcome] = useState(""),
    [conversation, setConversation] = useState(""),
    [source, setSource] = useState(""),
    [expires, setExpires] = useState(""),
    [confidence, setConfidence] = useState(0.8),
    [checked, setChecked] = useState<string[]>([]),
    [consolidation, setConsolidation] = useState(""),
    [query, setQuery] = useState(""),
    [hits, setHits] = useState<MemoryHit[] | null>(null);
  const generation = useRef(0);
  async function refresh() {
    try {
      if (mode === "learned")
        setRows(await (await api("memory-system")).json());
      else
        setKnowledge(
          await (await api("knowledge?q=" + encodeURIComponent(query))).json(),
        );
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    if (open) void refresh();
  }, [open, mode]);
  useEffect(() => {
    if (!open) return;
    const onSettled = () => void refresh();
    window.addEventListener("ary:action-settled", onSettled);
    return () => window.removeEventListener("ary:action-settled", onSettled);
  }, [open, mode]);
  async function inspect(id: string) {
    const ticket = ++generation.current;
    setSelected(id);
    setDetail(null);
    try {
      const d = await (await api("memory-system/" + id)).json();
      if (ticket === generation.current) setDetail(d);
    } catch (e) {
      if (ticket === generation.current) setError((e as Error).message);
    }
  }
  async function request(tool: string, input: Record<string, unknown>) {
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
          reason: "Owner-reviewed Memory intelligence operation",
        }),
      });
      setNotice(
        "Committed through permissions, approval, audit and outcome tracking.",
      );
      await refresh();
      await onChanged?.();
      setDetail(null);
      setSelected("");
      setChecked([]);
      setHits(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const chosen = knowledge.find((k) => k.id === selected);
  return (
    <div
      className={`${styles.panel} ${memoryStyles.surface}`}
      style={{ marginBottom: 24 }}
    >
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
        Memory intelligence
      </button>
      {open && (
        <>
          <header>
            <h2>What Ary remembers</h2>
            <p>
              Learned experience and curated knowledge have separate lifecycles.
              Confidence is a recorded estimate; evidence is available for
              inspection.
            </p>
          </header>
          <div role="group" aria-label="Memory collection">
            <button
              aria-pressed={mode === "learned"}
              onClick={() => {
                setMode("learned");
                setSelected("");
                setDetail(null);
              }}
            >
              Learned memory
            </button>{" "}
            <button
              aria-pressed={mode === "knowledge"}
              onClick={() => {
                setMode("knowledge");
                setSelected("");
                setDetail(null);
              }}
            >
              Knowledge
            </button>
          </div>
          {error && <p role="alert">{error}</p>}
          {notice && <p role="status">{notice}</p>}
          {busy && (
            <p role="status">
              Waiting for review or committing the approved change…
            </p>
          )}
          <form
            className={styles.form}
            onSubmit={async (e) => {
              e.preventDefault();
              setError("");
              try {
                if (mode === "knowledge") await refresh();
                else {
                  setHits(
                    await (
                      await api("memories?q=" + encodeURIComponent(query))
                    ).json(),
                  );
                  await refresh();
                }
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            <label>
              Explain relevance
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Ask with different wording…"
              />
            </label>
            <button disabled={busy || !query.trim()}>Search context</button>
          </form>
          {mode === "learned" ? (
            <>
              <label>
                Memory class
                <select
                  id="memory-class-filter"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                >
                  <option value="ALL">All classes</option>
                  {memoryClasses.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
              <div
                style={{ maxHeight: 280, overflow: "auto", margin: "16px 0" }}
              >
                {(hits ?? rows)
                  .filter(
                    (m) => filter === "ALL" || policyFor(m).class === filter,
                  )
                  .slice(0, 200)
                  .map((m) => (
                    <div
                      key={m.id}
                      style={{
                        display: "flex",
                        gap: 12,
                        alignItems: "center",
                        marginBottom: 8,
                      }}
                    >
                      <input
                        style={{ width: 18 }}
                        type="checkbox"
                        aria-label={"Consolidate " + (m.summary || m.content)}
                        checked={checked.includes(m.id)}
                        onChange={(e) =>
                          setChecked(
                            e.target.checked
                              ? [...checked, m.id]
                              : checked.filter((id) => id !== m.id),
                          )
                        }
                      />
                      <button
                        aria-pressed={selected === m.id}
                        onClick={() => void inspect(m.id)}
                      >
                        {m.summary || m.content.slice(0, 100)} ·{" "}
                        {policyFor(m).class} ·{" "}
                        {m.archived_at ? "archived" : m.status}
                      </button>
                    </div>
                  ))}
              </div>
              <small>
                Up to 200 rows shown. Working context only enters retrieval in
                its matching conversation, before expiry.
              </small>
              {hits?.map((m) => (
                <details key={m.id}>
                  <summary>
                    {m.summary || m.content.slice(0, 100)} · retrieval
                    explanation
                  </summary>
                  <p>{m.retrieval_reasons?.join(" · ")}</p>
                  <p>
                    Sources: {m.retrieval_sources?.join(", ")} · rank{" "}
                    {m.final_rank}
                  </p>
                  <MemorySources sources={m.source_evidence} />
                </details>
              ))}
              {detail && (
                <section aria-label="Memory explanation">
                  <h3>{detail.memory.summary || detail.memory.content}</h3>
                  <p>{detail.memory.content}</p>
                  <p>
                    {detail.policy.class} ·{" "}
                    {Math.round(detail.confidence * 100)}% confidence · learned{" "}
                    {new Date(detail.learned_at).toLocaleString()} ·{" "}
                    {detail.current ? "current" : "historical / expired"}
                  </p>
                  <p>{detail.confidence_basis}</p>
                  <MemorySources sources={detail.history.sources} />
                  <p>
                    Entities:{" "}
                    {detail.entities
                      .map((e) => e?.name ?? "unavailable")
                      .join(", ") || "None linked"}
                  </p>
                  {detail.outcome && (
                    <p>
                      Outcome: {detail.outcome.summary} ·{" "}
                      {detail.outcome.status}
                    </p>
                  )}
                  <p>
                    Conflicts: {detail.conflicts.length} · versions:{" "}
                    {detail.history.versions.length}
                  </p>
                  <p>{detail.retrieval}</p>
                  {detail.policy.expires_at && (
                    <p>
                      Expires{" "}
                      {new Date(detail.policy.expires_at).toLocaleString()}
                    </p>
                  )}
                  <details>
                    <summary>Version and consolidation evidence</summary>
                    <pre
                      style={{
                        whiteSpace: "pre-wrap",
                        overflowWrap: "anywhere",
                      }}
                    >
                      {JSON.stringify(
                        {
                          versions: detail.history.versions,
                          sources: detail.consolidated_sources,
                          conflicts: detail.conflicts,
                        },
                        null,
                        2,
                      )}
                    </pre>
                  </details>
                  <p>{detail.deletion_scope}</p>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void request("memory.forget", {
                        id: detail.memory.id,
                        expected_updated_at: detail.memory.updated_at,
                        reason: "Owner requested archival from active recall",
                      })
                    }
                  >
                    Archive selected memory
                  </button>{" "}
                  <button
                    disabled={busy}
                    onClick={() =>
                      void request("memory.delete_record", {
                        id: detail.memory.id,
                        expected_updated_at: detail.memory.updated_at,
                        reason:
                          "Owner requested deletion of this memory record and its history",
                      })
                    }
                  >
                    Review record deletion
                  </button>
                </section>
              )}
              <details>
                <summary>
                  Consolidate selected memories ({checked.length})
                </summary>
                <p>
                  Create a reviewed summary. Originals and evidence remain;
                  conflicting or stale sources cannot be consolidated.
                </p>
                <label>
                  Reviewed consolidation
                  <textarea
                    value={consolidation}
                    onChange={(e) => setConsolidation(e.target.value)}
                  />
                </label>
                <button
                  disabled={
                    busy ||
                    checked.length < 2 ||
                    checked.length > 8 ||
                    !consolidation.trim()
                  }
                  onClick={() =>
                    void request("memory.consolidate", {
                      sources: checked.map((id) => ({
                        id,
                        updated_at: rows.find((m) => m.id === id)?.updated_at,
                      })),
                      summary: consolidation,
                    })
                  }
                >
                  Review consolidation
                </button>
              </details>
            </>
          ) : (
            <>
              <p>
                Curated references are not automatically learned facts.
                Retrieval here uses explicit lexical matching; knowledge is not
                silently injected into conversations.
              </p>
              {knowledge.map((k) => (
                <button
                  key={k.id}
                  aria-pressed={selected === k.id}
                  onClick={() => setSelected(k.id)}
                >
                  {k.title}
                </button>
              ))}
              {chosen && (
                <section>
                  <h3>{chosen.title}</h3>
                  <p>{chosen.content}</p>
                  <p>
                    Reference: {chosen.reference} · captured{" "}
                    {new Date(chosen.created_at).toLocaleString()} ·{" "}
                    {Math.round(chosen.confidence * 100)}% recorded confidence
                  </p>
                  <p>Previous revision: {chosen.supersedes_id ?? "None"}</p>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void request("knowledge.archive", {
                        id: chosen.id,
                        expected_updated_at: chosen.updated_at,
                        reason: "Owner retired this curated reference",
                      })
                    }
                  >
                    Retire reference
                  </button>
                </section>
              )}
            </>
          )}
          <details key={mode}>
            <summary>
              {mode === "learned"
                ? "Capture classified memory"
                : "Add / revise curated knowledge"}
            </summary>
            <form
              className={styles.form}
              onSubmit={(e) => {
                e.preventDefault();
                void request(
                  mode === "learned" ? "memory.capture" : "knowledge.capture",
                  mode === "learned"
                    ? {
                        class: kind,
                        content,
                        summary,
                        confidence,
                        entity_ids: entity ? [entity] : [],
                        outcome_id: outcome || null,
                        conversation_id:
                          kind === "WORKING" ? conversation || null : null,
                        expires_at:
                          kind === "WORKING" && expires
                            ? new Date(expires).toISOString()
                            : null,
                        source_message_id: source || null,
                      }
                    : {
                        title: summary,
                        content,
                        reference,
                        confidence,
                        entity_ids: entity ? [entity] : [],
                        supersedes_id: selected || null,
                      },
                );
              }}
            >
              {mode === "learned" && (
                <label>
                  Capture class
                  <select
                    id="memory-capture-class"
                    value={kind}
                    onChange={(e) => setKind(e.target.value)}
                  >
                    {memoryClasses.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </label>
              )}
              <label>
                {mode === "learned" ? "Summary" : "Reference title"}
                <input
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                  required={mode === "knowledge"}
                />
              </label>
              <label className={styles.wide}>
                Content
                <textarea
                  required
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                />
              </label>
              <label>
                Recorded confidence
                <input
                  type="number"
                  min="0"
                  max="1"
                  step="0.05"
                  value={confidence}
                  onChange={(e) => setConfidence(Number(e.target.value))}
                />
              </label>
              <label>
                Related entity
                <select
                  value={entity}
                  onChange={(e) => setEntity(e.target.value)}
                >
                  <option value="">None selected</option>
                  {entities.map((e) => (
                    <option value={e.id} key={e.id}>
                      {e.name}
                    </option>
                  ))}
                </select>
              </label>
              {mode === "knowledge" ? (
                <label>
                  Source reference
                  <input
                    required
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                  />
                </label>
              ) : (
                <>
                  <label>
                    Source user message ID (optional; content must be an exact
                    quote)
                    <input
                      value={source}
                      onChange={(e) => setSource(e.target.value)}
                    />
                  </label>
                  {kind === "OUTCOME" && (
                    <label>
                      Related outcome
                      <select
                        required
                        value={outcome}
                        onChange={(e) => setOutcome(e.target.value)}
                      >
                        <option value="">Select an actual outcome</option>
                        {outcomes.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.summary} · {o.status}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {kind === "WORKING" && (
                    <>
                      <label>
                        Working conversation
                        <select
                          required
                          value={conversation}
                          onChange={(e) => setConversation(e.target.value)}
                        >
                          <option value="">Select a conversation</option>
                          {conversations.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.title}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Expires within 24 hours
                        <input
                          type="datetime-local"
                          required
                          value={expires}
                          onChange={(e) => setExpires(e.target.value)}
                        />
                      </label>
                    </>
                  )}
                </>
              )}
              <button disabled={busy}>Review capture</button>
              {mode === "learned" && detail && (
                <>
                  <p>
                    Classification changes the selected record’s class and
                    scope, preserving its existing content and embedding.
                  </p>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void request("memory.classify", {
                        id: detail.memory.id,
                        expected_updated_at: detail.memory.updated_at,
                        class: kind,
                        entity_ids: entity ? [entity] : [],
                        outcome_id: outcome || null,
                        conversation_id:
                          kind === "WORKING" ? conversation || null : null,
                        expires_at:
                          kind === "WORKING" && expires
                            ? new Date(expires).toISOString()
                            : null,
                      })
                    }
                  >
                    Review classification of selected memory
                  </button>
                </>
              )}
            </form>
          </details>
        </>
      )}
    </div>
  );
}
