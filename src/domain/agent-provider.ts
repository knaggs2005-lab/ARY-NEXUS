import { z } from "zod";
export const diagnosticObjective =
  "Return a short diagnostic confirming you received this delegated job. Do not modify files, systems, accounts, or external services.";
export const delegatedJobInput = z
  .object({
    provider: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/),
    agentRole: z.enum([
      "research",
      "analysis",
      "diagnosis",
      "code_proposal",
      "diagnostic",
    ]),
    objective: z.string().trim().min(3).max(4000),
    context: z.string().max(12000).default(""),
    project: z.uuid().nullable().default(null),
    priority: z.enum(["low", "normal", "high"]).default("normal"),
  })
  .strict();
export type DelegationInput = z.infer<typeof delegatedJobInput>;
export const jobStatuses = [
  "QUEUED",
  "RUNNING",
  "WAITING_FOR_APPROVAL",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "TIMED_OUT",
] as const;
export type JobStatus = (typeof jobStatuses)[number];
export interface WorkerResult {
  summary: string;
  requiresApproval: boolean;
  proposals: string[];
  artifacts: { name: string; content: string }[];
  sideEffects: "not_independently_verified";
}
export interface WorkerSnapshot {
  remoteId: string;
  status: JobStatus;
  result: WorkerResult | null;
  error: string | null;
  stopRequested?: boolean;
}
export interface WorkerHealth {
  connected: boolean;
  endpointConfigured: boolean;
  credentialsConfigured: boolean;
  restrictedWorkerConfirmed: boolean;
  latencyMs: number | null;
  checkedAt: string;
  status:
    "unconfigured" | "unavailable" | "restricted_setup_required" | "ready";
  streaming: boolean;
  error: string | null;
}
export interface DelegatedJob extends DelegationInput {
  version: 1;
  id: string;
  userId: string;
  requestingAgent: string;
  sourceActionId: string;
  sourceConversationId: string | null;
  sourceMessageId: string | null;
  permissions: "advisory_only";
  approvalRequirements: "submission_and_all_proposals";
  status: JobStatus;
  remoteId: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  deadlineAt: string;
  lastSuccessfulRequest: string | null;
  result: WorkerResult | null;
  artifacts: WorkerResult["artifacts"];
  errors: { timestamp: string; message: string }[];
  auditTrail: {
    timestamp: string;
    status: JobStatus;
    reason: string;
    actionId: string;
  }[];
  approvalActionId: string | null;
  stopRequested: boolean;
}
/** The canonical job, permissions and evidence stay in Ary. Transport has no approval-grant API. */
export interface AgentProvider {
  readonly id: string;
  healthCheck(signal?: AbortSignal): Promise<WorkerHealth>;
  submitJob(job: DelegatedJob, signal?: AbortSignal): Promise<WorkerSnapshot>;
  getJobStatus(remoteId: string, signal?: AbortSignal): Promise<WorkerSnapshot>;
  getResult(remoteId: string, signal?: AbortSignal): Promise<WorkerSnapshot>;
  cancelJob(remoteId: string, signal?: AbortSignal): Promise<WorkerSnapshot>;
  streamEvents?(
    remoteId: string,
    signal?: AbortSignal,
  ): AsyncIterable<{ type: string }>;
}
export class AgentProviderRegistry {
  private providers = new Map<string, AgentProvider>();
  register(provider: AgentProvider) {
    if (this.providers.has(provider.id))
      throw new Error("Duplicate agent provider");
    this.providers.set(provider.id, provider);
    return this;
  }
  get(id: string) {
    const provider = this.providers.get(id);
    if (!provider) throw new Error("Worker provider is unavailable");
    return provider;
  }
}
export function isJobTerminal(status: JobStatus) {
  return ["COMPLETED", "FAILED", "CANCELLED", "TIMED_OUT"].includes(status);
}
