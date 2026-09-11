/** Read model only. Source adapters never own another mailbox or memory store. */
export type CommunicationChannel = "gmail" | "phone" | "calendar" | "messages";
export interface CommunicationSource {
  channel: CommunicationChannel;
  action_id: string;
  connection_id?: string;
  record_id: string;
}
export interface CommunicationEntry {
  id: string;
  source: CommunicationSource;
  title: string;
  summary: string;
  occurred_at: string | null;
  observed_at: string;
  entity_ids: string[];
  context_entity_ids: string[];
  state: string;
  contact: boolean;
  attention: "review_inbound" | "awaiting_reply" | "review_call" | null;
  evidence: string;
}
export interface CommunicationFollowUp {
  id: string;
  title: string;
  due_at: string | null;
  status: string;
  source_action_id: string;
  entity_ids: string[];
}
export interface CommunicationApproval {
  action_id: string;
  tool: string;
  reason: string;
  created_at: string;
  entity_ids: string[];
  state: "needs_review" | "approved_not_executed" | "expired_review";
}
export interface CommunicationBrief {
  entity: { id: string; name: string; type: string };
  last_contact: string | null;
  open_follow_ups: number;
  unanswered_threads: number;
  pending_approvals: number;
  suggested_next_action: string;
  reasons: string[];
  score: number;
}
export interface CommunicationsSnapshot {
  observed_at: string;
  timeline: CommunicationEntry[];
  follow_ups: CommunicationFollowUp[];
  approvals: CommunicationApproval[];
  people: CommunicationBrief[];
  coverage: string[];
  total: number;
  has_more: boolean;
}
