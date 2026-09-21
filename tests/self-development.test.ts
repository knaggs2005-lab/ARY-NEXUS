import { beforeEach, afterEach, it, expect, vi } from "vitest";
import {
  mkdtemp,
  rm,
  mkdir,
  writeFile,
  readFile,
  realpath,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { missionFixture } from "../scripts/lib/mission-fixture";
import { SelfDevelopmentService } from "../src/services/self-development-service";
import { registerDevelopmentTools } from "../src/infrastructure/tools/development-tools";
import {
  GitDevelopmentWorkspace,
  contentHash,
} from "../src/infrastructure/development/workspace";
import {
  sandboxProfile,
  runSandboxed,
} from "../src/infrastructure/development/runner";
import { ApprovalRequiredError } from "../src/services/action-service";
import { getToolDefinition } from "../src/domain/permissions";
import {
  reviewCategories,
  forbiddenPath,
  protectedPath,
  sourcePath,
  type DevelopmentRun,
} from "../src/domain/self-development";
import type { LanguageModelProvider } from "../src/domain/providers";
import { agentExecution } from "../src/services/agent-context";
const exec = promisify(execFile);
let dir: string,
  base: string,
  user: string,
  conversation: string,
  f: ReturnType<typeof missionFixture>,
  service: SelfDevelopmentService,
  workspace: GitDevelopmentWorkspace;
const runner = vi.fn(async (command: any) => ({
  command,
  exit_code: 0,
  signal: null,
  duration_ms: 2,
  output: "fixture command completed",
  truncated: false,
}));
const review = vi.fn(async () => ({
  content: JSON.stringify({
    summary: "Independent fixture review",
    checks: Object.fromEntries(
      reviewCategories.map((k) => [
        k,
        { verdict: "pass", reason: "Inspected exact fixture diff" },
      ]),
    ),
  }),
  model: "review-fixture",
  provider: "fixture",
  metrics: {
    input_tokens: 20,
    cached_input_tokens: 0,
    output_tokens: 30,
    latency_ms: 2,
    estimated_cost_usd: null,
    retrieval_count: 0,
    pricing_version: "fixture",
  },
}));
function attach() {
  f = missionFixture(join(dir, "data.json"), user, true);
  workspace = new GitDevelopmentWorkspace(
    join(dir, "repo"),
    join(dir, "workspaces"),
    join(dir, "deps"),
    runner,
  );
  service = new SelfDevelopmentService(f.repo, f.engine, workspace, {
    ...f.model,
    reasonWithUsage: review,
  } as unknown as LanguageModelProvider);
  registerDevelopmentTools(f.tools, service);
}
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ary-self-dev-"));
  user = randomUUID();
  await mkdir(join(dir, "repo", "src"), { recursive: true });
  await mkdir(join(dir, "deps"));
  await mkdir(join(dir, "repo", "tests"));
  await writeFile(
    join(dir, "repo", "src", "sample.ts"),
    "export const value = 1;\n",
  );
  await writeFile(
    join(dir, "repo", "tests", "baseline.test.ts"),
    "// Existing test must stay unchanged\n",
  );
  await exec("/usr/bin/git", ["init", "-b", "main"], {
    cwd: join(dir, "repo"),
  });
  await exec("/usr/bin/git", ["add", "."], { cwd: join(dir, "repo") });
  await exec(
    "/usr/bin/git",
    [
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "-m",
      "Fixture baseline",
    ],
    { cwd: join(dir, "repo") },
  );
  base = (
    await exec("/usr/bin/git", ["rev-parse", "HEAD"], {
      cwd: join(dir, "repo"),
    })
  ).stdout.trim();
  runner.mockClear();
  review.mockClear();
  attach();
  conversation = (
    await f.repo.insert("conversations", {
      title: "Engineering evidence",
      metadata: {},
    })
  ).id;
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});
async function request(
  tool: string,
  input: unknown,
  approve = true,
  key = randomUUID(),
) {
  const envelope = {
    tool,
    input,
    reason: "Supervised engineering fixture",
    request_key: key,
    conversation_id: conversation,
  };
  try {
    return await f.coordinator.requests.request(envelope);
  } catch (e) {
    if (!approve || !(e instanceof ApprovalRequiredError)) throw e;
    await f.actions.permissions.review(
      e.actionId,
      "approved",
      "Owner approves exact fixture action",
    );
    return f.coordinator.requests.request(envelope);
  }
}
async function planned(paths = ["src/sample.ts", "tests/new.test.ts"]) {
  const evidence = await f.repo.insert("messages", {
    conversation_id: conversation,
    role: "user",
    content: "The sample value is wrong",
    metadata: {},
  });
  const observed = await request("development.observe", {
    observation: "Fix observed sample value",
    evidence: [{ table: "messages", id: evidence.id }],
  });
  const id = observed.result.run_id as string;
  await request("development.propose", {
    run_id: id,
    revision: 0,
    proposal: "Correct the sample with a regression",
  });
  await request("development.plan", {
    run_id: id,
    revision: 1,
    base_commit: base,
    paths,
    acceptance: ["Sample value becomes two"],
    risks: ["Small behavior change"],
    rollback: "Reject the isolated branch; main remains unchanged",
    focused_tests: ["tests/new.test.ts"],
  });
  return (await service.read(id)).run;
}
async function start(run: DevelopmentRun) {
  await request("development.build", {
    run_id: run.id,
    plan_hash: run.plan_hash,
  });
  const id = (await service.read(run.id)).run.mission_id!;
  let p = await f.engine.inspect(id);
  p = await f.engine.control(id, "plan", p.revision);
  p = await f.engine.tick(id);
  expect(p.mission?.state, JSON.stringify(p)).toBe("READY");
  await f.engine.control(id, "start", p.revision);
  return id;
}
async function advance(id: string, target: string) {
  for (let n = 0; n < 30; n++) {
    let p = await f.engine.tick(id);
    if (p.mission?.state === "APPROVAL_REQUIRED") {
      const action =
        Object.values(p.states).find((s) => s.status === "waiting_approval")
          ?.approval_action_id ??
        Object.values(p.states).find((s) => s.approval_action_id)
          ?.approval_action_id;
      expect(action, JSON.stringify(p)).toBeTruthy();
      await f.actions.permissions.review(
        action!,
        "approved",
        "Approve exact isolated stage",
      );
      p = await f.engine.control(id, "resume", p.revision);
    }
    const run = (await f.repo.list("messages")).find(
      (m) =>
        (m.metadata.self_development_v1 as DevelopmentRun)?.mission_id === id,
    )?.metadata.self_development_v1 as DevelopmentRun;
    if (run?.phase === target) return run;
    if (p.mission?.state === "FAILED") throw new Error(JSON.stringify(p));
  }
  throw new Error(
    `Did not reach ${target}: ${JSON.stringify(await f.engine.inspect(id))}`,
  );
}
async function patched() {
  const run = await planned(),
    id = await start(run);
  await advance(id, "WORKSPACE");
  const current = (await service.read(run.id)).run;
  await request("development.patch", {
    run_id: run.id,
    revision: current.revision,
    changes: [
      {
        path: "src/sample.ts",
        before: contentHash("export const value = 1;\n"),
        content: "export const value = 2;\n",
      },
      {
        path: "tests/new.test.ts",
        before: null,
        content: "// Regression fixture\n",
      },
    ],
  });
  await f.engine.tick(id);
  await f.engine.submit(id, {
    id: randomUUID(),
    name: "patch_ready",
    payload: { submitted: true },
  });
  return { run, id };
}
it("uses the existing mission, approvals, receipts and outcomes through owner decision without merging", async () => {
  const { run, id } = await patched();
  await advance(id, "RELEASE_CANDIDATE");
  const ready = (await service.read(run.id)).run;
  expect(ready.release?.manifest.recommendation).toBe("READY");
  expect(ready.release?.manifest.diff).toContain("value = 2");
  expect(runner.mock.calls.map((c) => c[0])).toEqual([
    "test",
    "focused",
    "typecheck",
    "format",
    "build",
  ]);
  expect(review).toHaveBeenCalledOnce();
  await request("development.decide", {
    run_id: run.id,
    release_hash: ready.release!.hash,
    accept: true,
    reason: "Owner accepts candidate for a separate manual merge",
  });
  await f.engine.tick(id);
  await f.engine.submit(id, {
    id: randomUUID(),
    name: "owner_decision",
    payload: { decided: true },
  });
  const done = await advance(id, "COMPLETED");
  expect(done.history.map((h) => h.role)).toContain("Test Ary");
  expect(
    await readFile(join(dir, "repo", "src", "sample.ts"), "utf8"),
  ).toContain("value = 1");
  expect(
    (
      await exec("/usr/bin/git", ["rev-parse", "HEAD"], {
        cwd: join(dir, "repo"),
      })
    ).stdout.trim(),
  ).toBe(base);
  expect((await f.repo.list("outcomes")).length).toBeGreaterThan(10);
  expect(
    (await f.repo.list("actions"))
      .filter((a) => a.tool_name.startsWith("development."))
      .every((a) => a.metadata.simulated === false),
  ).toBe(true);
  for (
    let n = 0;
    n < 4 && (await f.engine.inspect(id)).mission?.state !== "COMPLETED";
    n++
  )
    await f.engine.tick(id);
  await request("development.unlock", { run_id: run.id });
  await request("development.unlock", { run_id: run.id });
}, 20000);
it("requires exact owner approval even under autonomous policy", async () => {
  const run = await planned();
  await f.actions.permissions.savePolicy({
    tool: "development.build",
    level: 5,
    reason: "Test mandatory approval",
  });
  await expect(
    request(
      "development.build",
      { run_id: run.id, plan_hash: run.plan_hash },
      false,
    ),
  ).rejects.toBeInstanceOf(ApprovalRequiredError);
  expect((await service.read(run.id)).run.mission_id).toBeUndefined();
});
it("rejects stage skipping and scope hash tampering", async () => {
  const run = await planned();
  await expect(
    request("development.build", { run_id: run.id, plan_hash: "0".repeat(64) }),
  ).rejects.toThrow(/scope/i);
  await expect(
    request("development.implement", {
      run_id: run.id,
      patch_hash: "0".repeat(64),
    }),
  ).rejects.toThrow(/stage/i);
});
it("denies core permission edits; marks memory and migration scope protected", async () => {
  await expect(planned(["src/services/permission-service.ts"])).rejects.toThrow(
    /human-led/,
  );
  expect(protectedPath("supabase/migrations/next.sql")).toBe(true);
  expect(protectedPath("src/services/memory-service.ts")).toBe(true);
  for (const path of [
    ".env.local",
    "src/services/action-service.ts",
    "src/infrastructure/development/runner.ts",
    "package.json",
    "PACKAGE.JSON",
    "agents.md",
    "scripts/deploy.ts",
  ])
    expect(forbiddenPath(path)).toBe(true);
  expect(sourcePath.safeParse("../escape").success).toBe(false);
});
it("requires a separate ADMIN-class protected build approval", async () => {
  const run = await planned(["src/services/memory-helper.ts"]);
  await expect(
    request("development.build", { run_id: run.id, plan_hash: run.plan_hash }),
  ).rejects.toThrow(/ADMIN/);
  expect(
    getToolDefinition("development.build_protected")?.permissionClasses,
  ).toContain("ADMIN");
});
it("blocks a patch that expands owner-approved scope", async () => {
  const run = await planned(),
    id = await start(run);
  await advance(id, "WORKSPACE");
  await expect(
    request("development.patch", {
      run_id: run.id,
      revision: (await service.read(run.id)).run.revision,
      changes: [{ path: "src/other.ts", before: null, content: "escape" }],
    }),
  ).rejects.toThrow(/scope/);
});
it("blocks overlapping repository runs and releases only known terminal reservations", async () => {
  const a = await planned(),
    b = await planned();
  await workspace.isolate(a, "a");
  await expect(workspace.isolate(b, "b")).rejects.toThrow(/reserved/);
  await expect(request("development.unlock", { run_id: a.id })).rejects.toThrow(
    /terminal/,
  );
  await workspace.releaseReservation(a);
  await expect(workspace.isolate(b, "b")).resolves.toHaveProperty("base", base);
});
it("replays a completed workspace receipt across executor restart without duplicating branches", async () => {
  const run = await planned(),
    first = await workspace.isolate(run, "a");
  attach();
  expect(await workspace.isolate(run, "a")).toEqual(first);
});
it("blocks uncertain filesystem effects after restart rather than retrying", async () => {
  const run = await planned();
  await workspace.isolate(run, "a");
  await writeFile(
    join(dir, "workspaces", run.id, "workspace.json"),
    JSON.stringify({ status: "started", input: run.plan_hash }),
  );
  attach();
  await expect(workspace.isolate(run, "b")).rejects.toThrow(/Uncertain/);
  await expect(workspace.releaseReservation(run)).rejects.toThrow(/Uncertain/);
});
it("cancels through the existing mission and never applies the patch", async () => {
  const { run, id } = await patched();
  const p = await f.engine.inspect(id);
  await f.engine.control(id, "cancel", p.revision);
  await f.engine.tick(id);
  expect((await service.inspect(run.id)).status).toBe("CANCELLED");
  expect(
    await readFile(
      join(dir, "workspaces", run.id, "worktree", "src/sample.ts"),
      "utf8",
    ),
  ).toContain("value = 1");
  expect(runner).not.toHaveBeenCalled();
});
it("failed tests block review and release without editing tests", async () => {
  runner.mockImplementationOnce(async (command) => ({
    command,
    exit_code: 1,
    signal: null,
    duration_ms: 2,
    output: "Real fixture failure",
    truncated: false,
  }));
  const { run, id } = await patched();
  const tested = await advance(id, "TEST");
  expect(tested.validation?.passed).toBe(false);
  await expect(advance(id, "RELEASE_CANDIDATE")).rejects.toThrow();
  expect(review).not.toHaveBeenCalled();
  expect((await service.read(run.id)).run.release).toBeUndefined();
});
it("keeps the author context out of independent review and rejects reviewer concerns", async () => {
  review.mockImplementationOnce(async () => ({
    content: JSON.stringify({
      summary: "Unsafe candidate fixture",
      checks: Object.fromEntries(
        reviewCategories.map((k) => [
          k,
          {
            verdict: k === "permission_weakening" ? "concern" : "pass",
            reason: "Independent assessment",
          },
        ]),
      ),
    }),
    model: "fixture",
    provider: "fixture",
    metrics: {
      input_tokens: 0,
      cached_input_tokens: 0,
      output_tokens: 0,
      latency_ms: 1,
      estimated_cost_usd: null,
      retrieval_count: 0,
      pricing_version: "fixture",
    },
  }));
  const { run, id } = await patched();
  const reviewed = await advance(id, "REVIEW");
  expect(reviewed.review?.ready).toBe(false);
  const call = review.mock.calls[0] as unknown as [
    { history: unknown[]; memories: unknown[] },
  ];
  expect(call[0].history).toEqual([]);
  expect(call[0].memories).toEqual([]);
  await expect(advance(id, "RELEASE_CANDIDATE")).rejects.toThrow();
  expect((await service.read(run.id)).run.release).toBeUndefined();
});
it("has no merge/push/deploy tool and cannot lower mandatory approvals", () => {
  const tools = f.tools
    .describe()
    .filter((t) => t.name.startsWith("development."));
  expect(tools.some((t) => /merge|push|deploy/.test(t.name))).toBe(false);
  for (const verb of [
    "build",
    "build_protected",
    "workspace",
    "implement",
    "test",
    "review",
    "release",
    "decide",
    "finalize",
  ])
    expect(
      getToolDefinition(`development.${verb}`)?.alwaysRequiresApproval,
    ).toBe(true);
});
it("rejects secret inspection and reads canonical source at an exact commit", async () => {
  await expect(workspace.source(base, [".env.local"])).rejects.toThrow(
    /Secret/,
  );
  expect(
    (await workspace.source(base, ["src/sample.ts"]))[0].content,
  ).toContain("value = 1");
});
it("enforces independent scratch snapshots for each validation command", async () => {
  const run = await planned();
  run.workspace = await workspace.isolate(run, "a");
  runner.mockImplementation(async (command: any, scratch?: string) => {
    const source = join(scratch!, "src/sample.ts");
    expect(await readFile(source, "utf8")).toContain("value = 1");
    await writeFile(source, "tampered validation copy");
    return {
      command,
      exit_code: 0,
      signal: null,
      duration_ms: 1,
      output: "fixture",
      truncated: false,
    };
  });
  await workspace.validate(run, "v");
  expect(runner).toHaveBeenCalledTimes(5);
  runner.mockImplementation(async (command) => ({
    command,
    exit_code: 0,
    signal: null,
    duration_ms: 2,
    output: "fixture command completed",
    truncated: false,
  }));
});
it("forbids rewriting existing tests even when their path was in scope", async () => {
  const run = await planned(["tests/baseline.test.ts"]);
  run.workspace = await workspace.isolate(run, "a");
  run.patch = {
    hash: "b".repeat(64),
    author: "fixture",
    action_id: randomUUID(),
    value: {
      run_id: run.id,
      revision: 2,
      changes: [
        {
          path: "tests/baseline.test.ts",
          before: contentHash("// Existing test must stay unchanged\n"),
          content: "// suppressed",
        },
      ],
    },
  };
  await expect(workspace.apply(run, "b")).rejects.toThrow(/immutable/);
});
it("allows existing agent profiles to propose but not claim owner execution authority", async () => {
  await expect(
    f.agents.create(
      {
        name: "Engineering observer",
        purpose: "Inspect and propose bounded fixes",
        specialization: "Developer Ary",
        capabilities: ["tools"],
        tool_access: ["development.source", "development.propose"],
        permission_level: 3,
      },
      randomUUID(),
    ),
  ).resolves.toHaveProperty("name", "Engineering observer");
  await expect(
    f.agents.create(
      {
        name: "Unsafe worker",
        purpose: "Attempt to gain build authority",
        specialization: "Developer Ary",
        capabilities: ["tools"],
        tool_access: ["development.build"],
        permission_level: 5,
      },
      randomUUID(),
    ),
  ).rejects.toThrow(/Unsupported/);
});
it.runIf(process.platform === "darwin")(
  "physically enforces deny-network/host-file/write-dependencies boundaries with macOS sandbox",
  async () => {
    const scratch = await realpath(dir),
      node = await realpath(process.execPath),
      deps = await realpath(join(dir, "deps"));
    const host = await mkdtemp(join(tmpdir(), "ary-private-proof-"));
    await writeFile(join(host, "secret"), "private proof");
    try {
      const alias =
        "/System/Volumes/Data" + (await realpath(join(host, "secret")));
      expect(await readFile(alias, "utf8")).toBe("private proof");
      const script = `const fs=require('fs');let passed=0;try{fs.readFileSync(${JSON.stringify(join(host, "secret"))});}catch{passed++;}try{fs.writeFileSync(${JSON.stringify(join(deps, "cannot-write"))},'x');}catch{passed++;}try{fs.readFileSync(${JSON.stringify(alias)});}catch{passed++;}try{process.kill(process.ppid,0);}catch{passed++;}fs.writeFileSync('allowed','ok');if(passed!==4)process.exit(7);const s=require('net').connect({host:'1.1.1.1',port:443});s.on('connect',()=>process.exit(8));s.on('error',()=>process.exit(0));setTimeout(()=>process.exit(9),2000);`;
      // Dependencies must be outside writable scratch in production and this probe.
      const externalDeps = await mkdtemp(join(tmpdir(), "ary-deps-proof-"));
      try {
        const adjusted = script.replace(
          JSON.stringify(join(deps, "cannot-write")),
          JSON.stringify(join(externalDeps, "cannot-write")),
        );
        await exec(
          "/usr/bin/sandbox-exec",
          [
            "-p",
            sandboxProfile(scratch, externalDeps, node.split("/bin/")[0]),
            node,
            "-e",
            adjusted,
          ],
          {
            cwd: scratch,
            timeout: 5000,
            env: {
              OPENSSL_CONF: "/dev/null",
              NODE_ENV: "test",
              PATH: "/usr/bin:/bin",
            },
          },
        );
      } finally {
        await rm(externalDeps, { recursive: true, force: true });
      }
    } finally {
      await rm(host, { recursive: true, force: true });
    }
  },
);

