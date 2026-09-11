import type { Memory, Message, NewRecord, RecordBase } from "./models";
export interface MemorySource extends RecordBase {
  memory_id: string;
  source_message_id: string | null;
  kind:
    | "conversation"
    | "manual"
    | "seed"
    | "revision"
    | "legacy_unknown"
    | "reflection";
  operation: "create" | "edit" | "backfill";
  quote: string | null;
  reference: string;
  content_snapshot: string;
  summary_snapshot: string;
}
/** Provenance identifies an input, not independent verification that a claim is true. */
export function sourceRecord(
  memory: Memory,
  message: Message | undefined,
  operation: MemorySource["operation"],
): NewRecord<MemorySource> {
  const base = {
    memory_id: memory.id,
    source_message_id: null,
    operation,
    content_snapshot: memory.content,
    summary_snapshot: memory.summary,
  };
  if (operation === "edit")
    return {
      ...base,
      kind: "revision",
      quote: memory.content,
      reference:
        "Recorded memory revision; inspect version history and original evidence",
    };
  if (message?.role === "user" && message.user_id === memory.user_id) {
    const proposed = memory.metadata.evidence_quote;
    const quote =
      typeof proposed === "string" &&
      proposed.trim() &&
      message.content.includes(proposed)
        ? proposed
        : message.content;
    return {
      ...base,
      kind: "conversation",
      source_message_id: message.id,
      quote,
      reference: `message:${message.id}`,
    };
  }
  if (memory.metadata.seed === true)
    return {
      ...base,
      kind: "seed",
      quote: memory.content,
      reference: String(memory.metadata.source ?? "Seed source unspecified"),
    };
  if (memory.metadata.origin === "reflection")
    return {
      ...base,
      kind: "reflection",
      quote: memory.content,
      reference: `reflection_proposal:${String(memory.metadata.reflection_proposal_id ?? "unspecified")}`,
    };
  if (operation === "create" && memory.metadata.origin === "manual")
    return {
      ...base,
      kind: "manual",
      quote: memory.content,
      reference: "Authenticated manual memory submission",
    };
  return {
    ...base,
    kind: "legacy_unknown",
    quote: null,
    reference:
      "Original source unavailable; retained snapshot is not source evidence",
  };
}
