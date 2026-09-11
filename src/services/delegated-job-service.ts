import { createHash } from "node:crypto";
import {
  delegatedJobInput,
  isJobTerminal,
  type DelegatedJob,
  type AgentProviderRegistry,
  type WorkerSnapshot,
} from "../domain/agent-provider";
import type { Repository } from "../domain/repository";
import type { ToolExecutionContext } from "../domain/tool-registry";
import type { Json, Message } from "../domain/models";
import { AppError, required } from "../domain/validation";
import { ActionRequestService } from "./action-request-service";
import { ApprovalRequiredError } from "./action-service";
import { NexusEventBus } from "./nexus-event-bus";
const VERSION = "delegated-job-v1";
const idFor = (s: string) => {
  const h = createHash("sha256").update(s).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
/** Existing owner-scoped messages hold durable jobs; actions/outcomes remain the execution audit. */
export class DelegatedJobService {
  constructor(
    private repo: Repository,
    private providers: AgentProviderRegistry,
    private requests: ActionRequestService,
    private now = () => Date.now(),
  ) {}
  private time() {
    return new Date(this.now()).toISOString();
  }
  async list(): Promise<DelegatedJob[]> {
    return (await this.repo.list("messages"))
      .filter((m) => m.metadata.worker_version === VERSION)
      .map((m) => m.metadata.job as unknown as DelegatedJob);
  }
  private async row(id: string) {
    const row = required(await this.repo.get("messages", id), "Delegated job");
    if (row.metadata.worker_version !== VERSION)
      throw new AppError("Delegated job not found", 404);
    return {
      row,
      job: structuredClone(row.metadata.job) as unknown as DelegatedJob,
    };
  }
  private async save(
    row: Message,
    job: DelegatedJob,
    actionId: string,
    reason: string,
  ) {
    job.auditTrail.push({
      timestamp: this.time(),
      status: job.status,
      actionId,
      reason,
    });
    await this.repo.batch([
      {
        kind: "update",
        table: "messages",
        id: row.id,
        expected_updated_at: row.updated_at,
        data: {
          content: `Delegated ${job.provider} job: ${job.status}`,
          metadata: { worker_version: VERSION, job: job as unknown as Json },
        },
      },
    ]);
    await new NexusEventBus(this.repo).record({
      type: "agent.worker_status",
      source: { kind: "backend", name: "delegated-jobs" },
      correlation_id: job.id,
      related_entity_id: job.project,
      payload: {
        record_id: job.id,
        provider: job.provider,
        status: job.status,
        action_id: actionId,
        terminal: isJobTerminal(job.status),
      },
    });
    return job;
  }
  private checkContext(c: ToolExecutionContext) {
    if (!c.actionId || c.userId !== this.repo.userId)
      throw new AppError("Workers require Ary's action pipeline", 403);
  }
  async submit(raw: unknown, c: ToolExecutionContext): Promise<Json> {
    this.checkContext(c);
    const input = delegatedJobInput.parse(raw);
    this.providers.get(input.provider);
    if (input.project)
      required(await this.repo.get("entities", input.project), "Project");
    const id = idFor(`${this.repo.userId}:${c.requestKey ?? c.actionId}`);
    let existing = await this.repo.get("messages", id);
    if (!existing) {
      const createdAt = this.time();
      const job: DelegatedJob = {
        ...input,
        version: 1,
        id,
        userId: this.repo.userId,
        requestingAgent: c.agentId ?? "authenticated_user",
        sourceActionId: c.actionId!,
        sourceConversationId: c.conversationId,
        sourceMessageId: c.sourceMessageId ?? null,
        permissions: "advisory_only",
        approvalRequirements: "submission_and_all_proposals",
        status: "QUEUED",
        remoteId: null,
        createdAt,
        startedAt: null,
        completedAt: null,
        deadlineAt: new Date(this.now() + 15 * 60000).toISOString(),
        lastSuccessfulRequest: null,
        result: null,
        artifacts: [],
        errors: [],
        auditTrail: [
          {
            timestamp: createdAt,
            status: "QUEUED",
            reason: "Approved context reserved before external submission",
            actionId: c.actionId!,
          },
        ],
        approvalActionId: null,
        stopRequested: false,
      };
      await this.repo.batch([
        {
          kind: "insert",
          table: "conversations",
          id,
          data: {
            title: "Delegated worker job",
            metadata: { worker_version: VERSION },
          },
        },
        {
          kind: "insert",
          table: "messages",
          id,
          data: {
            conversation_id: id,
            role: "system",
            content: "Delegated job queued",
            metadata: { worker_version: VERSION, job: job as unknown as Json },
          },
        },
      ]);
      existing = required(await this.repo.get("messages", id), "Delegated job");
    }
    const { row, job } = await this.row(id);
    if (
      JSON.stringify(input) !==
      JSON.stringify(delegatedJobInput.parse(jobInput(job)))
    )
      throw new AppError("Job key belongs to different context", 409);
    if (job.status !== "QUEUED") return { job: job as unknown as Json };
    if (this.now() >= Date.parse(job.deadlineAt)) {
      job.status = "TIMED_OUT";
      job.completedAt = this.time();
      return {
        job: (await this.save(
          row,
          job,
          c.actionId!,
          "Submission recovery window expired; no resubmission",
        )) as unknown as Json,
      };
    }
    try {
      c.signal?.throwIfAborted();
      const state = await this.providers
        .get(job.provider)
        .submitJob(job, c.signal);
      Object.assign(job, {
        remoteId: state.remoteId,
        status: state.status,
        startedAt: this.time(),
        lastSuccessfulRequest: this.time(),
        result: state.result,
        artifacts: state.result?.artifacts ?? [],
      });
      if (isJobTerminal(job.status)) job.completedAt = this.time();
      await this.save(
        row,
        job,
        c.actionId!,
        "Provider accepted the idempotent run",
      );
      // Emergency stop during submission can leave an accepted remote run. Request stop, never imply rollback.
      if (c.signal?.aborted)
        return this.cancel(job.id, { ...c, signal: undefined });
      return { job: (await this.ensureReview(job, c)) as unknown as Json };
    } catch (error) {
      // Keep QUEUED on transport uncertainty so explicit same-key recovery can discover the original run.
      const latest = await this.row(id);
      latest.job.errors.push({
        timestamp: this.time(),
        message:
          error instanceof AppError
            ? error.message
            : "Worker submission failed; recovery required",
      });
      if (
        !latest.job.remoteId &&
        error instanceof AppError &&
        error.status === 503
      ) {
        latest.job.status = "FAILED";
        latest.job.completedAt = this.time();
      }
      await this.save(
        latest.row,
        latest.job,
        c.actionId!,
        "Submission failed; no unkeyed or automatic repeat",
      );
      throw error instanceof AppError
        ? error
        : new AppError("Worker submission failed; see job history", 502);
    }
  }
  async recover(id: string, c: ToolExecutionContext): Promise<Json> {
    this.checkContext(c);
    const { job } = await this.row(id);
    const source = required(
      await this.repo.get("actions", job.sourceActionId),
      "Original worker action",
    );
    const key = source.metadata.execution_key;
    if (typeof key !== "string")
      throw new AppError(
        "Original execution key unavailable; cannot safely recover",
        409,
      );
    return this.submit(jobInput(job), { ...c, requestKey: key });
  }
  async refresh(id: string, c: ToolExecutionContext): Promise<Json> {
    this.checkContext(c);
    const { row, job } = await this.row(id);
    if (isJobTerminal(job.status) && job.status !== "TIMED_OUT")
      return { job: (await this.ensureReview(job, c)) as unknown as Json };
    if (!job.remoteId) {
      if (this.now() >= Date.parse(job.deadlineAt)) {
        job.status = "TIMED_OUT";
        job.completedAt = this.time();
        return {
          job: (await this.save(
            row,
            job,
            c.actionId!,
            "No submission receipt; timeout does not prove remote cancellation",
          )) as unknown as Json,
        };
      }
      return {
        job: job as unknown as Json,
        recovery:
          "Use worker.recover with Ary approval; it preserves the original provider idempotency key",
      };
    }
    try {
      const provider = this.providers.get(job.provider);
      let state: WorkerSnapshot = await provider.getJobStatus(
        job.remoteId,
        c.signal,
      );
      if (state.remoteId !== job.remoteId)
        throw new AppError("Worker returned a different run identity", 502);
      if (state.status === "COMPLETED")
        state = await provider.getResult(job.remoteId, c.signal);
      if (state.remoteId !== job.remoteId)
        throw new AppError("Worker result identity mismatch", 502);
      job.lastSuccessfulRequest = this.time();
      if (
        !isJobTerminal(state.status) &&
        this.now() >= Date.parse(job.deadlineAt)
      ) {
        await provider.cancelJob(job.remoteId, c.signal);
        state = {
          ...state,
          status: "TIMED_OUT",
          stopRequested: true,
          error:
            "Ary deadline reached; stop requested, remote termination unverified",
        };
      }
      job.status = state.status;
      job.result = state.result;
      job.artifacts = state.result?.artifacts ?? [];
      job.stopRequested ||= !!state.stopRequested;
      if (state.error)
        job.errors.push({ timestamp: this.time(), message: state.error });
      if (isJobTerminal(job.status)) job.completedAt = this.time();
      await this.save(row, job, c.actionId!, "Reconciled provider status");
      return { job: (await this.ensureReview(job, c)) as unknown as Json };
    } catch (error) {
      const latest = await this.row(id);
      if (this.now() >= Date.parse(job.deadlineAt)) {
        latest.job.status = "TIMED_OUT";
        latest.job.completedAt ??= this.time();
      }
      latest.job.errors.push({
        timestamp: this.time(),
        message:
          error instanceof AppError
            ? error.message
            : "Worker status unavailable",
      });
      await this.save(
        latest.row,
        latest.job,
        c.actionId!,
        "Refresh failed; remote state unconfirmed",
      );
      throw error instanceof AppError
        ? error
        : new AppError("Worker status unavailable", 502);
    }
  }
  async cancel(id: string, c: ToolExecutionContext): Promise<Json> {
    this.checkContext(c);
    const { row, job } = await this.row(id);
    if (
      job.status === "CANCELLED" ||
      job.status === "COMPLETED" ||
      job.status === "FAILED"
    )
      return { job: job as unknown as Json };
    if (!job.remoteId)
      throw new AppError(
        "No remote receipt: recover the original submission before confirming cancellation",
        409,
      );
    let state: WorkerSnapshot;
    try {
      state = await this.providers
        .get(job.provider)
        .cancelJob(job.remoteId, c.signal);
    } catch (error) {
      job.errors.push({
        timestamp: this.time(),
        message:
          error instanceof AppError
            ? error.message
            : "Worker cancellation unavailable",
      });
      await this.save(
        row,
        job,
        c.actionId!,
        "Cancellation failed; remote work may still be running",
      );
      throw error instanceof AppError
        ? error
        : new AppError("Worker cancellation unavailable", 502);
    }
    job.stopRequested = true;
    if (state.status === "CANCELLED") {
      job.status = "CANCELLED";
      job.completedAt = this.time();
    }
    return {
      job: (await this.save(
        row,
        job,
        c.actionId!,
        "Cancellation requested; polling must confirm remote termination",
      )) as unknown as Json,
    };
  }
  private async ensureReview(
    job: DelegatedJob,
    c: ToolExecutionContext,
  ): Promise<DelegatedJob> {
    if (
      job.approvalActionId ||
      !(job.status === "WAITING_FOR_APPROVAL" || job.result?.requiresApproval)
    )
      return job;
    try {
      await this.requests.request({
        tool: "worker.review",
        input: { job_id: job.id, proposal: reviewText(job) },
        reason:
          "Review an untrusted worker proposal. Acceptance records review only; any executable action needs its own exact Ary tool request and approval.",
        request_key: `worker-review:${job.id}`,
        related_entity_ids: job.project ? [job.project] : [],
      });
    } catch (error) {
      if (!(error instanceof ApprovalRequiredError)) throw error;
      const latest = await this.row(job.id);
      latest.job.approvalActionId = error.actionId;
      latest.job.status = "WAITING_FOR_APPROVAL";
      await this.save(
        latest.row,
        latest.job,
        c.actionId!,
        "Created an Ary approval; no remote approval or execution authority granted",
      );
      return latest.job;
    }
    return (await this.row(job.id)).job;
  }
  async review(
    id: string,
    proposal: string,
    c: ToolExecutionContext,
  ): Promise<Json> {
    this.checkContext(c);
    const { row, job } = await this.row(id);
    if (proposal !== reviewText(job))
      throw new AppError(
        "Worker proposal changed; request a fresh review",
        409,
      );
    if (!job.result && job.remoteId) {
      // Remote pending tool approval cannot be safely translated into arbitrary execution. Stop it instead.
      await this.providers.get(job.provider).cancelJob(job.remoteId, c.signal);
      job.stopRequested = true;
    }
    if (job.result) {
      job.status = "COMPLETED";
      job.completedAt ??= this.time();
    }
    await this.save(
      row,
      job,
      c.actionId!,
      "Owner reviewed proposal. No proposed effect executed; use a separate registered Ary action",
    );
    return {
      job: job as unknown as Json,
      external_execution_authorized: false,
    };
  }
  async diagnostics(providerId: string) {
    const health = await this.providers.get(providerId).healthCheck();
    const jobs = (await this.list())
      .filter((j) => j.provider === providerId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return {
      health,
      activeJobs: jobs.filter((j) => !isJobTerminal(j.status)).length,
      completedJobs: jobs.filter((j) => j.status === "COMPLETED").length,
      failedJobs: jobs.filter((j) => ["FAILED", "TIMED_OUT"].includes(j.status))
        .length,
      lastSuccessfulRequest:
        jobs
          .map((j) => j.lastSuccessfulRequest)
          .filter((s): s is string => !!s)
          .sort()
          .at(-1) ?? null,
      mostRecentError:
        jobs
          .flatMap((j) => j.errors)
          .sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0]?.message ??
        health.error,
      jobs: jobs.slice(0, 30),
    };
  }
}
function jobInput(job: DelegatedJob) {
  return {
    provider: job.provider,
    agentRole: job.agentRole,
    objective: job.objective,
    context: job.context,
    project: job.project,
    priority: job.priority,
  };
}

function reviewText(job: DelegatedJob) {
  return (
    job.result
      ? `${job.result.summary}\nProposals: ${job.result.proposals.join("\n")}`
      : "Remote tool approval requested. Ary will request that this run stop; it will NOT authorize remote tool execution."
  ).slice(0, 20000);
}
