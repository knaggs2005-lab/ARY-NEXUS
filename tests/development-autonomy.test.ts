import { expect, it, describe } from "vitest";
import { randomUUID } from "node:crypto";
import {
  evaluateAutonomy,
  emptyLedger,
  documentationPath,
  type AutonomyLedger,
} from "../src/domain/development-autonomy";
import {
  reviewCategories,
  type DevelopmentRun,
} from "../src/domain/self-development";
import { digest } from "../src/services/permission-service";
export function candidate(): DevelopmentRun {
  const id = randomUUID(),
    candidate = "a".repeat(64),
    action = randomUUID();
  const manifest = { candidate };
  return {
    version: 1,
    id,
    owner: randomUUID(),
    revision: 8,
    conversation_id: randomUUID(),
    observation: "Correct the documented local port",
    evidence: [
      {
        table: "messages",
        id: randomUUID(),
        hash: "b".repeat(64),
        snapshot: {},
      },
    ],
    proposal: "Fix incorrect local port in troubleshooting guide",
    phase: "RELEASE_CANDIDATE",
    mission_id: randomUUID(),
    plan_hash: "c".repeat(64),
    plan: {
      run_id: id,
      revision: 2,
      base_commit: "d".repeat(40),
      paths: ["docs/troubleshooting.md"],
      acceptance: ["Port is correct"],
      risks: ["Documentation only"],
      rollback: "Retain original commit",
      focused_tests: ["tests/documentation.test.ts"],
    },
    workspace: { base: "d".repeat(40), branch: `ary/dev/${id}`, candidate },
    patch: {
      hash: "e".repeat(64),
      author: "Dev Ary",
      action_id: action,
      value: {
        run_id: id,
        revision: 4,
        changes: [
          {
            path: "docs/troubleshooting.md",
            before: "f".repeat(64),
            content: "Use port 3000.",
          },
        ],
      },
    },
    validation: {
      candidate,
      passed: true,
      sandbox: "macos-seatbelt-deny-default-v1",
      operation_id: randomUUID(),
      commands: (
        ["test", "focused", "typecheck", "format", "build"] as const
      ).map((command) => ({
        command,
        exit_code: 0,
        signal: null,
        duration_ms: 20,
        output: "passed",
        truncated: false,
      })),
    },
    review: {
      candidate,
      action_id: randomUUID(),
      reviewer: "independent-provider:review",
      model: "production-review",
      provider: "openai",
      ready: true,
      result: {
        summary: "Inspected documentation correction",
        checks: Object.fromEntries(
          reviewCategories.map((k) => [
            k,
            { verdict: "pass", reason: "Inspected exact diff" },
          ]),
        ) as any,
      },
      metrics: {
        input_tokens: 1,
        cached_input_tokens: 0,
        output_tokens: 1,
        latency_ms: 1,
        estimated_cost_usd: 0.01,
        retrieval_count: 0,
        pricing_version: "known",
      },
    },
    release: { hash: digest(manifest), manifest },
    history: [
      {
        phase: "REVIEW",
        role: "Security/Review Ary",
        action_id: action,
        at: "2026-09-20T10:00:00.000Z",
      },
    ],
  };
}
export function qualifiedInput() {
  const run = candidate(),
    ledger = emptyLedger();
  run.validation!.tester = `isolated-runner:${run.validation!.operation_id}`;
  const history = Array.from({ length: 3 }, () => {
    const h = candidate();
    h.owner = run.owner;
    h.phase = "COMPLETED";
    h.decision = {
      accept: true,
      reason: "Owner verified released documentation",
      release_hash: h.release!.hash,
      action_id: randomUUID(),
    };
    ledger.qualifications.push({
      run_id: h.id,
      outcome_id: randomUUID(),
      action_id: randomUUID(),
      at: "2026-09-10T00:00:00Z",
      release_hash: h.release!.hash,
      candidate: h.review!.candidate,
    });
    return h;
  });
  return {
    enabled: true,
    run,
    candidate: run.workspace!.candidate,
    diff: "diff --git a/docs/troubleshooting.md b/docs/troubleshooting.md\n-Use port 3001.\n+Use port 3000.",
    files: ["docs/troubleshooting.md"],
    ledger,
    history,
    costUsd: 0.1 as number | null,
    now: Date.parse("2026-09-20T12:00:00Z"),
  };
}
it("qualifies only complete documentary evidence", () =>
  expect(evaluateAutonomy(qualifiedInput()).eligible).toBe(true));
