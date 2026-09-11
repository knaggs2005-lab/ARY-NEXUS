"use client";
import { z } from "zod";
const traceSchema = z.array(
  z.object({
    mention: z.string(),
    status: z.enum(["resolved", "ambiguous"]),
    method: z.string(),
    canonical_entity_id: z.string().nullable(),
    canonical_name: z.string().nullable(),
    confidence: z.number().min(0).max(1),
    reason: z.string(),
    candidates: z.array(
      z.object({ id: z.string(), name: z.string(), entity_type: z.string() }),
    ),
  }),
);
export function EntityResolutionDebug({ traces }: { traces: unknown }) {
  const result = traceSchema.safeParse(traces);
  if (!result.success)
    return <p className="small">Entity trace not recorded for this message.</p>;
  return (
    <details className="small">
      <summary>Detected entities · {result.data.length}</summary>
      {!result.data.length && (
        <p>
          No known canonical names, aliases, or partial person names detected.
        </p>
      )}
      {result.data.map((trace, index) => (
        <article key={index} className="memory-card">
          <p>
            <strong>{trace.mention}</strong> →{" "}
            {trace.canonical_name ?? "Unresolved — clarification needed"}
          </p>
          <p>
            Confidence: {Math.round(trace.confidence * 100)}% · {trace.method}
          </p>
          <p>{trace.reason}</p>
          {trace.canonical_entity_id && (
            <p>Canonical ID: {trace.canonical_entity_id}</p>
          )}
          {trace.status === "ambiguous" && (
            <ul>
              {trace.candidates.map((c) => (
                <li key={c.id}>
                  {c.name} ({c.entity_type}) · {c.id}
                </li>
              ))}
            </ul>
          )}
        </article>
      ))}
      <p>
        Confidence describes identity matching, not whether a stored fact is
        true. Assistant traces describe the user input used for that response.
      </p>
    </details>
  );
}
