/** Isolated browser acceptance. Real internal task/storage path; no external effects or provider calls. */
import { execFileSync, spawn } from "node:child_process";
import {
  cp,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { once } from "node:events";
import assert from "node:assert/strict";
import type { ExecutionPlan } from "../src/domain/orchestration";
async function main() {
  const root = process.cwd(),
    dir = await mkdtemp(join(tmpdir(), "ary-orchestrator-e2e-")),
    session = `orchestrator-${process.pid}`,
    cli = resolve("node_modules/.bin/agent-browser");
  const run = (...args: string[]) =>
    execFileSync(cli, ["--session", session, ...args], {
      encoding: "utf8",
      timeout: 45000,
    });
  const evaluate = (code: string) => JSON.parse(run("eval", code).trim());
  const wait = (condition: string) =>
    evaluate(
      `new Promise((resolve,reject)=>{const started=Date.now();const tick=()=>{if(${condition})resolve(true);else if(Date.now()-started>30000)reject(Error('Timed out: '+${JSON.stringify(condition)}));else setTimeout(tick,100)};tick()})`,
    );
  const click = (name: string) => {
    evaluate(
      `([...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(name)}))?.scrollIntoView({block:'center'})`,
    );
    run("find", "role", "button", "click", "--name", name, "--exact");
  };
  let server: ReturnType<typeof spawn> | undefined;
  let log = "";
  try {
    for (const file of [
      "src",
      "public",
      "package.json",
      "tsconfig.json",
      "next-env.d.ts",
    ])
      await cp(join(root, file), join(dir, file), { recursive: true });
    await symlink(join(root, "node_modules"), join(dir, "node_modules"));
    server = spawn(
      process.execPath,
      [
        join(root, "node_modules/next/dist/bin/next"),
        "dev",
        "--webpack",
        "--hostname",
        "127.0.0.1",
        "--port",
        "0",
      ],
      {
        cwd: dir,
        env: {
          PATH: process.env.PATH,
          TMPDIR: process.env.TMPDIR,
          NODE_ENV: "development",
          ARY_STORAGE: "demo",
          ARY_LLM_PROVIDER: "mock",
          ARY_EMBEDDING_PROVIDER: "local",
          ARY_REFLECTION_ENABLED: "false",
          NEXT_TELEMETRY_DISABLED: "1",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    server.stdout?.on("data", (b) => (log += b));
    server.stderr?.on("data", (b) => (log += b));
    const start = Date.now();
    while (!log.includes("Ready in")) {
      if (server.exitCode !== null || Date.now() - start > 60000)
        throw Error(log);
      await new Promise((r) => setTimeout(r, 100));
    }
    const url = log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
    assert.ok(url);
    assert.equal(
      (await fetch(url, { signal: AbortSignal.timeout(60000) })).status,
      200,
    );
    run("open", url);
    run("set", "viewport", "1440", "1100");
    wait(`document.querySelector('[aria-label="Open Ary command palette"]')`);
    run("press", "Meta+k");
    run("find", "label", "Search Ary commands", "fill", "Execution Plans");
    run("press", "Enter");
    wait(`document.querySelector('[aria-label="Ary execution plans"]')`);
    const read = async () =>
      JSON.parse(await readFile(join(dir, ".data/demo.json"), "utf8"));
    const project = (await read()).entities.find(
      (e: { name: string }) => e.name === "Wag Trails",
    );
    assert.ok(project);
    const spec = {
      title: "Prepare fixture edit",
      questions: [],
      steps: [
        {
          id: "task",
          title: "Create editing task",
          tool: "create_task",
          input: {
            title: "Finish fixture interview edit",
            project_id: project.id,
            priority: 3,
          },
          depends_on: [],
          critical: true,
          missing: [],
          source_action_from: null,
          verification: {
            tool: "task.inspect",
            input: { task_id: { $from: "task", path: ["result", "task_id"] } },
            path: ["status"],
            equals: "pending",
            description: "Created task is pending",
          },
        },
        {
          id: "inspect",
          title: "Inspect task after verification",
          tool: "task.inspect",
          input: { task_id: { $from: "task", path: ["result", "task_id"] } },
          depends_on: ["task"],
          critical: false,
          missing: [],
          source_action_from: null,
          verification: null,
        },
      ],
    };
    run(
      "find",
      "label",
      "Goal",
      "fill",
      "Create a high priority task for the Wag Trails interview edit, then verify it exists.",
    );
    run("click", '[aria-label="Ary execution plans"] > details > summary');
    run("find", "label", "Structured plan JSON", "fill", JSON.stringify(spec));
    click("Build execution plan");
    wait(`document.querySelector('[aria-label="Execution summary"]')`);
    const planRecord = (await read()).messages.find(
      (m: { metadata: { orchestrator_version?: string } }) =>
        m.metadata.orchestrator_version === "orchestrator-v1",
    );
    assert.ok(planRecord);
    evaluate(
      `([...document.querySelectorAll('summary')].find(s=>s.textContent.includes('Revise this plan'))).parentElement.open=true`,
    );
    click("Load current plan for revision");
    const revised = structuredClone(spec);
    revised.steps[1].title = "Inspect the verified task";
    run("find", "label", "Revised plan JSON", "fill", JSON.stringify(revised));
    run(
      "find",
      "label",
      "Why this revision",
      "fill",
      "Clarify the final read-back step",
    );
    click("Save visible revision");
    wait(`document.body.innerText.includes('Plan revision evidence (1)')`);
    const revisedRecord = (await read()).messages.find(
      (m: { id: string }) => m.id === planRecord.id,
    );
    assert.equal(revisedRecord.metadata.plan.replan_history.length, 1);
    assert.equal(revisedRecord.metadata.plan.status, "paused");
    click("Run / resume plan");
    wait(`document.querySelector('[data-state="waiting_approval"]')`);
    assert.equal(
      (await read()).tasks.filter(
        (t: { title: string }) => t.title === "Finish fixture interview edit",
      ).length,
      0,
    );
    click("Review step approval");
    wait(`document.querySelector('dialog[open]')`);
    click("Approve once and continue");
    wait(
      `!document.querySelector('dialog[open]') && !document.querySelector('[data-state="waiting_approval"]')`,
    );
    wait(
      `!document.querySelector('[aria-label="Ary execution plans"] [role="status"]')`,
    );
    click("Run / resume plan");
    wait(`document.querySelectorAll('[data-state="verified"]').length===2`);
    wait(
      `!document.querySelector('[aria-label="Ary execution plans"] [role="status"]')`,
    );
    const data = await read();
    const plan = data.messages.find(
      (m: { id: string }) => m.id === planRecord.id,
    ).metadata.plan as ExecutionPlan;
    assert.equal(plan.status, "complete");
    assert.equal(
      data.tasks.filter(
        (t: { title: string }) => t.title === "Finish fixture interview edit",
      ).length,
      1,
    );
    assert.ok(plan.states.task.action_id);
    assert.ok(plan.states.task.verification_action_id);
    const taskAction = data.actions.find(
      (a: { id: string }) => a.id === plan.states.task.action_id,
    );
    assert.equal(taskAction.metadata.requesting_agent, "ary_orchestrator");
    assert.equal(
      data.outcomes.find(
        (o: { action_id: string }) => o.action_id === taskAction.id,
      ).status,
      "success",
    );
    const replay = await fetch(url + "/api/actions/request", {
      method: "POST",
      headers: { "content-type": "application/json", origin: url },
      body: JSON.stringify(taskAction.input.action_request),
    });
    assert.equal(replay.status, 201);
    assert.equal(
      (await read()).tasks.filter(
        (t: { title: string }) => t.title === "Finish fixture interview edit",
      ).length,
      1,
    );
    click("Review and save outcome memory");
    wait(`document.querySelector('dialog[open]')`);
    click("Approve once and continue");
    wait(
      `!document.querySelector('dialog[open]') && !document.querySelector('[aria-label="Ary execution plans"] [role="status"]')`,
    );
    assert.equal(
      (await read()).memories.filter(
        (m: { metadata: { orchestrator_plan_id?: string } }) =>
          m.metadata.orchestrator_plan_id === plan.id,
      ).length,
      1,
    );
    run("screenshot", "/tmp/ary-orchestrator-e2e.png");
    console.log(
      JSON.stringify({
        passed: 12,
        checks: [
          "Execution Plans navigation",
          "reviewed structured plan",
          "visible in-place plan revision",
          "revision preserves ID and pauses effects",
          "per-step approval",
          "no pre-approval task",
          "real internal task",
          "read-back verification",
          "dependency order",
          "action/outcome agent attribution",
          "idempotent task replay",
          "reviewed central outcome memory",
        ],
        storage: "temporary LocalRepository",
        model: "no model call; owner-authored structured plan",
        external_effects: 0,
      }),
    );
  } catch (e) {
    await writeFile("/tmp/ary-orchestrator-e2e-server.log", log);
    try {
      run("screenshot", "/tmp/ary-orchestrator-e2e-failure.png");
      console.error(run("snapshot"));
    } catch {}
    throw e;
  } finally {
    try {
      run("close");
    } catch {}
    if (server && server.exitCode === null) {
      server.kill("SIGTERM");
      await Promise.race([
        once(server, "exit"),
        new Promise((r) => setTimeout(r, 3000)),
      ]);
    }
    await rm(dir, { recursive: true, force: true });
    console.log("Temporary app, tasks, memory and browser fixtures removed.");
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
