/** Explicit opt-in cancellation acceptance through Ary's existing action pipeline.
 * Uses one harmless bounded-output job, a disposable local owner and no user context.
 * Never reports successful cancellation from a stop acknowledgement alone.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { loadEnvConfig } from "@next/env";
import {
  AgentProviderRegistry,
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

const objective =
  "This is a harmless cancellation diagnostic. Without tools or delegation, write 80 short numbered sentences explaining how a fictional librarian sorts imaginary colored index cards. Use only this invented scenario. Do not modify files, systems, accounts, or external services. Stop immediately if interrupted.";

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
  loadEnvConfig(args[envIndex + 1], false, { info: () => {}, error: () => {} });
  const report: Record<string, unknown> = {
    success: false,
    provider: "hermes",
    storage: "isolated_local_owner",
    productionMemoryModified: false,
    cancellationConfirmed: false,
    sideEffects: "Independent remote execution-log review required",
  };
  const started = Date.now();
  let transportDeadline = started + 120_000;
  let dir: string | undefined;
  let requests: ActionRequestService | undefined;
  let actions: ActionService | undefined;
  let service: DelegatedJobService | undefined;
  let job: DelegatedJob | undefined;
  let submissionAttempts = 0;
  let stopAttempts = 0;
  let phase = "health";
  let preserveRecoveryFixture = false;
  const transport: typeof fetch = async (url, options) => {
    const path = new URL(String(url)).pathname;
    if (options?.method === "POST" && path.endsWith("/v1/runs"))
      submissionAttempts++;
    if (options?.method === "POST" && /\/v1\/runs\/[^/]+\/stop$/.test(path))
      stopAttempts++;
    const remaining = transportDeadline - Date.now();
    if (remaining <= 0)
      throw new Error("Acceptance transport deadline reached");
    const timeout = AbortSignal.timeout(Math.min(12_000, remaining));
    return fetch(url, {
      ...options,
      signal: options?.signal
        ? AbortSignal.any([options.signal, timeout])
        : timeout,
    });
  };
  const provider = new HermesAgentProvider(undefined, transport);
  const jobFrom = (result: { result: Record<string, unknown> }) =>
    result.result.job as DelegatedJob;
  const requestApprovedIfNeeded = async (raw: unknown) => {
    assert.ok(requests && actions);
    try {
      return await requests.request(raw);
    } catch (error) {
      if (!(error instanceof ApprovalRequiredError)) throw error;
      await actions.permissions.review(
        error.actionId,
        "approved",
        "The --live invocation authorizes only stopping this isolated diagnostic",
      );
      return requests.request(raw);
    }
  };
  try {
    const health = await provider.healthCheck();
    report.healthStatus = health.status;
    report.healthLatencyMs = health.latencyMs;
    assert.equal(health.status, "ready");
    dir = await mkdtemp(join(tmpdir(), "ary-hermes-cancel-"));
    const repository = new LocalRepository(
      randomUUID(),
      join(dir, "store.json"),
    );
    actions = new ActionService(repository);
    const registry = new ToolRegistry();
    requests = new ActionRequestService(
      repository,
      actions,
      registry,
      new MemoryService(repository, new LocalEmbeddingProvider()),
    );
    service = new DelegatedJobService(
      repository,
      new AgentProviderRegistry().register(provider),
      requests,
    );
    registerWorkerTools(registry, service);
    const submit = {
      tool: "worker.submit",
      input: {
        provider: "hermes",
        agentRole: "diagnostic",
        objective,
        context: "",
      },
      reason:
        "Explicit live cancellation acceptance: harmless invented-text diagnostic only",
      request_key: randomUUID(),
    };
    phase = "submission_approval";
    let approvalId = "";
    try {
      await requests.request(submit);
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
      "The --live invocation approves this one isolated harmless cancellation diagnostic",
    );
    phase = "submission";
    const first = await requests.request(submit);
    job = jobFrom(first);
    assert.ok(job.remoteId);
    phase = "cancellation_request";
    const cancel = {
      tool: "worker.cancel",
      input: { job_id: job.id },
      reason:
        "Immediately interrupt the isolated diagnostic through the existing action pipeline",
      request_key: randomUUID(),
    };
    const cancelStarted = Date.now();
    const cancellation = await requestApprovedIfNeeded(cancel);
    job = jobFrom(cancellation);
    report.stopRequestLatencyMs = Date.now() - cancelStarted;
    report.stopRequested = job.stopRequested;
    phase = "cancellation_confirmation";
    const deadline = Math.min(transportDeadline, Date.now() + 60_000);
    let lastRefreshActionId: string | undefined;
    let polls = 0;
    while (
      job.status !== "CANCELLED" &&
      !isJobTerminal(job.status) &&
      !job.result &&
      Date.now() < deadline &&
      polls < 30
    ) {
      const refreshed = await requests.request({
        tool: "worker.refresh",
        input: { job_id: job.id },
        request_key: randomUUID(),
      });
      job = jobFrom(refreshed);
      lastRefreshActionId = refreshed.action_id;
      polls++;
      if (
        job.status !== "CANCELLED" &&
        !isJobTerminal(job.status) &&
        !job.result
      )
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
    report.observedStatus = job.status;
    report.pollCount = polls;
    assert.equal(job.status, "CANCELLED");
    assert.equal(job.stopRequested, true);
    assert.ok(job.completedAt);
    report.cancellationConfirmed = true;
    report.confirmedCancellationLatencyMs = Date.now() - cancelStarted;
    phase = "idempotent_replay";
    const submissionsBeforeReplay = submissionAttempts;
    const stopsBeforeReplay = stopAttempts;
    const submitReplay = await requests.request(submit);
    const cancelReplay = await requestApprovedIfNeeded(cancel);
    assert.equal(submitReplay.action_id, first.action_id);
    assert.equal(cancelReplay.action_id, cancellation.action_id);
    assert.equal(jobFrom(submitReplay).id, job.id);
    assert.equal(jobFrom(cancelReplay).remoteId, job.remoteId);
    assert.equal(submissionAttempts, submissionsBeforeReplay);
    assert.equal(stopAttempts, stopsBeforeReplay);
    assert.equal((await service.list()).length, 1);
    report.replayWithoutRemoteRedispatch = true;
    phase = "audit_and_outcome";
    const recordedActions = await repository.list("actions");
    const outcomes = await repository.list("outcomes");
    // These are successful CONTROL actions, but outcomes describe the delegated job:
    // unfinished = pending; cancelled = failure to complete. Do not fabricate job success.
    const expectedOutcomes: Array<{
      actionId: string;
      outcome: "pending" | "failure";
      phase: string;
    }> = [
      { actionId: first.action_id, outcome: "pending", phase: "submission" },
      {
        actionId: cancellation.action_id,
        outcome:
          jobFrom(cancellation).status === "CANCELLED" ? "failure" : "pending",
        phase: "stop_request",
      },
      ...(lastRefreshActionId
        ? [
            {
              actionId: lastRefreshActionId,
              outcome: "failure" as const,
              phase: "confirmed_cancellation",
            },
          ]
        : []),
    ];
    const outcomeChecks: Record<string, string> = {};
    for (const expected of expectedOutcomes) {
      phase = `audit_action_${expected.phase}`;
      const action = recordedActions.find(
        (entry) => entry.id === expected.actionId,
      );
      assert.equal(action?.status, "succeeded");
      phase = `audit_outcome_${expected.phase}`;
      assert.ok(
        outcomes.some(
          (outcome) =>
            outcome.action_id === expected.actionId &&
            outcome.status === expected.outcome &&
            outcome.metadata.job_id === job!.id &&
            outcome.metadata.provider === "hermes",
        ),
      );
      outcomeChecks[expected.phase] = expected.outcome;
    }
    report.jobOutcomeStatuses = outcomeChecks;
    report.controlActionsSucceeded = true;
    phase = "audit_history";
    assert.ok(
      job.auditTrail.some((entry) => entry.actionId === cancellation.action_id),
    );
    assert.ok(job.auditTrail.some((entry) => entry.status === "CANCELLED"));
    assert.ok(
      (await repository.list("action_approvals")).some(
        (approval) => approval.decision === "approved",
      ),
    );
    assert.equal((await repository.list("memories")).length, 0);
    report.auditAndOutcomeLinked = true;
    report.actionCount = recordedActions.length;
    report.outcomeCount = outcomes.length;
    report.success = true;
  } catch {
    report.error = `Cancellation acceptance failed during ${phase}; no sensitive details logged`;
    process.exitCode = 2;
  } finally {
    if (!report.success && service && requests && actions) {
      transportDeadline = Date.now() + 30_000;
      try {
        job = (await service.list()).find(
          (entry) => !isJobTerminal(entry.status),
        );
        if (job && !job.remoteId) {
          preserveRecoveryFixture = true;
          report.cleanupRemoteStatus = "submission_receipt_unknown";
        } else if (job && !job.result) {
          job = jobFrom(
            await requestApprovedIfNeeded({
              tool: "worker.cancel",
              input: { job_id: job.id },
              reason: "Stop isolated cancellation-test fixture after failure",
              request_key: randomUUID(),
            }),
          );
          let cleanupPolls = 0;
          while (
            !isJobTerminal(job.status) &&
            !job.result &&
            cleanupPolls < 5 &&
            Date.now() < transportDeadline
          ) {
            job = jobFrom(
              await requests.request({
                tool: "worker.refresh",
                input: { job_id: job.id },
                request_key: randomUUID(),
              }),
            );
            cleanupPolls++;
            if (!isJobTerminal(job.status) && !job.result)
              await new Promise((resolve) => setTimeout(resolve, 250));
          }
          report.cleanupRemoteStatus = job.status;
          report.cleanupRemoteStopConfirmed = job.status === "CANCELLED";
          preserveRecoveryFixture = !isJobTerminal(job.status) && !job.result;
        } else
          report.cleanupRemoteStatus = job?.result
            ? "completed_before_cancellation"
            : "no_active_job";
      } catch {
        report.cleanupRemoteStatus = "unverified";
        preserveRecoveryFixture = true;
      }
    }
    if (dir && preserveRecoveryFixture) {
      // Do not erase the sole recovery receipt while remote termination is uncertain.
      report.localFixtureCleanup = false;
      report.recoveryFixture = dir;
    } else if (dir) {
      await rm(dir, { recursive: true, force: true });
      report.localFixtureCleanup = await access(dir).then(
        () => false,
        () => true,
      );
    } else report.localFixtureCleanup = "no_fixture_created";
    report.submissionHttpAttempts = submissionAttempts;
    report.stopHttpAttempts = stopAttempts;
    report.totalLatencyMs = Date.now() - started;
    console.log(JSON.stringify(report, null, 2));
  }
}
main().catch(() => {
  console.error(
    "Hermes cancellation acceptance setup/cleanup failed; no sensitive details logged",
  );
  process.exitCode = 1;
});