it.each([
  ["disabled", (i: any): unknown => (i.enabled = false)],
  ["no history", (i: any): unknown => (i.history = [])],
  [
    "duplicate history",
    (i: any): unknown =>
      (i.history = [i.history[0], i.history[0], i.history[0]]),
  ],
  [
    "wrong owner",
    (i: any): unknown =>
      i.history.forEach((h: any) => (h.owner = randomUUID())),
  ],
  ["scope drift", (i: any): unknown => (i.files = ["docs/other.md"])],
  ["unknown cost", (i: any): unknown => (i.costUsd = null)],
  ["negative cost", (i: any): unknown => (i.costUsd = -1)],
  ["NaN cost", (i: any): unknown => (i.costUsd = NaN)],
  ["over budget", (i: any): unknown => (i.costUsd = 1.01)],
  ["huge diff", (i: any): unknown => (i.diff = "x".repeat(8193))],
  ["empty diff", (i: any): unknown => (i.diff = "")],
  ["deleted file", (i: any): unknown => (i.diff = "deleted file mode 100644")],
  ["code in docs", (i: any): unknown => (i.diff = "+```sh")],
  ["external link", (i: any): unknown => (i.diff = "+https://evil.example")],
  [
    "new document",
    (i: any): unknown => (i.run.patch.value.changes[0].before = null),
  ],
  [
    "empty document",
    (i: any): unknown => (i.run.patch.value.changes[0].content = ""),
  ],
  [
    "failed test",
    (i: any): unknown => (i.run.validation.commands[0].exit_code = 1),
  ],
  [
    "missing full suite",
    (i: any): unknown => i.run.validation.commands.shift(),
  ],
  [
    "truncated tests",
    (i: any): unknown => (i.run.validation.commands[0].truncated = true),
  ],
  [
    "timed out tests",
    (i: any): unknown => (i.run.validation.commands[0].termination = "timeout"),
  ],
  ["no sandbox", (i: any): unknown => (i.run.validation.sandbox = "none")],
  [
    "stale validation",
    (i: any): unknown => (i.run.validation.candidate = "b".repeat(64)),
  ],
  [
    "stale review",
    (i: any): unknown => (i.run.review.candidate = "b".repeat(64)),
  ],
  [
    "self review",
    (i: any): unknown => (i.run.review.reviewer = i.run.patch.author),
  ],
  [
    "same test/review receipt",
    (i: any): unknown =>
      (i.run.review.action_id = i.run.validation.operation_id),
  ],
  ["fixture review", (i: any): unknown => (i.run.review.provider = "fixture")],
  [
    "review unknown",
    (i: any): unknown =>
      (i.run.review.result.checks.audit_removal.verdict = "unknown"),
  ],
  ["no evidence", (i: any): unknown => (i.run.evidence = [])],
  ["no rollback", (i: any): unknown => (i.run.workspace.base = "")],
  ["already decided", (i: any): unknown => (i.run.decision = { accept: true })],
  [
    "concurrent uncertainty",
    (i: any): unknown =>
      (i.ledger.attempts = [
        { status: "reserved", at: "2026-09-01", run_id: "other", cost_usd: 0 },
      ]),
  ],
  [
    "daily cap",
    (i: any): unknown =>
      (i.ledger.attempts = [
        { status: "released", at: "2026-09-20", run_id: "other", cost_usd: 0 },
      ]),
  ],
  [
    "failed cooldown",
    (i: any): unknown =>
      (i.ledger.attempts = [
        { status: "stopped", at: "2026-09-19", run_id: "other", cost_usd: 0 },
      ]),
  ],
  [
    "retry",
    (i: any): unknown =>
      (i.ledger.attempts = [
        { status: "released", at: "2026-09-01", run_id: i.run.id, cost_usd: 0 },
      ]),
  ],
] as const)("escalates %s", (_name, mutate) => {
  const i = qualifiedInput();
  mutate(i);
  expect(evaluateAutonomy(i).eligible).toBe(false);
});
it.each([
  "src/domain/permissions.ts",
  "docs/auth.md",
  "docs/secrets.md",
  "docs/memory.md",
  "docs/audit.md",
  "docs/brain.md",
  "docs/system-prompts.md",
  "docs/payments.md",
  "docs/finance.md",
  "docs/calling.md",
  "docs/messaging.md",
  "docs/deploy.md",
  "docs/dependencies.md",
  "docs/migrations.md",
  "docs/integrations.md",
  "docs/device-control.md",
  "docs/self-development.md",
  "docs/../../outside.md",
  "docs/x;touch.md",
  "package.json",
  "tests/anything.test.ts",
  "src/components/button.tsx",
])("excludes %s", (path) => expect(documentationPath(path)).toBe(false));

