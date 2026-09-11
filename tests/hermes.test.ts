import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { HermesAgentProvider } from "../src/infrastructure/agents/hermes-agent-provider";
import {
  AgentProviderRegistry,
  diagnosticObjective,
  type DelegatedJob,
  type AgentProvider,
  type WorkerSnapshot,
} from "../src/domain/agent-provider";
import { DelegatedJobService } from "../src/services/delegated-job-service";
import { registerWorkerTools } from "../src/infrastructure/tools/worker-tools";
import { ActionRequestService } from "../src/services/action-request-service";
import { ApprovalRequiredError } from "../src/services/action-service";
import { missionFixture } from "../scripts/lib/mission-fixture";
import { AppError } from "../src/domain/validation";
const config = {
  baseUrl: "https://worker.example.test",
  accessKey: "private-fixture-key",
  restricted: true,
};
const capabilities = {
  object: "hermes.api_server.capabilities",
  auth: { type: "bearer", required: true },
  features: {
    run_submission: true,
    run_status: true,
    run_stop: true,
    run_events_sse: true,
    runs_idempotency: {
      supported: true,
      durable: true,
      retention_seconds: 86400,
    },
  },
};
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });
const fetcher = () =>
  vi.fn<typeof fetch>(async (url) =>
    String(url).endsWith("/capabilities")
      ? response(capabilities)
      : String(url).endsWith("/toolsets")
        ? response({ data: [{ enabled: false }] })
        : response({ run_id: "run_one", status: "started" }),
  );
