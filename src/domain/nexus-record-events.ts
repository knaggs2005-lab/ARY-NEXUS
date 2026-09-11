import type { EventDraft } from "./nexus-events";
interface EventRecord {
  [key: string]: unknown;
  id: string;
  status?: string;
  decision?: string;
  tool_name?: string;
  product_entity_ids?: string[];
  conversation_id?: string | null;
  action_id?: string | null;
  metadata?: { plan?: { revision: number; status: string } };
  model?: string;
  latency_ms?: number;
  input_tokens?: number | null;
  output_tokens?: number | null;
  estimated_cost_usd?: number | null;
}
/** Mirrors migration 014. Safe metadata projection of committed records, never record contents. */
export function recordEvent(
  table: string,
  raw: object,
  old: object | null,
): EventDraft | null {
  const row = raw as EventRecord,
    previous = old as EventRecord | null;
  let type = "",
    status: string | undefined,
    mission: string | null = null;
  const metadata = row.metadata ?? {};
  if (table === "actions") {
    if (previous?.status === row.status) return null;
    type = `tool.${row.status}`;
    status = row.status;
  } else if (table === "outcomes") {
    type = "tool.outcome_recorded";
    status = row.status;
  } else if (table === "memories") {
    if (
      previous &&
      [
        "content",
        "summary",
        "status",
        "archived_at",
        "supersedes_id",
        "importance_score",
        "confidence_score",
      ].every((k) => previous[k] === row[k])
    )
      return null;
    type = previous ? "memory.updated" : "memory.created";
    status = row.status;
  } else if (table === "memory_conflicts") {
    type = "memory.conflict_changed";
    status = row.status;
  } else if (table === "action_approvals") {
    if (previous) return null;
    type = `permission.${row.decision}`;
    status = row.decision;
  } else if (table === "permission_policies") {
    type = "permission.policy_changed";
  } else if (table === "model_calls") {
    if (previous) return null;
    type = "model.completed";
    status = row.status;
  } else if (table === "messages" && metadata.plan) {
    if (previous?.metadata?.plan?.revision === metadata.plan.revision)
      return null;
    type = "mission.updated";
    status = metadata.plan.status;
    mission = row.id;
  } else if (table === "extraction_jobs") {
    if (previous?.status === row.status) return null;
    type = "memory.extraction_changed";
    status = row.status;
  } else return null;
  return {
    type,
    source: { kind: "database", name: table },
    related_entity_id: row.product_entity_ids?.[0] ?? null,
    correlation_id:
      row.conversation_id ??
      row.action_id ??
      (table === "actions" ? row.id : null),
    mission_id: mission,
    severity: ["failed", "blocked", "rejected"].includes(status ?? "")
      ? "warning"
      : "info",
    visibility: "systems",
    payload: {
      record_id: row.id,
      ...(status ? { status } : {}),
      ...(row.tool_name ? { tool: row.tool_name } : {}),
      ...(table === "model_calls"
        ? {
            model: row.model,
            duration_ms: row.latency_ms,
            input_tokens: row.input_tokens,
            output_tokens: row.output_tokens,
            estimated_cost_usd: row.estimated_cost_usd,
          }
        : {}),
      ...(mission ? { revision: metadata.plan?.revision } : {}),
    },
  };
}
