export type Json = Record<string, unknown>;
export interface RecordBase {
  id: string;
  user_id: string;
  created_at: string;
  updated_at: string;
}
export const memoryTypes = [
  "fact",
  "preference",
  "episodic",
  "procedural",
  "goal",
  "decision",
] as const;
export const entityTypes = [
  "person",
  "company",
  "project",
  "product",
  "goal",
  "decision",
  "task",
] as const;
export interface Memory extends RecordBase {
  memory_type: (typeof memoryTypes)[number];
  content: string;
  summary: string;
  importance_score: number;
  confidence_score: number;
  last_accessed_at: string | null;
  embedding: number[] | null;
  embedding_model: string;
  embedding_version: string;
  embedding_dimensions: number;
  embedding_input_hash: string | null;
  metadata: Json;
  archived_at: string | null;
  source_message_id: string | null;
  status: "active" | "superseded" | "disputed";
  valid_from: string | null;
  valid_to: string | null;
  supersedes_id: string | null;
}
export type MemoryHit = Omit<Memory, "embedding"> & {
  explanation?: ReturnType<typeof import("./nexus-memory").explainHit>;
  source_evidence?: import("./memory-source").MemorySource[];
  unresolved_conflict_count?: number;
  score: number;
  similarity: number;
  /** Equal-weight RRF; never a probability. Optional fields support old snapshots. */
  retrieval_version?: "hybrid-rrf-v1";
  retrieval_sources?: ("semantic" | "lexical" | "entity" | "graph")[];
  semantic_score?: number | null;
  text_score?: number | null;
  semantic_rank?: number | null;
  text_rank?: number | null;
  graph_rank?: number | null;
  final_rank?: number;
  graph_hops?: number;
  graph_steps?: {
    relationship_id: string;
    source_entity_id: string;
    target_entity_id: string;
    relationship_type: string;
    traversal: "forward" | "reverse";
  }[];
  retrieval_reasons?: string[];
  graph_path?: string[];
};
export interface Entity extends RecordBase {
  entity_type: (typeof entityTypes)[number];
  name: string;
  description: string;
  metadata: Json;
}
export interface Relationship extends RecordBase {
  valid_from: string | null;
  valid_to: string | null;
  memory_id: string | null;
  source_entity_id: string;
  target_entity_id: string;
  relationship_type: string;
  strength: number;
  metadata: Json;
}
export interface MemoryEntity extends RecordBase {
  memory_id: string;
  entity_id: string;
}
export interface Conversation extends RecordBase {
  title: string;
  metadata: Json;
}
export interface Message extends RecordBase {
  conversation_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  metadata: Json;
}
export interface Goal extends RecordBase {
  entity_id: string | null;
  title: string;
  description: string;
  status: "active" | "completed" | "paused" | "abandoned";
  progress: number;
  target_date: string | null;
  metadata: Json;
}
export interface Decision extends RecordBase {
  entity_id: string | null;
  goal_id: string | null;
  title: string;
  rationale: string;
  status: "proposed" | "accepted" | "superseded" | "rejected";
  confidence_score: number;
  decided_at: string | null;
  metadata: Json;
}
export interface Task extends RecordBase {
  entity_id: string | null;
  goal_id: string | null;
  title: string;
  description: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
  priority: number;
  due_at: string | null;
  metadata: Json;
}
export type Permission = import("./permissions").PermissionLevel;
export interface Action extends RecordBase {
  conversation_id: string | null;
  tool_name: string;
  action_type: string;
  permission_level: Permission;
  approval_required?: boolean;
  workspace?: string;
  product_entity_ids?: string[];
  status:
    "requested" | "succeeded" | "failed" | "blocked" | "approval_required";
  input: Json;
  output: Json;
  error: string | null;
  metadata: Json;
}
export interface Outcome extends RecordBase {
  action_id: string;
  goal_id: string | null;
  status: "success" | "failure" | "pending";
  summary: string;
  metrics: Json;
  metadata: Json;
}
export interface EntityAlias extends RecordBase {
  entity_id: string;
  alias: string;
}
export interface RecordVersion extends RecordBase {
  record_id: string;
  snapshot: Json;
  recorded_at: string;
}
export interface MemoryEvidence extends RecordBase {
  memory_id: string;
  source_message_id: string;
  quote: string;
  evidence_type: "supports" | "contradicts";
}
export interface MemoryConflict extends RecordBase {
  existing_memory_id: string;
  candidate_memory_id: string;
  reason: string;
  status: "pending" | "replaced" | "kept_existing" | "kept_both";
}
export interface ExtractionJob extends RecordBase {
  source_message_id: string;
  status: "pending" | "running" | "completed" | "failed";
  attempts: number;
  lease_until: string | null;
  error: string | null;
  saved_memory_ids: string[];
}
export interface ModelCall extends RecordBase {
  action_id?: string | null;
  operation: string;
  model: string;
  input_tokens: number | null;
  cached_input_tokens: number | null;
  output_tokens: number | null;
  latency_ms: number;
  estimated_cost_usd: number | null;
  pricing_version: string;
  retrieval_count: number;
  memories_extracted: number | null;
  status: "succeeded" | "failed";
  error_code: string | null;
}
export interface Tables {
  knowledge_documents: import("./nexus-memory").KnowledgeDocument;
  finance_snapshots: import("./finance").FinanceSnapshot;
  memory_sources: import("./memory-source").MemorySource;
  roi_cost_entries: import("./roi").RoiCostEntry;
  roi_outcome_entries: import("./roi").RoiOutcomeEntry;
  permission_policies: import("./permissions").PermissionPolicy;
  action_approvals: import("./permissions").ActionApproval;
  reflection_jobs: import("./reflection").ReflectionJob;
  reflection_proposals: import("./reflection").ReflectionProposal;
  outcome_versions: RecordVersion;
  model_calls: ModelCall;
  entity_aliases: EntityAlias;
  memory_versions: RecordVersion;
  relationship_versions: RecordVersion;
  memory_evidence: MemoryEvidence;
  memory_conflicts: MemoryConflict;
  extraction_jobs: ExtractionJob;
  memories: Memory;
  entities: Entity;
  relationships: Relationship;
  memory_entities: MemoryEntity;
  conversations: Conversation;
  messages: Message;
  goals: Goal;
  decisions: Decision;
  tasks: Task;
  actions: Action;
  outcomes: Outcome;
}
export type Table = keyof Tables;
export type NewRecord<T extends RecordBase> = Omit<T, keyof RecordBase>;
export type Graph = { nodes: Entity[]; edges: Relationship[] };
export const withoutEmbedding = ({ embedding: _, ...memory }: Memory) => memory;