it("reports missing environment without an HTTP call", async () => {
  const fetch = fetcher();
  const p = new HermesAgentProvider(
    { baseUrl: "", accessKey: "", restricted: false },
    fetch,
  );
  expect(await p.healthCheck()).toMatchObject({
    connected: false,
    status: "unconfigured",
    endpointConfigured: false,
    credentialsConfigured: false,
  });
  expect(fetch).not.toHaveBeenCalled();
});
it.each([
  "http://worker.test",
  "https://name:secret@worker.test",
  "https://worker.test?key=x",
  "https://worker.test/#fragment",
])("rejects unsafe endpoint %s", async (baseUrl) => {
  const fetch = fetcher();
  expect(
    (await new HermesAgentProvider({ ...config, baseUrl }, fetch).healthCheck())
      .status,
  ).toBe("unavailable");
  expect(fetch).not.toHaveBeenCalled();
});
it("checks authenticated capabilities, durable idempotency and disabled tool inventory", async () => {
  const fetch = fetcher();
  const p = new HermesAgentProvider(config, fetch);
  expect(await p.healthCheck()).toMatchObject({
    connected: true,
    status: "ready",
    streaming: true,
  });
  expect(fetch.mock.calls[0][1]).toMatchObject({
    redirect: "error",
    headers: { Authorization: "Bearer private-fixture-key" },
  });
});
it("fails closed on enabled tools, missing attestation and incompatible contracts", async () => {
  let fetch = fetcher();
  expect(
    (
      await new HermesAgentProvider(
        { ...config, restricted: false },
        fetch,
      ).healthCheck()
    ).status,
  ).toBe("restricted_setup_required");
  fetch = fetcher();
  fetch.mockImplementation(async () =>
    response({ ...capabilities, data: [{ enabled: true }] }),
  );
  expect(
    (await new HermesAgentProvider(config, fetch).healthCheck()).status,
  ).toBe("restricted_setup_required");
  fetch = fetcher();
  fetch.mockImplementation(async () =>
    response({
      ...capabilities,
      features: {
        ...capabilities.features,
        runs_idempotency: {
          supported: true,
          durable: false,
          retention_seconds: 86400,
        },
      },
    }),
  );
  expect(
    (await new HermesAgentProvider(config, fetch).healthCheck()).status,
  ).toBe("unavailable");
});
it("redacts provider secrets/endpoint and never accepts provider approval authority", async () => {
  const fetch = fetcher();
  fetch.mockImplementation(async () =>
    response({
      run_id: "run_one",
      status: "completed",
      output: JSON.stringify({
        summary: `${config.accessKey} ${config.baseUrl}`,
        requiresApproval: false,
        proposals: ["Send an email"],
        artifacts: [],
      }),
    }),
  );
  const result = await new HermesAgentProvider(config, fetch).getResult(
    "run_one",
  );
  expect(JSON.stringify(result)).not.toContain(config.accessKey);
  expect(JSON.stringify(result)).not.toContain(config.baseUrl);
  expect(result.result).toMatchObject({
    requiresApproval: true,
    sideEffects: "not_independently_verified",
  });
});
it("bounds retries and hides remote error bodies", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () =>
    response({ secret: config.accessKey }, 503),
  );
  const h = await new HermesAgentProvider(config, fetch).healthCheck();
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(h)).not.toContain(config.accessKey);
});
it.each(["getJobStatus", "getResult"] as const)(
  "%s maps a restarted interrupted run to a safe failure without replaying it",
  async (method) => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      response({
        run_id: "run_one",
        status: "interrupted",
        error: `The gateway restarted: ${config.accessKey}`,
        output: "Unfinished provider output must not become a completed result",
        last_event: "run.interrupted",
      }),
    );
    const state = await new HermesAgentProvider(config, fetch)[method](
      "run_one",
    );
    expect(state).toMatchObject({
      remoteId: "run_one",
      status: "FAILED",
      result: null,
      stopRequested: false,
    });
    expect(state.error).toContain("interrupted run after a gateway restart");
    expect(state.error).toContain("completion is unverified");
    expect(JSON.stringify(state)).not.toContain(config.accessKey);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][1]?.method).toBe("GET");
  },
);
it("rejects injected run identifiers before network access", async () => {
  const fetch = fetcher(),
    p = new HermesAgentProvider(config, fetch);
  await expect(p.getResult("../secrets?x=1")).rejects.toThrow();
  await expect(p.cancelJob("x/approval")).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
});
it("rejects oversized provider bodies", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () =>
    response("x".repeat(130000)),
  );
  await expect(
    new HermesAgentProvider(config, fetch).getResult("run_one"),
  ).rejects.toThrow("safety limit");
});
it("stop is a request, not a fabricated cancelled result", async () => {
  const p = new HermesAgentProvider(config, fetcher());
  expect(await p.cancelJob("run_one")).toMatchObject({
    status: "RUNNING",
    stopRequested: true,
  });
});
let dir: string,
  f: ReturnType<typeof missionFixture>,
  service: DelegatedJobService,
  requests: ActionRequestService,
  provider: AgentProvider,
  snapshot: WorkerSnapshot,
  submit: ReturnType<typeof vi.fn>;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ary-hermes-"));
  f = missionFixture(join(dir, "store.json"), randomUUID());
  snapshot = {
    remoteId: "run_one",
    status: "RUNNING",
    result: null,
    error: null,
  };
  submit = vi.fn(async () => structuredClone(snapshot));
  provider = {
    id: "hermes",
    healthCheck: async () => ({
      connected: true,
      endpointConfigured: true,
      credentialsConfigured: true,
      restrictedWorkerConfirmed: true,
      latencyMs: 1,
      checkedAt: new Date().toISOString(),
      status: "ready",
      streaming: false,
      error: null,
    }),
    submitJob: submit as AgentProvider["submitJob"],
    getJobStatus: async () => structuredClone(snapshot),
    getResult: async () => structuredClone(snapshot),
    cancelJob: vi.fn(async () => ({ ...snapshot, stopRequested: true })),
  };
  requests = new ActionRequestService(f.repo, f.actions, f.tools, f.memories);
  service = new DelegatedJobService(
    f.repo,
    new AgentProviderRegistry().register(provider),
    requests,
  );
  registerWorkerTools(f.tools, service);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});
