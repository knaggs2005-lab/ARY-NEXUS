/** Explicit live worker acceptance with a fixed harmless objective and disposable owner store.
 * Approvals here are limited to the diagnostic, reviewing its inert result, and cleanup cancellation.
 * No real user context, production database, external tool or production memory is used.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { loadEnvConfig } from "@next/env";
import {
  AgentProviderRegistry,
  diagnosticObjective,
  isJobTerminal,
  type DelegatedJob,
} from "../src/domain/agent-provider";
import { ToolRegistry } from "../src/domain/tool-registry";
import { HermesAgentProvider } from "../src/infrastructure/agents/hermes-agent-provider";
import { LocalEmbeddingProvider } from "../src/infrastructure/providers/local";
import { LocalRepository } from "../src/infrastructure/repositories/local";
import { registerWorkerTools } from "../src/infrastructure/tools/worker-tools";
import { ActionRequestService } from "../src/services/action-request-service";
import {
  ActionService,
  ApprovalRequiredError,
} from "../src/services/action-service";
import { DelegatedJobService } from "../src/services/delegated-job-service";
import { MemoryService } from "../src/services/memory-service";

async function main() {
  const args = process.argv.slice(2);
  const envIndex = args.indexOf("--env-dir");
  if (
    !args.includes("--live") ||
    envIndex < 0 ||
    !args[envIndex + 1] ||
    !isAbsolute(args[envIndex + 1]) ||
    args.length !== 3
  ) {
    console.log(
      JSON.stringify({
        success: false,
        liveRequestSent: false,
        error: "Requires --live --env-dir /absolute/project/path",
      }),
    );
    process.exitCode = 2;
    return;
  }
  // No environment files are loaded until the explicit opt-in above.
  loadEnvConfig(args[envIndex + 1], false, {
    info: () => {},
    error: () => {},
  });
  const report: Record<string, unknown> = {
    success: false,
    provider: "hermes",
    storage: "isolated_local_owner",
    memoryEmbedding: "local_test_embedding_only",
    productionMemoryModified: false,
    sideEffects: "Independent remote execution-log review required",
  };
  const started = Date.now();
  let dir: string | undefined;
  let requests: ActionRequestService | undefined;
  let actions: ActionService | undefined;
  let service: DelegatedJobService | undefined;
  let job: DelegatedJob | undefined;
  let submissionAttempts = 0;
  let phase = "health";
  const transport: typeof fetch = async (url, options) => {
    if (
      new URL(String(url)).pathname.endsWith("/v1/runs") &&
      options?.method === "POST"
    )
      submissionAttempts++;
    return fetch(url, options);
  };
  const provider = new HermesAgentProvider(undefined, transport);
  const jobFrom = (result: { result: Record<string, unknown> }) =>
    result.result.job as DelegatedJob;
  try {
    const health = await provider.healthCheck();
    report.healthStatus = health.status;
    report.healthLatencyMs = health.latencyMs;
    assert.equal(health.status, "ready");
    dir = await mkdtemp(join(tmpdir(), "ary-hermes-live-"));
    const repository = new LocalRepository(
      randomUUID(),
      join(dir, "store.json"),
    );
    actions = new ActionService(repository);
    const registry = new ToolRegistry();
    const memories = new MemoryService(
      repository,
      new LocalEmbeddingProvider(),
    );
    requests = new ActionRequestService(
      repository,
      actions,
      registry,
      memories,
    );
    service = new DelegatedJobService(
      repository,
      new AgentProviderRegistry().register(provider),
      requests,
    );
    registerWorkerTools(registry, service);
    phase = "submission_approval";
    const raw = {
      tool: "worker.submit",
      input: {
        provider: "hermes",
        agentRole: "diagnostic",
        objective: diagnosticObjective,
        context: "",
      },
      reason: "Explicit live acceptance: fixed harmless diagnostic only",
      request_key: randomUUID(),
    };
    let approvalId = "";
    try {
      await requests.request(raw);
    } catch (error) {
      assert.ok(error instanceof ApprovalRequiredError);
      approvalId = error.actionId;
    }
    assert.ok(approvalId);
    assert.equal(submissionAttempts, 0);
    report.mandatoryApprovalBeforeDispatch = true;
    await actions.permissions.review(
      approvalId,
      "approved",
      "The --live invocation approves only this isolated harmless diagnostic",
    );
    phase = "submission";
    const first = await requests.request(raw);
    job = jobFrom(first);
    const attemptsAfterSubmit = submissionAttempts;
    const replay = await requests.request(raw);
    assert.equal(jobFrom(replay).id, job.id);
    assert.equal(jobFrom(replay).remoteId, job.remoteId);
    assert.equal(submissionAttempts, attemptsAfterSubmit);
    assert.equal((await service.list()).length, 1);
    report.approvedActionReplayWithoutRedispatch = true;
    phase = "completion";
    const deadline = Date.now() + 120000;
    while (!job.result && !isJobTerminal(job.status) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      job = jobFrom(
        await requests.request({
          tool: "worker.refresh",
          input: { job_id: job.id },
          request_key: randomUUID(),
        }),
      );
      if (job.status === "WAITING_FOR_APPROVAL" && !job.result) break;
    }
    report.observedStatus = job.status;
    assert.ok(job.result?.summary.trim());
    assert.ok(job.approvalActionId);
    assert.equal(job.status, "WAITING_FOR_APPROVAL");
    assert.equal((await repository.list("memories")).length, 0);
    phase = "result_review";
    const reviewAction = await repository.get("actions", job.approvalActionId);
    assert.equal(reviewAction?.tool_name, "worker.review");
    assert.ok(reviewAction?.metadata.request_envelope);
    await actions.permissions.review(
      job.approvalActionId,
      "approved",
      "Acceptance records inspection of the diagnostic only; no proposed effect is authorized",
    );
    const reviewed = await requests.request(
      reviewAction.metadata.request_envelope,
    );
    job = jobFrom(reviewed);
    assert.equal(job.status, "COMPLETED");
    assert.equal(reviewed.result.external_execution_authorized, false);
    assert.ok(
      job.auditTrail.some((entry) => entry.status === "WAITING_FOR_APPROVAL"),
    );
    assert.ok(job.auditTrail.some((entry) => entry.status === "COMPLETED"));
    assert.ok(job.createdAt && job.completedAt && job.sourceActionId);
    assert.equal(job.sourceActionId, first.action_id);
    const outcomes = await repository.list("outcomes");
    assert.ok(
      outcomes.some(
        (outcome) =>
          outcome.action_id === reviewed.action_id &&
          outcome.status === "success",
      ),
    );
    const approvals = await repository.list("action_approvals");
    assert.ok(
      approvals.filter((approval) => approval.decision === "approved").length >=
        2,
    );
    report.resultReviewAndAudit = true;
    report.resultSummaryLength = job.result!.summary.length;
    report.completedJobCount = (await service.list()).filter(
      (entry) => entry.status === "COMPLETED",
    ).length;
    phase = "reviewed_memory";
    await requests.remember(reviewed.action_id);
    await requests.remember(reviewed.action_id);
    const stored = await repository.list("memories");
    assert.equal(stored.length, 1);
    assert.equal(stored[0].memory_type, "episodic");
    assert.equal(stored[0].metadata.action_id, reviewed.action_id);
    assert.ok(stored[0].content.includes("not independently verified"));
    report.reviewedEpisodicMemoryIdempotent = true;
    report.actionCount = (await repository.list("actions")).length;
    report.outcomeCount = (await repository.list("outcomes")).length;
    report.success = true;
  } catch {
    // Assertions/provider responses can contain secrets or contextual values: never print them.
    report.error = `Live acceptance failed during ${phase}; no sensitive details logged`;
    process.exitCode = 2;
  } finally {
    if (!report.success && service && requests && actions) {
      try {
        const pending = (await service.list()).find(
          (entry) => !isJobTerminal(entry.status) && entry.remoteId,
        );
        if (pending) {
          const cancel = {
            tool: "worker.cancel",
            input: { job_id: pending.id },
            reason: "Stop the isolated diagnostic after acceptance failure",
            request_key: randomUUID(),
          };
          try {
            await requests.request(cancel);
          } catch (error) {
            if (!(error instanceof ApprovalRequiredError)) throw error;
            await actions.permissions.review(
              error.actionId,
              "approved",
              "Cancel isolated diagnostic only",
            );
            await requests.request(cancel);
          }
          report.cleanupRemoteStop = "requested_not_confirmed";
        }
      } catch {
        report.cleanupRemoteStop = "failed_remote_status_unverified";
      }
    }
    if (dir) {
      await rm(dir, { recursive: true, force: true });
      report.localFixtureCleanup = await access(dir).then(
        () => false,
        () => true,
      );
    } else report.localFixtureCleanup = "no_fixture_created";
    report.submissionHttpAttempts = submissionAttempts;
    report.totalLatencyMs = Date.now() - started;
    console.log(JSON.stringify(report, null, 2));
  }
}
main().catch(() => {
  console.error(
    "Hermes live acceptance setup/cleanup failed; no sensitive details logged",
  );
  process.exitCode = 1;
});