it.runIf(process.platform === "darwin")(
  "runs an actual fixed Vitest command in the sandbox",
  async () => {
    const scratch = join(await realpath(dir), "validation-focused"),
      deps = await realpath("node_modules");
    await mkdir(scratch);
    await mkdir(join(scratch, "tests"));
    await writeFile(
      join(scratch, "tests", "proof.test.ts"),
      'import {it,expect} from "vitest";it("actual assertion",()=>expect(2+2).toBe(4));',
    );
    const { symlink } = await import("node:fs/promises");
    await symlink(deps, join(scratch, "node_modules"));
    const result = await runSandboxed("focused", scratch, deps, [
      "tests/proof.test.ts",
    ]);
    expect(result.exit_code, result.output).toBe(0);
    expect(result.output).toContain("1 passed");
  },
  20000,
);
it("preserves canonical replay across service restart and never reapplies a completed patch", async () => {
  const { run, id } = await patched();
  attach();
  await advance(id, "IMPLEMENTATION");
  const action = (await f.repo.list("actions")).find(
    (a) =>
      a.tool_name === "development.implement" &&
      a.status === "succeeded" &&
      !a.metadata.replay_of,
  )!;
  const replay = await f.coordinator.requests.request(
    action.metadata.request_envelope,
  );
  expect(replay.action_id).toBe(action.id);
  expect(
    await readFile(
      join(dir, "workspaces", run.id, "worktree", "src/sample.ts"),
      "utf8",
    ),
  ).toContain("value = 2");
  expect(
    (await f.repo.list("actions")).filter(
      (a) =>
        a.tool_name === "development.implement" &&
        a.status === "succeeded" &&
        !a.metadata.replay_of,
    ),
  ).toHaveLength(1);
}, 15000);
it("rejects candidate drift after release packaging", async () => {
  const { run, id } = await patched();
  const ready = await advance(id, "RELEASE_CANDIDATE");
  await writeFile(
    join(dir, "workspaces", run.id, "worktree", "src/sample.ts"),
    "unexpected edit",
  );
  await expect(
    request("development.decide", {
      run_id: run.id,
      release_hash: ready.release!.hash,
      accept: true,
      reason: "Accept exact reviewed candidate",
    }),
  ).rejects.toThrow(/changed after release/);
}, 15000);
it("denies review by the patch author even with a valid mission lease", async () => {
  const { run, id } = await patched();
  const tested = await advance(id, "TEST");
  const row = (await f.repo.get("messages", id))!,
    token = randomUUID();
  await f.repo.update("messages", id, {
    metadata: {
      ...row.metadata,
      mission_lease: {
        token,
        until: new Date(Date.now() + 10000).toISOString(),
      },
    },
  });
  const { missionExecution } =
    await import("../src/services/mission-execution-context");
  await expect(
    missionExecution.run({ id, token }, () =>
      service.review(run.id, {
        userId: user,
        productIds: [],
        conversationId: conversation,
        actionId: randomUUID(),
        requestKey: randomUUID(),
        agentId: tested.patch!.author,
        stage: () => {},
      }),
    ),
  ).rejects.toThrow(/author cannot review/);
  expect(review).not.toHaveBeenCalled();
}, 15000);
it("aborts an in-flight validation command on durable mission cancellation", async () => {
  const { run, id } = await patched();
  await advance(id, "IMPLEMENTATION");
  let p = await f.engine.tick(id); // read-back verification
  for (let n = 0; n < 5 && p.mission?.state !== "APPROVAL_REQUIRED"; n++)
    p = await f.engine.tick(id);
  await f.actions.permissions.review(
    p.states.test.approval_action_id!,
    "approved",
    "Approve isolated validation",
  );
  await f.engine.control(id, "resume", p.revision);
  let started!: () => void;
  const running = new Promise<void>((r) => {
    started = r;
  });
  runner.mockImplementationOnce(
    async (
      command: any,
      scratch?: string,
      deps?: string,
      tests?: string[],
      signal?: AbortSignal,
    ) => {
      started();
      return new Promise((_, reject) => {
        signal!.addEventListener(
          "abort",
          () => reject(new Error("cancelled sandbox command")),
          { once: true },
        );
      });
    },
  );
  const execution = f.engine.tick(id);
  await running;
  const current = await f.engine.inspect(id);
  await f.engine.control(id, "cancel", current.revision);
  await execution;
  expect(runner).toHaveBeenCalledTimes(1);
  expect((await service.read(run.id)).run.validation).toBeUndefined();
  await expect(
    workspace.releaseReservation((await service.read(run.id)).run),
  ).rejects.toThrow(/Uncertain/);
}, 15000);
it("rejects shell syntax as invalid paths and blocks likely secrets before model review", async () => {
  for (const p of ["src/x;touch", "$(whoami)", "/tmp/escape", "src/../secret"])
    expect(sourcePath.safeParse(p).success).toBe(false);
  const run = await planned(),
    id = await start(run);
  await advance(id, "WORKSPACE");
  await expect(
    request("development.patch", {
      run_id: run.id,
      revision: (await service.read(run.id)).run.revision,
      changes: [
        {
          path: "src/sample.ts",
          before: contentHash("export const value = 1;\n"),
          content: 'const credential="sk-abcdefghijklmnopqrstuvwxyz";',
        },
      ],
    }),
  ).rejects.toThrow(/secret/);
});
it("records owner rejection without merging and completes the same mission", async () => {
  const { run, id } = await patched();
  const ready = await advance(id, "RELEASE_CANDIDATE");
  await request("development.decide", {
    run_id: run.id,
    release_hash: ready.release!.hash,
    accept: false,
    reason: "Owner rejects the release candidate",
  });
  await f.engine.submit(id, {
    id: randomUUID(),
    name: "owner_decision",
    payload: { decided: true },
  });
  await advance(id, "REJECTED");
  for (
    let n = 0;
    n < 4 && (await f.engine.inspect(id)).mission?.state !== "COMPLETED";
    n++
  )
    await f.engine.tick(id);
  expect((await f.engine.inspect(id)).mission?.state).toBe("COMPLETED");
  expect(
    (
      await exec("/usr/bin/git", ["rev-parse", "HEAD"], {
        cwd: join(dir, "repo"),
      })
    ).stdout.trim(),
  ).toBe(base);
}, 20000);
it("denied build permission creates an audit receipt without a workspace", async () => {
  const run = await planned();
  await f.actions.permissions.savePolicy({
    tool: "development.build",
    level: 0,
    reason: "Owner denies development",
  });
  await expect(
    request("development.build", { run_id: run.id, plan_hash: run.plan_hash }),
  ).rejects.toThrow();
  expect((await service.read(run.id)).run.mission_id).toBeUndefined();
  expect(
    (await f.repo.list("actions")).some(
      (a) => a.tool_name === "development.build" && a.status === "blocked",
    ),
  ).toBe(true);
});