const input = () => ({
  tool: "worker.submit",
  input: {
    provider: "hermes",
    agentRole: "diagnostic",
    objective: diagnosticObjective,
  },
  reason: "Isolated worker diagnostic",
  request_key: randomUUID(),
});
async function approve(raw: unknown) {
  let id = "";
  try {
    await requests.request(raw);
  } catch (e) {
    expect(e).toBeInstanceOf(ApprovalRequiredError);
    id = (e as ApprovalRequiredError).actionId;
  }
  expect(id).toBeTruthy();
  await f.actions.permissions.review(
    id,
    "approved",
    "Owner approved isolated test",
  );
  return requests.request(raw);
}
const getJob = (v: { result: Record<string, unknown> }) =>
  v.result.job as DelegatedJob;
const completedReplayTransport = (record: unknown, status = 200) =>
  vi.fn<typeof fetch>(async (url, init) => {
    if (String(url).endsWith("/capabilities")) return response(capabilities);
    if (String(url).endsWith("/toolsets"))
      return response({ data: [{ enabled: false }] });
    if (String(url).endsWith("/v1/runs") && init?.method === "POST")
      return response({
        run_id: "durable_run",
        status: "completed",
        replayed: true,
      });
    if (String(url).endsWith("/v1/runs/durable_run") && init?.method === "GET")
      return response(record, status);
    throw new Error("Unexpected fixture request");
  });
