"use client";
import type { Message } from "../../domain/models";
import type { RoutingTrace } from "../../domain/model-router";
/** The Systems conversation renders these records; Ambient stays provider-neutral. */
export function RoutingDetail({ metadata }: { metadata: Message["metadata"] }) {
  const route = metadata.model_routing as RoutingTrace | undefined;
  if (!route) return null;
  return (
    <details className="response-metrics" aria-label="Intelligence routing">
      <summary>
        Intelligence · {route.selected ?? "limited evidence mode"}
        {route.degraded ? " · degraded" : ""}
      </summary>
      <p>{route.reason}</p>
      <p>
        Task: {route.task} · Privacy: {route.privacy} · Preference:{" "}
        {route.preference}
      </p>
      <p>
        Retrieval: {String(metadata.retrieval_mode ?? "unrecorded")} · Routing
        and attempts: {route.latency_ms} ms
      </p>
      <p>
        Context capacity uses a conservative byte bound. Costs are
        server-configured estimates; unknown prices are excluded when a cost
        ceiling is set.
      </p>
      <ul>
        {route.attempts.map((a, i) => (
          <li key={i}>
            {a.provider} / {a.model}: {a.status} · {a.latency_ms} ms
            {a.error_code ? ` · ${a.error_code}` : ""}
          </li>
        ))}
      </ul>
      <details>
        <summary>Candidate decisions</summary>
        <ul>
          {route.candidates.map((c) => (
            <li key={c.id}>
              {c.id}: {c.reason} ·{" "}
              {c.estimated_cost_usd === null
                ? "cost unknown"
                : `estimated upper bound $${c.estimated_cost_usd.toFixed(6)}`}
            </li>
          ))}
        </ul>
      </details>
    </details>
  );
}