it("rejects worktree branch substitution with main", async () => {
  const run = await planned();
  await workspace.isolate(run, "owner");
  await exec("/usr/bin/git", ["symbolic-ref", "HEAD", "refs/heads/main"], {
    cwd: join(dir, "workspaces", run.id, "worktree"),
  });
  await expect(workspace.inspect(run)).rejects.toThrow(/main/);
});
it("rejects a parent symlink before reading or creating outside the worktree", async () => {
  const { symlink, rename } = await import("node:fs/promises");
  const run = await planned();
  await workspace.isolate(run, "owner");
  const tree = join(dir, "workspaces", run.id, "worktree");
  await rename(join(tree, "src"), join(dir, "outside"));
  await symlink(join(dir, "outside"), join(tree, "src"));
  await expect(workspace.inspect(run)).rejects.toThrow(/link/);
  expect(await readFile(join(dir, "outside", "sample.ts"), "utf8")).toContain(
    "value = 1",
  );
});
it("rejects forged workspace ownership", async () => {
  const run = await planned();
  await workspace.isolate(run, "owner");
  await writeFile(
    join(dir, "workspaces", run.id, "ownership.json"),
    JSON.stringify({ run: run.id, owner: "someone-else" }),
  );
  await expect(workspace.inspect(run)).rejects.toThrow(/ownership/);
});
it("refuses cleanup with dirty tracked files and preserves them", async () => {
  const run = await planned();
  await workspace.isolate(run, "owner");
  run.phase = "COMPLETED";
  const file = join(dir, "workspaces", run.id, "worktree", "src/sample.ts");
  await writeFile(file, "user work");
  await expect(workspace.cleanup(run)).rejects.toThrow(/Dirty/);
  expect(await readFile(file, "utf8")).toBe("user work");
});
it("refuses cleanup for unknown ignored files", async () => {
  const run = await planned();
  await workspace.isolate(run, "owner");
  run.phase = "COMPLETED";
  const tree = join(dir, "workspaces", run.id, "worktree");
  await writeFile(join(tree, "unknown.txt"), "user work");
  await writeFile(
    join(dir, "repo", ".git", "info", "exclude"),
    "unknown.txt\n",
  );
  expect(
    (
      await exec("/usr/bin/git", ["status", "--porcelain"], { cwd: tree })
    ).stdout.trim(),
  ).toBe("");
  await expect(workspace.cleanup(run)).rejects.toThrow(/unknown/);
  expect(await readFile(join(tree, "unknown.txt"), "utf8")).toBe("user work");
});
it("requires completion and explicit approval for cleanup; keeps evidence and branch", async () => {
  const run = await planned();
  await workspace.isolate(run, "owner");
  await expect(workspace.cleanup(run)).rejects.toThrow(/completed/);
  expect(getToolDefinition("development.cleanup")?.alwaysRequiresApproval).toBe(
    true,
  );
  run.phase = "COMPLETED";
  expect(await workspace.cleanup(run)).toEqual({
    removed: true,
    branch_retained: true,
    evidence_retained: true,
  });
  expect(await workspace.cleanup(run)).toHaveProperty("removed", true);
  expect(
    (
      await exec("/usr/bin/git", ["branch", "--list", `ary/dev/${run.id}`], {
        cwd: join(dir, "repo"),
      })
    ).stdout,
  ).toContain(run.id);
  expect(
    await readFile(join(dir, "workspaces", run.id, "ownership.json"), "utf8"),
  ).toContain(run.id);
});
it("detects dependency and migration changes without elevated authority", async () => {
  const run = await planned();
  await workspace.isolate(run, "owner");
  const tree = join(dir, "workspaces", run.id, "worktree");
  await writeFile(join(tree, "package.json"), '{"dependencies":{"bad":"*"}}');
  await expect(workspace.inspect(run)).rejects.toThrow(/Dependency/);
  await rm(join(tree, "package.json"));
  await mkdir(join(tree, "supabase/migrations"), { recursive: true });
  await writeFile(
    join(tree, "supabase/migrations/unapproved.sql"),
    "select 1;",
  );
  await expect(workspace.inspect(run)).rejects.toThrow(/migration/);
});
it("bounds huge diffs and rejects secrets before returning model context", async () => {
  const run = await planned();
  await workspace.isolate(run, "owner");
  const file = join(dir, "workspaces", run.id, "worktree", "src/sample.ts");
  await writeFile(file, "x".repeat(97000));
  await expect(workspace.inspect(run)).rejects.toThrow(/review budget/);
  await writeFile(file, 'const api_key = "sk-abcdefghijklmnopqrstuvwxyz";');
  await expect(workspace.inspect(run)).rejects.toThrow(/secret/);
});
it("returns actual new-file content rather than the original patch proposal", async () => {
  const { run, id } = await patched();
  const current = await advance(id, "IMPLEMENTATION");
  const path = join(dir, "workspaces", run.id, "worktree", "tests/new.test.ts");
  await writeFile(path, "// actual changed evidence");
  const inspected = await workspace.inspect(current);
  expect(inspected.diff).toContain("actual changed evidence");
  expect(inspected.files).toContain("tests/new.test.ts");
});
it("records each command durably with its operation and candidate", async () => {
  const { run, id } = await patched();
  const current = await advance(id, "TEST");
  const receipt = JSON.parse(
    await readFile(
      join(dir, "workspaces", run.id, "command-focused.json"),
      "utf8",
    ),
  );
  expect(receipt.status).toBe("done");
  expect(receipt.candidate).toBe(current.workspace?.candidate);
  expect(receipt.timeout_ms).toBe(60000);
  expect(receipt.network).toBe("denied");
  expect(receipt.result.exit_code).toBe(0);
});
it.runIf(process.platform === "darwin")(
  "rejects command injection/chaining and focused path traversal",
  async () => {
    for (const command of [
      "bash",
      "test; touch /tmp/escaped",
      "npm install",
      "git push",
    ])
      await expect(runSandboxed(command as any, dir, dir, [])).rejects.toThrow(
        /allowlisted/,
      );
    for (const path of [
      "../escape",
      "tests/a.test.ts;echo",
      "--reporter=evil",
      "/tmp/a.test.ts",
    ])
      await expect(runSandboxed("focused", dir, dir, [path])).rejects.toThrow();
  },
);
it("requests a durable mission pause when scope drift is detected", async () => {
  const { run, id } = await patched();
  await writeFile(
    join(dir, "workspaces", run.id, "worktree", "unapproved.txt"),
    "unapproved change",
  );
  await expect(service.verify(run.id, "workspace")).rejects.toThrow(/scope/);
  expect((await f.engine.inspect(id)).mission?.state).toBe("PAUSED");
});
it.runIf(process.platform === "darwin")(
  "cancels a real running sandbox process and returns an exit receipt",
  async () => {
    const scratch = join(await realpath(dir), "validation-focused");
    const deps = await realpath("node_modules");
    await mkdir(join(scratch, "tests"), { recursive: true });
    await writeFile(
      join(scratch, "tests/wait.test.ts"),
      'import {it} from "vitest";it("wait",async()=>{await new Promise(()=>{});},60000);',
    );
    const { symlink } = await import("node:fs/promises");
    await symlink(deps, join(scratch, "node_modules"));
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 1500);
    try {
      const result = await runSandboxed(
        "focused",
        scratch,
        deps,
        ["tests/wait.test.ts"],
        abort.signal,
      );
      expect(result.termination).toBe("cancelled");
      expect(result.signal).toBeTruthy();
      expect(result.duration_ms).toBeLessThan(10000);
    } finally {
      clearTimeout(timer);
    }
  },
  15000,
);

it("rejects credential filenames before Git source inspection", async () => {
  for (const path of [
    ".npmrc",
    ".ssh/id_rsa",
    ".aws/credentials",
    "config/client.pem",
    "vault.json",
  ])
    await expect(workspace.source(base, [path])).rejects.toThrow(
      /Secret inspection/,
    );
});