it("hydrates a completed replay acknowledgement from the same durable run without redispatch", async () => {
  const job = getJob(await approve(input()));
  const fetch = completedReplayTransport({
    run_id: "durable_run",
    status: "completed",
    output: JSON.stringify({
      summary: "Persisted diagnostic result",
      requiresApproval: false,
      proposals: [],
      artifacts: [],
    }),
  });
  const result = await new HermesAgentProvider(config, fetch).submitJob(job);
  expect(result).toMatchObject({
    remoteId: "durable_run",
    status: "COMPLETED",
    result: { summary: "Persisted diagnostic result", requiresApproval: true },
  });
  const posts = fetch.mock.calls.filter(([, init]) => init?.method === "POST");
  expect(posts).toHaveLength(1);
  expect(posts[0][1]?.headers).toMatchObject({ "Idempotency-Key": job.id });
  expect(
    fetch.mock.calls.filter(([url]) =>
      String(url).endsWith("/v1/runs/durable_run"),
    ),
  ).toHaveLength(1);
});
it.each([
  { run_id: "durable_run", status: "completed" },
  { run_id: "durable_run", status: "completed", output: "  \n" },
  { run_id: "different_run", status: "completed", output: "Unrelated result" },
  { run_id: "durable_run", status: "running", output: "Not terminal" },
])("fails closed on missing or mismatched replay result %j", async (record) => {
  const job = getJob(await approve(input()));
  const fetch = completedReplayTransport(record);
  await expect(
    new HermesAgentProvider(config, fetch).submitJob(job),
  ).rejects.toBeInstanceOf(AppError);
  expect(
    fetch.mock.calls.filter(([, init]) => init?.method === "POST"),
  ).toHaveLength(1);
  expect(
    fetch.mock.calls.filter(([url]) =>
      String(url).endsWith("/v1/runs/durable_run"),
    ),
  ).toHaveLength(1);
});
it("bounds failed replay-result reads and never resubmits the accepted job", async () => {
  const job = getJob(await approve(input()));
  const fetch = completedReplayTransport({}, 503);
  await expect(
    new HermesAgentProvider(config, fetch).submitJob(job),
  ).rejects.toThrow("Hermes request failed (HTTP 503)");
  expect(
    fetch.mock.calls.filter(([, init]) => init?.method === "POST"),
  ).toHaveLength(1);
  expect(
    fetch.mock.calls.filter(([url]) =>
      String(url).endsWith("/v1/runs/durable_run"),
    ),
  ).toHaveLength(2);
});
it("does not fabricate a successful result for a completed run with no output", async () => {
  const transport = vi.fn<typeof fetch>(async () =>
    response({ run_id: "durable_run", status: "completed" }),
  );
  await expect(
    new HermesAgentProvider(config, transport).getResult("durable_run"),
  ).rejects.toThrow("Hermes completed run has no retrievable output");
  expect(transport).toHaveBeenCalledTimes(1);
});
it("approved diagnostic persists context, status, events and pending outcome then replays without a duplicate", async () => {
  const raw = input(),
    first = await approve(raw),
    job = getJob(first);
  expect(job).toMatchObject({
    status: "RUNNING",
    permissions: "advisory_only",
    objective: diagnosticObjective,
    context: "",
    sourceActionId: first.action_id,
  });
  expect(submit).toHaveBeenCalledTimes(1);
  await requests.request(raw);
  expect(submit).toHaveBeenCalledTimes(1);
  expect(await service.list()).toHaveLength(1);
  expect(
    (await f.repo.list("outcomes")).some(
      (o) => o.metadata.job_id === job.id && o.status === "pending",
    ),
  ).toBe(true);
  expect(
    (await f.repo.list("actions")).find((a) => a.id === first.action_id)
      ?.metadata.simulated,
  ).toBe(false);
});
it.each([0, 1, 2, 3])(
  "denies remote submission at permission level %s",
  async (level) => {
    await f.actions.permissions.savePolicy({
      tool: "worker.submit",
      level,
      reason: "Restrict worker",
    });
    await expect(requests.request(input())).rejects.toThrow();
    expect(submit).not.toHaveBeenCalled();
    expect(await service.list()).toEqual([]);
  },
);
it("requires approval even at autonomous level and honours rejection", async () => {
  await f.actions.permissions.savePolicy({
    tool: "worker.submit",
    level: 5,
    reason: "Test ceiling",
  });
  const raw = input();
  try {
    await requests.request(raw);
  } catch (e) {
    await f.actions.permissions.review(
      (e as ApprovalRequiredError).actionId,
      "rejected",
      "Do not share",
    );
  }
  await expect(requests.request(raw)).rejects.toThrow();
  expect(submit).not.toHaveBeenCalled();
});
it("validates input and tenant/project ownership before dispatch", async () => {
  await expect(
    requests.request({
      ...input(),
      input: { ...input().input, permissions: "autonomous" },
    }),
  ).rejects.toThrow();
  await expect(
    requests.request({
      ...input(),
      input: { ...input().input, project: randomUUID() },
    }),
  ).rejects.toThrow();
  await expect(
    service.refresh(randomUUID(), {
      userId: f.repo.userId,
      actionId: randomUUID(),
      productIds: [],
      conversationId: null,
    }),
  ).rejects.toThrow();
  expect(submit).not.toHaveBeenCalled();
});
it("retains uncertain dispatch for safe explicit same-key recovery", async () => {
  const raw = input();
  submit.mockRejectedValueOnce(new AppError("Transport uncertain", 502));
  await expect(approve(raw)).rejects.toThrow("Transport uncertain");
  expect((await service.list())[0]).toMatchObject({
    status: "QUEUED",
    remoteId: null,
  });
  // Failed actions consume approval. A retry needs fresh approval, but retains the job id/provider key.
  const recovered = getJob(
    await approve({
      tool: "worker.recover",
      input: { job_id: (await service.list())[0].id },
      request_key: randomUUID(),
    }),
  );
  expect(recovered.status).toBe("RUNNING");
  expect(await service.list()).toHaveLength(1);
  expect(submit.mock.calls[0][0].id).toBe(submit.mock.calls[1][0].id);
});
it("survives service reconstruction and queues sensitive proposals into existing Ary approvals", async () => {
  const job = getJob(await approve(input()));
  snapshot = {
    ...snapshot,
    status: "COMPLETED",
    result: {
      summary: "A deployment may help",
      requiresApproval: true,
      proposals: ["Deploy production"],
      artifacts: [],
      sideEffects: "not_independently_verified",
    },
  };
  const refreshed = getJob(
    await requests.request({
      tool: "worker.refresh",
      input: { job_id: job.id },
      request_key: randomUUID(),
    }),
  );
  expect(refreshed.status).toBe("WAITING_FOR_APPROVAL");
  expect(refreshed.approvalActionId).toBeTruthy();
  expect(
    (await f.repo.list("actions")).find(
      (a) => a.id === refreshed.approvalActionId,
    ),
  ).toMatchObject({ tool_name: "worker.review", status: "approval_required" });
  expect(
    await new DelegatedJobService(
      f.repo,
      new AgentProviderRegistry().register(provider),
      requests,
    ).list(),
  ).toHaveLength(1);
  expect(await f.repo.list("memories")).toEqual([]);
  expect(submit).toHaveBeenCalledTimes(1);
});
it("completed outcome is only copied to episodic memory after explicit existing memory review", async () => {
  const job = getJob(await approve(input()));
  snapshot = {
    ...snapshot,
    status: "COMPLETED",
    result: {
      summary: "Received a harmless diagnostic.",
      requiresApproval: false,
      proposals: [],
      artifacts: [],
      sideEffects: "not_independently_verified",
    },
  };
  const done = await requests.request({
    tool: "worker.refresh",
    input: { job_id: job.id },
    request_key: randomUUID(),
  });
  expect(getJob(done).status).toBe("COMPLETED");
  expect(await f.repo.list("memories")).toEqual([]);
  await requests.remember(done.action_id);
  await requests.remember(done.action_id);
  const memory = await f.repo.list("memories");
  expect(memory).toHaveLength(1);
  expect(memory[0].memory_type).toBe("episodic");
  expect(memory[0].content).toContain("not independently verified");
  expect(memory[0].metadata.action_id).toBe(done.action_id);
  expect(memory[0].content).not.toContain("Created an internal task");
});
it("failed worker is persisted as a failure outcome; cancellation is not falsely completed", async () => {
  const job = getJob(await approve(input()));
  const stopped = getJob(
    await requests.request({
      tool: "worker.cancel",
      input: { job_id: job.id },
      request_key: randomUUID(),
    }),
  );
  expect(stopped).toMatchObject({ status: "RUNNING", stopRequested: true });
  snapshot = { ...snapshot, status: "FAILED", error: "Provider failure" };
  const failed = await requests.request({
    tool: "worker.refresh",
    input: { job_id: job.id },
    request_key: randomUUID(),
  });
  expect(getJob(failed).status).toBe("FAILED");
  expect(
    (await f.repo.list("outcomes")).find(
      (o) => o.action_id === failed.action_id,
    )?.status,
  ).toBe("failure");
});
it("persists gateway interruption in the canonical job and failure outcome without resubmission", async () => {
  const job = getJob(await approve(input()));
  const fetch = vi.fn<typeof globalThis.fetch>(async () =>
    response({ run_id: "run_one", status: "interrupted" }),
  );
  const transport = new HermesAgentProvider(config, fetch);
  provider.getJobStatus = transport.getJobStatus.bind(transport);
  const raw = {
    tool: "worker.refresh",
    input: { job_id: job.id },
    request_key: randomUUID(),
  };
  const refreshed = await requests.request(raw);
  const failed = getJob(refreshed);
  expect(failed).toMatchObject({
    id: job.id,
    remoteId: job.remoteId,
    status: "FAILED",
    result: null,
    artifacts: [],
  });
  expect(failed.completedAt).toBeTruthy();
  expect(failed.errors.at(-1)?.message).toContain(
    "interrupted run after a gateway restart",
  );
  expect(failed.auditTrail.at(-1)).toMatchObject({
    status: "FAILED",
    actionId: refreshed.action_id,
  });
  expect(
    (await f.repo.list("outcomes")).find(
      (o) => o.action_id === refreshed.action_id,
    )?.status,
  ).toBe("failure");
  await requests.request(raw);
  await requests.request({ ...raw, request_key: randomUUID() });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(submit).toHaveBeenCalledTimes(1);
  expect(await service.list()).toHaveLength(1);
  expect(await f.repo.list("memories")).toEqual([]);
});
it("deadline sends a bounded stop request, records TIMED_OUT and preserves uncertainty", async () => {
  const job = getJob(await approve(input()));
  const later = new DelegatedJobService(
    f.repo,
    new AgentProviderRegistry().register(provider),
    requests,
    () => Date.now() + 16 * 60000,
  );
  const result = await later.refresh(job.id, {
    userId: f.repo.userId,
    actionId: randomUUID(),
    productIds: [],
    conversationId: null,
  });
  expect(result.job).toMatchObject({
    status: "TIMED_OUT",
    stopRequested: true,
  });
  expect(provider.cancelJob).toHaveBeenCalledTimes(1);
});
it("registry rejects duplicate providers", () => {
  expect(() =>
    new AgentProviderRegistry().register(provider).register(provider),
  ).toThrow("Duplicate");
});
it("does not dispatch when the initial database transaction fails", async () => {
  const batch = f.repo.batch.bind(f.repo);
  vi.spyOn(f.repo, "batch").mockImplementation(async (mutations) => {
    if (
      mutations.some((m) => m.kind === "insert" && m.table === "conversations")
    )
      throw new AppError("Fixture DB unavailable", 503);
    return batch(mutations);
  });
  await expect(approve(input())).rejects.toThrow("Fixture DB unavailable");
  expect(submit).not.toHaveBeenCalled();
  expect(await service.list()).toHaveLength(0);
  expect(await f.repo.list("conversations")).toHaveLength(0);
  expect(
    (await f.repo.list("actions")).some(
      (a) => a.tool_name === "worker.submit" && a.status === "failed",
    ),
  ).toBe(true);
});
it("preserves the dispatch key across a crash between provider acceptance and local receipt", async () => {
  const batch = f.repo.batch.bind(f.repo);
  let failed = false;
  vi.spyOn(f.repo, "batch").mockImplementation(async (mutations) => {
    if (
      !failed &&
      mutations.some(
        (m) =>
          m.kind === "update" &&
          m.table === "messages" &&
          (m.data.metadata?.job as DelegatedJob | undefined)?.status ===
            "RUNNING",
      )
    ) {
      failed = true;
      throw new Error("Injected receipt failure");
    }
    return batch(mutations);
  });
  await expect(approve(input())).rejects.toThrow();
  const queued = (await service.list())[0];
  expect(queued.status).toBe("QUEUED");
  const recovered = getJob(
    await approve({
      tool: "worker.recover",
      input: { job_id: queued.id },
      request_key: randomUUID(),
    }),
  );
  expect(recovered.remoteId).toBe("run_one");
  expect(submit.mock.calls[0][0].id).toBe(submit.mock.calls[1][0].id);
  expect(await service.list()).toHaveLength(1);
});
it("denies scope-specific worker reads and blocks emergency-stop submissions", async () => {
  const project = await f.entities.createEntity({
    entity_type: "project",
    name: "Worker scoped project",
  });
  const job = getJob(
    await approve({
      ...input(),
      input: { ...input().input, project: project.id },
    }),
  );
  await f.actions.permissions.savePolicy({
    tool: "worker.refresh",
    product_entity_id: project.id,
    level: 0,
    reason: "Deny scoped reads",
  });
  await expect(
    requests.request({
      tool: "worker.refresh",
      input: { job_id: job.id },
      request_key: randomUUID(),
    }),
  ).rejects.toThrow();
});
it("records proposal approval without executing it or granting remote authority", async () => {
  const job = getJob(await approve(input()));
  snapshot = {
    ...snapshot,
    status: "COMPLETED",
    result: {
      summary: "Consider changing production",
      requiresApproval: true,
      proposals: ["Deploy code"],
      artifacts: [],
      sideEffects: "not_independently_verified",
    },
  };
  const pending = getJob(
    await requests.request({
      tool: "worker.refresh",
      input: { job_id: job.id },
      request_key: randomUUID(),
    }),
  );
  const action = (await f.repo.get("actions", pending.approvalActionId!))!;
  expect(action.input.proposal).toContain("Deploy code");
  await f.actions.permissions.review(
    action.id,
    "approved",
    "Review acknowledged; no deployment authorized",
  );
  const reviewed = await requests.request(action.metadata.request_envelope);
  expect(reviewed.result.external_execution_authorized).toBe(false);
  expect(getJob(reviewed).status).toBe("COMPLETED");
  expect(submit).toHaveBeenCalledTimes(1);
  expect(
    (await f.repo.list("actions")).every(
      (a) =>
        a.tool_name.startsWith("worker.") ||
        a.tool_name.startsWith("entity.") ||
        a.tool_name.startsWith("permissions."),
    ),
  ).toBe(true);
});
it("SSE forwards bounded lifecycle labels, never raw messages", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(
    async () =>
      new Response(
        `data: {"event":"run.started","run_id":"run_one","secret":"${config.accessKey}"}\n\ndata: {"event":"tool.started","run_id":"run_one","preview":"private"}\n\ndata: {"event":"tool.completed","run_id":"run_other"}\n\nevent: arbitrary.secret\ndata: secret\n\n`,
      ),
  );
  const events = [];
  for await (const event of new HermesAgentProvider(config, fetch).streamEvents(
    "run_one",
  ))
    events.push(event);
  expect(events).toEqual([{ type: "run.started" }, { type: "tool.started" }]);
  expect(JSON.stringify(events)).not.toContain(config.accessKey);
});
it("aborted requests never retry and timeouts stay bounded", async () => {
  const controller = new AbortController();
  controller.abort();
  const fetch = vi.fn<typeof globalThis.fetch>(async (_u, opts) => {
    opts?.signal?.throwIfAborted();
    throw new Error("offline");
  });
  await expect(
    new HermesAgentProvider(config, fetch).getResult(
      "run_one",
      controller.signal,
    ),
  ).rejects.toThrow("cancelled");
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("emergency stop blocks new jobs while keeping cancellation available", async () => {
  const job = getJob(await approve(input()));
  await f.actions.permissions.setEmergencyStop(
    true,
    "Stop worker acceptance",
    null,
  );
  await expect(requests.request(input())).rejects.toThrow();
  const cancelled = await requests.request({
    tool: "worker.cancel",
    input: { job_id: job.id },
    request_key: randomUUID(),
  });
  expect(getJob(cancelled).stopRequested).toBe(true);
  expect(submit).toHaveBeenCalledTimes(1);
});
it("a provider outage after the deadline records timeout without claiming remote cancellation", async () => {
  const job = getJob(await approve(input()));
  provider.getJobStatus = async () => {
    throw new AppError("Hermes unavailable", 502);
  };
  const later = new DelegatedJobService(
    f.repo,
    new AgentProviderRegistry().register(provider),
    requests,
    () => Date.now() + 16 * 60000,
  );
  await expect(
    later.refresh(job.id, {
      userId: f.repo.userId,
      actionId: randomUUID(),
      productIds: [],
      conversationId: null,
    }),
  ).rejects.toThrow();
  expect((await service.list())[0]).toMatchObject({
    status: "TIMED_OUT",
    stopRequested: false,
  });
});
it("redacts JSON-escaped endpoint and key values after decoding", async () => {
  const raw = JSON.stringify({
    run_id: "run_one",
    status: "completed",
    output: JSON.stringify({
      summary: `${config.baseUrl} ${config.accessKey}`,
      requiresApproval: false,
      proposals: [],
      artifacts: [],
    }).replaceAll("/", "\\/"),
  }).replaceAll("private", "\\u0070rivate");
  const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(raw));
  const result = await new HermesAgentProvider(config, fetch).getResult(
    "run_one",
  );
  expect(JSON.stringify(result)).not.toContain(config.accessKey);
  expect(JSON.stringify(result)).not.toContain(config.baseUrl);
  expect(result.result?.requiresApproval).toBe(true);
});
it("retains failed cancellation in job history without claiming a stop", async () => {
  const job = getJob(await approve(input()));
  provider.cancelJob = async () => {
    throw new AppError("Provider stop unavailable", 502);
  };
  await expect(
    requests.request({
      tool: "worker.cancel",
      input: { job_id: job.id },
      request_key: randomUUID(),
    }),
  ).rejects.toThrow("Provider stop unavailable");
  const current = (await service.list())[0];
  expect(current.stopRequested).toBe(false);
  expect(current.errors.at(-1)?.message).toBe("Provider stop unavailable");
});
