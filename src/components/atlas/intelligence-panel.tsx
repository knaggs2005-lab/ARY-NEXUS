"use client";
import type { NexusIntelligence } from "../../domain/nexus-intelligence";
import type { MapEdge, MapNode } from "../../domain/nexus-map";
import styles from "./nexus-map.module.css";
const questions = [
  "What does ARY know about this?",
  "Why are these connected?",
  "What happened last time?",
  "What changed?",
] as const;
export type IntelligenceQuestion = (typeof questions)[number];
export function IntelligencePanel({
  question,
  setQuestion,
  data,
  selected,
  connections,
  nodes,
  onSelect,
}: {
  question: IntelligenceQuestion;
  setQuestion: (q: IntelligenceQuestion) => void;
  data: NexusIntelligence;
  selected: string | null;
  connections: MapEdge[];
  nodes: MapNode[];
  onSelect: (id: string) => void;
}) {
  const memories = data.memories.filter(
    (m) => !selected?.startsWith("memory:") || `memory:${m.id}` === selected,
  );
  const moments = data.timeline.filter((m) =>
    question === questions[3]
      ? ["revision", "supersession"].includes(m.kind)
      : ["episode", "mission", "outcome"].includes(m.kind),
  );
  return (
    <section
      className={styles.intelligence}
      aria-label="Connected intelligence"
    >
      <div className={styles.questions} aria-label="Inspect connected context">
        {questions.map((q) => (
          <button
            key={q}
            aria-pressed={question === q}
            onClick={() => setQuestion(q)}
          >
            {q}
          </button>
        ))}
      </div>
      <p className={styles.note}>{data.explanation}</p>
      {question === questions[0] && (
        <>
          <h3>Learned memory · {memories.length}</h3>
          {!memories.length && (
            <p>
              No accessible memories in this context. Try semantic search or
              include history.
            </p>
          )}
          {memories.map((m) => (
            <article
              key={m.id}
              className={styles.fact}
              data-memory-status={m.status}
            >
              <button onClick={() => onSelect(`memory:${m.id}`)}>
                {m.title}
              </button>
              <small>
                {m.class} · {m.status} · {Math.round(m.confidence * 100)}%
                recorded confidence
              </small>
              <p>{m.content}</p>
              {m.conflicts > 0 && (
                <p role="status">
                  {m.conflicts} unresolved conflict(s). This claim needs review.
                </p>
              )}
              <details>
                <summary>Confidence & provenance</summary>
                <p>Confidence is an estimate, not independent verification.</p>
                <p>
                  Learned{" "}
                  <time dateTime={m.learnedAt}>
                    {new Date(m.learnedAt).toLocaleString()}
                  </time>
                </p>
                <p>
                  Valid{" "}
                  {m.validFrom
                    ? new Date(m.validFrom).toLocaleString()
                    : "start unspecified"}{" "}
                  →{" "}
                  {m.validTo
                    ? new Date(m.validTo).toLocaleString()
                    : "end unspecified"}
                </p>
                {m.sources.length ? (
                  m.sources.map((s) => (
                    <div key={s.id}>
                      <strong>{s.kind}</strong>
                      <p>{s.reference}</p>
                      {s.quote && <blockquote>{s.quote}</blockquote>}
                      <small>
                        {new Date(s.at).toLocaleString()} · {s.id}
                      </small>
                    </div>
                  ))
                ) : (
                  <p>
                    Original source unavailable. A retained fact is not proof.
                  </p>
                )}
              </details>
              {m.relevance && (
                <details open>
                  <summary>Why retrieved</summary>
                  <p>
                    {m.relevance.relevant_because.join(" · ") ||
                      "Returned by the existing retrieval service"}
                  </p>
                </details>
              )}
            </article>
          ))}
          <p className={styles.note}>
            Curated Knowledge remains separate in the existing Memory library.
          </p>
        </>
      )}
      {question === questions[1] && (
        <>
          <h3>Recorded relationships</h3>
          {!connections.length && (
            <p>
              No recorded connection in this window. Similar names do not
              establish a relationship.
            </p>
          )}
          {connections.map((e) => (
            <article className={styles.fact} key={e.id}>
              <p>
                {nodes.find((n) => n.id === e.source)?.label} →{" "}
                {nodes.find((n) => n.id === e.target)?.label}
              </p>
              <strong>{e.type.replaceAll("_", " ")}</strong>
              <small>
                {e.provenance} · {e.status} · strength {e.strength}
              </small>
              <p>
                Valid {e.validFrom ?? "start unspecified"} →{" "}
                {e.validTo ?? "end unspecified"}
              </p>
              <code>{e.evidence.join(" · ") || e.id}</code>
              {e.evidenceMemoryId && (
                <button
                  onClick={() => onSelect(`memory:${e.evidenceMemoryId}`)}
                >
                  Inspect relationship evidence
                </button>
              )}
            </article>
          ))}
        </>
      )}
      {(question === questions[2] || question === questions[3]) && (
        <>
          <h3>
            {question === questions[2]
              ? "Recorded episode timeline"
              : "Recorded changes"}
          </h3>
          <p className={styles.note}>
            {question === questions[2]
              ? "Most recent first. Recorded time does not prove when a real-world event occurred."
              : "Version comparisons and explicit supersession links; access-only timestamps are ignored. Include history to inspect retired facts."}
          </p>
          {!moments.length && (
            <p>
              No{" "}
              {question === questions[2]
                ? "episode, mission or outcome"
                : "recorded change"}{" "}
              in this context.
            </p>
          )}
          <ol className={styles.timeline}>
            {moments.map((m) => (
              <li key={m.id}>
                <time dateTime={m.at}>{new Date(m.at).toLocaleString()}</time>
                <small>{m.kind}</small>
                <button onClick={() => onSelect(m.nodeId)}>{m.title}</button>
                {m.before && (
                  <p>
                    <strong>Before</strong>
                    <br />
                    {m.before}
                  </p>
                )}
                {m.after && (
                  <p>
                    <strong>After</strong>
                    <br />
                    {m.after}
                  </p>
                )}
                <code>{m.source}</code>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