import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { vi } from "vitest";
import {
  GitDevelopmentWorkspace,
  contentHash,
} from "../src/infrastructure/development/workspace";
const execute = promisify(execFile);
async function isolatedRelease() {
  const root = await mkdtemp(join(tmpdir(), "ary-l2-")),
    repo = join(root, "repo");
  await mkdir(join(repo, "docs"), { recursive: true });
  await writeFile(join(repo, "docs/troubleshooting.md"), "Use port 3001.\n");
  const git = async (...args: string[]) =>
    (await execute("/usr/bin/git", args, { cwd: repo })).stdout.trim();
  await git("init", "-b", "main");
  await git("add", "docs/troubleshooting.md");
  await git(
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@localhost",
    "commit",
    "-m",
    "Baseline",
  );
  const base = await git("rev-parse", "HEAD"),
    run = candidate();
  run.plan!.base_commit = base;
  const executor = new GitDevelopmentWorkspace(
    repo,
    join(root, "workspaces"),
    join(root, "deps"),
  );
  run.workspace = await executor.isolate(run, randomUUID());
  run.patch!.value.changes[0].before = contentHash("Use port 3001.\n");
  run.workspace = await executor.apply(run, randomUUID());
  run.review!.candidate = run.workspace.candidate;
  return { root, repo, git, run, executor };
}
it("publishes real local Git objects without changing main, index or working files; replay is idempotent", async () => {
  const f = await isolatedRelease();
  try {
    const before = await f.git("status", "--porcelain"),
      base = await f.git("rev-parse", "main");
    const result = await f.executor.publishLocal(f.run);
    expect(result.healthy).toBe(true);
    expect(await f.git("rev-parse", "main")).toBe(base);
    expect(await f.git("status", "--porcelain")).toBe(before);
    expect(
      await f.git("show", `${result.commit}:docs/troubleshooting.md`),
    ).toBe("Use port 3000.");
    expect(
      await readFile(join(f.repo, "docs/troubleshooting.md"), "utf8"),
    ).toBe("Use port 3001.\n");
    expect(await f.executor.publishLocal(f.run)).toEqual(result);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
it("rolls back only its private ref when deterministic post-publication verification fails", async () => {
  const f = await isolatedRelease();
  try {
    const original = f.executor.inspect.bind(f.executor);
    let calls = 0;
    vi.spyOn(f.executor, "inspect").mockImplementation(async (r) => {
      const value = await original(r);
      return ++calls === 3 ? { ...value, candidate: "changed" } : value;
    });
    const result = await f.executor.publishLocal(f.run);
    expect(result.healthy).toBe(false);
    expect(result.rolled_back).toBe(true);
    expect(await f.git("rev-parse", result.ref)).toBe(f.run.workspace!.base);
    expect(await f.git("rev-parse", "main")).toBe(f.run.workspace!.base);
  } finally {
    vi.restoreAllMocks();
    await rm(f.root, { recursive: true, force: true });
  }
});
it("aborted publication creates no release ref and never retries uncertain execution", async () => {
  const f = await isolatedRelease();
  try {
    const abort = new AbortController();
    abort.abort();
    await expect(
      f.executor.publishLocal(f.run, abort.signal),
    ).rejects.toThrow();
    expect(
      await f.git("for-each-ref", "--format=%(refname)", "refs/ary/releases/"),
    ).toBe("");
    await expect(f.executor.publishLocal(f.run)).rejects.toThrow(
      "Uncertain development operation",
    );
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
it("does not overwrite a preexisting release ref", async () => {
  const f = await isolatedRelease();
  try {
    await f.git(
      "update-ref",
      `refs/ary/releases/${f.run.id}`,
      f.run.workspace!.base,
    );
    await expect(f.executor.publishLocal(f.run)).rejects.toThrow();
    expect(await f.git("rev-parse", `refs/ary/releases/${f.run.id}`)).toBe(
      f.run.workspace!.base,
    );
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

import { missionFixture } from "../scripts/lib/mission-fixture";
import { SelfDevelopmentService } from "../src/services/self-development-service";
import { DevelopmentAutonomyService } from "../src/services/development-autonomy-service";
import { registerDevelopmentTools } from "../src/infrastructure/tools/development-tools";
import { AUTONOMY } from "../src/domain/development-autonomy";
import { createHash } from "node:crypto";
import { ApprovalRequiredError } from "../src/services/action-service";
import { getToolDefinition } from "../src/domain/permissions";
import { forbiddenPath } from "../src/domain/self-development";
async function serviceFixture() {
  const root = await mkdtemp(join(tmpdir(), "ary-l2-service-"));
  const i = qualifiedInput(),
    f = missionFixture(join(root, "data.json"), i.run.owner);
  const conversation = await f.repo.insert("conversations", {
    title: "Isolated Level 2 fixture",
    metadata: {},
  });
  i.run.conversation_id = conversation.id;
  i.run.plan_hash = digest(i.run.plan);
  i.run.patch!.hash = digest(i.run.patch!.value);
  for (const run of [...i.history, i.run])
    await f.repo.batch([
      {
        kind: "insert",
        table: "messages",
        id: run.id,
        data: {
          role: "system",
          content: "Test fixture run",
          conversation_id: conversation.id,
          metadata: { self_development_v1: JSON.parse(JSON.stringify(run)) },
        },
      },
    ]);
  for (const q of i.ledger.qualifications) {
    const historical = i.history.find((h) => h.id === q.run_id)!;
    await f.repo.batch([
      {
        kind: "insert",
        table: "actions",
        id: historical.history[0].action_id,
        data: {
          conversation_id: conversation.id,
          tool_name: "development.finalize",
          action_type: "development_finalize",
          permission_level: 4,
          status: "succeeded",
          input: {},
          output: {},
          error: null,
          metadata: {},
        },
      },
    ]);
    await f.repo.batch([
      {
        kind: "insert",
        table: "outcomes",
        id: q.outcome_id,
        data: {
          action_id: historical.history[0].action_id,
          goal_id: null,
          status: "success",
          summary: "Fixture verified documentation outcome",
          metrics: {},
          metadata: {},
        },
      },
    ]);
  }
  const h = createHash("sha256")
      .update(`${AUTONOMY}:${i.run.owner}`)
      .digest("hex"),
    ledgerId = `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
  await f.repo.batch([
    {
      kind: "insert",
      table: "messages",
      id: ledgerId,
      data: {
        role: "system",
        content: "Test fixture ledger",
        conversation_id: conversation.id,
        metadata: { [AUTONOMY]: JSON.parse(JSON.stringify(i.ledger)) },
      },
    },
  ]);
  for (const record of i.run.history) {
    await f.repo.batch([
      {
        kind: "insert",
        table: "actions",
        id: record.action_id,
        data: {
          conversation_id: conversation.id,
          tool_name: "development.review",
          action_type: "development_review",
          permission_level: 4,
          status: "succeeded",
          input: {},
          output: {},
          error: null,
          metadata: {},
        },
      },
    ]);
    await f.repo.insert("roi_cost_entries", {
      parent_id: null,
      action_id: record.action_id,
      estimated_compute_cost_usd: 0,
      actual_model_cost_usd: 0.1,
      additional_compute_cost_usd: 0,
      tool_cost_usd: 0,
      confidence: 1,
      attribution_notes: "Isolated fixture",
      evidence: "Fixture accounting",
    });
  }
  const publisher = vi.fn(async () => ({
    commit: "e".repeat(40),
    ref: `refs/ary/releases/${i.run.id}`,
    rollback: "d".repeat(40),
    healthy: true,
    rolled_back: false,
  }));
  const executor = {
    inspect: vi.fn(async () => ({
      candidate: i.candidate,
      diff: i.diff,
      files: i.files,
    })),
    publishLocal: publisher,
  } as any;
  const development = new SelfDevelopmentService(
    f.repo,
    f.engine,
    executor,
    {} as any,
  );
  vi.spyOn(development, "inspect").mockResolvedValue({
    mission: { mission: { state: "WAITING" } },
  });
  const service = new DevelopmentAutonomyService(
    f.repo,
    development,
    executor,
    () => true,
    () => i.now,
  );
  registerDevelopmentTools(f.tools, development, () => {}, service);
  const context = () => ({
    userId: i.run.owner,
    productIds: [],
    conversationId: conversation.id,
    actionId: randomUUID(),
    requestKey: randomUUID(),
    stage: () => {},
  });
  return { root, i, f, service, publisher, context, ledgerId, conversation };
}
it("retains existing mandatory supervised approvals and protects Level 2 policy itself", () => {
  expect(getToolDefinition("development.build")?.alwaysRequiresApproval).toBe(
    true,
  );
  expect(getToolDefinition("development.qualify")?.alwaysRequiresApproval).toBe(
    true,
  );
  expect(getToolDefinition("development.autorelease")?.defaultLevel).toBe(4);
  expect(forbiddenPath("src/services/development-autonomy-service.ts")).toBe(
    true,
  );
});
it("real canonical action gate requires release approval by default", async () => {
  const f = await serviceFixture();
  try {
    await expect(
      f.f.coordinator.requests.request({
        tool: "development.autorelease",
        input: { run_id: f.i.run.id, release_hash: f.i.run.release!.hash },
        reason: "Isolated test",
        request_key: randomUUID(),
        conversation_id: f.conversation.id,
      }),
    ).rejects.toBeInstanceOf(ApprovalRequiredError);
    expect(f.publisher).not.toHaveBeenCalled();
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
it("reserves durably and blocks duplicate or concurrent release attempts", async () => {
  const f = await serviceFixture();
  try {
    const results = await Promise.allSettled([
      f.service.release(f.i.run.id, f.i.run.release!.hash, f.context()),
      f.service.release(f.i.run.id, f.i.run.release!.hash, f.context()),
    ]);
    expect(f.publisher).toHaveBeenCalledTimes(1);
    expect(
      results.some(
        (r) => r.status === "fulfilled" && (r.value as any).released,
      ),
    ).toBe(true);
    const again = await f.service.release(
      f.i.run.id,
      f.i.run.release!.hash,
      f.context(),
    );
    expect(again.released).toBe(false);
    expect((await f.service.metrics()).releases).toBe(1);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
it("restart after provider failure cannot replay uncertain publication", async () => {
  const f = await serviceFixture();
  try {
    f.publisher.mockRejectedValueOnce(new Error("unknown effect"));
    await expect(
      f.service.release(f.i.run.id, f.i.run.release!.hash, f.context()),
    ).rejects.toThrow("owner reconciliation");
    expect(
      (await f.service.release(f.i.run.id, f.i.run.release!.hash, f.context()))
        .released,
    ).toBe(false);
    expect(f.publisher).toHaveBeenCalledTimes(1);
    expect((await f.service.metrics()).time_saved).toBeNull();
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
it("rejects manifest tampering and emergency cancellation before Git execution", async () => {
  const f = await serviceFixture();
  try {
    await expect(
      f.service.release(f.i.run.id, "0".repeat(64), f.context()),
    ).rejects.toThrow("manifest changed");
    const abort = new AbortController();
    abort.abort();
    await expect(
      f.service.release(f.i.run.id, f.i.run.release!.hash, {
        ...f.context(),
        signal: abort.signal,
      }),
    ).rejects.toThrow();
    expect(f.publisher).not.toHaveBeenCalled();
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
it("workers cannot self-qualify outcome history", async () => {
  const f = await serviceFixture();
  try {
    await expect(
      f.service.qualify(f.i.history[0].id, randomUUID(), {
        ...f.context(),
        agentId: randomUUID(),
      }),
    ).rejects.toThrow("Only owner");
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
it("outcome correction revokes qualification rather than trusting stale success", async () => {
  const f = await serviceFixture();
  try {
    await f.f.repo.update("outcomes", f.i.ledger.qualifications[0].outcome_id, {
      status: "failure",
    });
    expect((await f.service.inspect(f.i.run.id)).eligible).toBe(false);
    expect(
      (await f.service.release(f.i.run.id, f.i.run.release!.hash, f.context()))
        .released,
    ).toBe(false);
    expect(f.publisher).not.toHaveBeenCalled();
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
it("successful canonical release keeps action and outcome evidence", async () => {
  const f = await serviceFixture();
  try {
    const request = {
      tool: "development.autorelease",
      input: { run_id: f.i.run.id, release_hash: f.i.run.release!.hash },
      reason: "Isolated acceptance publication",
      request_key: randomUUID(),
      conversation_id: f.conversation.id,
    };
    let actionId = "";
    try {
      await f.f.coordinator.requests.request(request);
    } catch (e) {
      if (!(e instanceof ApprovalRequiredError)) throw e;
      actionId = e.actionId;
    }
    await f.f.actions.permissions.review(
      actionId,
      "approved",
      "Owner approves exact fixture publication",
    );
    const execution = await f.f.coordinator.requests.request(request);
    expect(
      (await f.f.repo.list("actions")).some(
        (a) =>
          a.tool_name === "development.autorelease" && a.status === "succeeded",
      ),
    ).toBe(true);
    expect(
      (await f.f.repo.list("outcomes")).some(
        (o) => o.status === "success" && o.action_id === execution.action_id,
      ),
    ).toBe(true);
    expect(f.publisher).toHaveBeenCalledTimes(1);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
it("discovery produces only a proposal, keeps source evidence and obeys cooldown", async () => {
  const f = await serviceFixture();
  try {
    const row = (await f.f.repo.get("messages", f.i.run.id))!;
    const observed = { ...f.i.run, phase: "OBSERVATION", proposal: undefined };
    await f.f.repo.update("messages", row.id, {
      metadata: { self_development_v1: JSON.parse(JSON.stringify(observed)) },
    });
    const request = {
      tool: "development.discover",
      input: { run_id: row.id },
      reason: "Periodic proposal-only discovery",
      request_key: randomUUID(),
      conversation_id: f.conversation.id,
    };
    await f.f.coordinator.requests.request(request);
    const changed = (await f.f.repo.get("messages", row.id))!.metadata
      .self_development_v1 as any;
    expect(changed.phase).toBe("PROPOSAL");
    expect(changed.evidence).toEqual(f.i.run.evidence);
    expect(f.publisher).not.toHaveBeenCalled();
    await expect(
      f.f.coordinator.requests.request({
        ...request,
        request_key: randomUUID(),
      }),
    ).rejects.toThrow();
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
