/** Disposable Skills UI/action/approval test. No physical hardware is contacted. */
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
import type { Entity, Task, Action, Outcome } from "../src/domain/models";
import type { ActionApproval } from "../src/domain/permissions";

async function main() {
  const root = process.cwd();
  const dir = await mkdtemp(join(tmpdir(), "ary-skills-e2e-"));
  const session = `skills-e2e-${process.pid}`;
  const cli = resolve("node_modules/.bin/agent-browser");
  const run = (...args: string[]) =>
    execFileSync(
      cli,
      ["--session", session, "--args", "--disable-gpu", ...args],
      {
        encoding: "utf8",
        timeout: 45000,
      },
    );
  const evaluate = (code: string) => JSON.parse(run("eval", code).trim());
  const wait = (condition: string) =>
    evaluate(
      `new Promise((resolve,reject)=>{const start=Date.now();const tick=()=>{if(${condition})resolve(true);else if(Date.now()-start>25000)reject(Error('Timed out: '+${JSON.stringify(condition)}));else setTimeout(tick,100)};tick()})`,
    );
  const click = (name: string) => {
    console.log(`Checking: ${name}`);
    run("snapshot", "-i");
    run("find", "role", "button", "click", "--name", name, "--exact");
  };
  let server: ReturnType<typeof spawn> | undefined;
  let serverLog = "";
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
    // Port 0 allocates a free localhost port. No .env files or production data are copied.
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
    server.stdout?.on("data", (b) => {
      serverLog += b;
    });
    server.stderr?.on("data", (b) => {
      serverLog += b;
    });
    const start = Date.now();
    while (!serverLog.includes("Ready in")) {
      if (server.exitCode !== null || Date.now() - start > 60000)
        throw Error(serverLog);
      await new Promise((r) => setTimeout(r, 100));
    }
    const url = serverLog.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
    assert.ok(url, serverLog);
    console.log(
      "Warming the isolated Next.js server before browser navigation.",
    );
    const warmed = await fetch(url, { signal: AbortSignal.timeout(180000) });
    assert.equal(warmed.status, 200);
    await warmed.text();
    // Consume both routes before UI timing assertions: streamed headers alone do not finish cold compilation.
    const dashboard = await fetch(url + "/api/dashboard", {
      signal: AbortSignal.timeout(180000),
    });
    assert.equal(dashboard.status, 200);
    await dashboard.json();
    console.log(
      "Cold page and API compilation completed; checking the browser.",
    );
    run("open", url);
    wait(`document.querySelector('[aria-label="Open Ary command palette"]')`);
    const navigate = (name: string) => {
      run("press", "Meta+k");
      run("find", "label", "Search Ary commands", "fill", name);
      run("press", "Enter");
    };
    navigate("Skills");
    wait(`document.querySelector('[aria-label="Skill workshop"] .react-flow')`);
    assert.equal(
      evaluate(
        `document.querySelectorAll('[aria-label="Example skills"] button').length`,
      ),
      6,
    );
    evaluate(
      `document.querySelector('[aria-label="Skill workflow graph"]').scrollIntoView({block:"center"});true`,
    );
    assert.ok(
      evaluate(
        `document.querySelector('.react-flow__controls-button svg').getBoundingClientRect().width`,
      ) > 0,
    );
    run("screenshot", "/tmp/ary-skills-builder.png");
    const persisted = JSON.parse(
      await readFile(join(dir, ".data/demo.json"), "utf8"),
    );
    const project = persisted.entities.find((e: Entity) =>
      ["company", "project", "product"].includes(e.entity_type),
    );
    assert.ok(project);
    const definition = {
      title: "Client onboarding acceptance",
      instructions:
        "Create the reviewed onboarding task and verify its actual stored status.",
      inputs: [],
      outputs: [
        {
          name: "task",
          step: "create",
          path: ["result", "task_id"],
          description: "Actual task ID",
        },
      ],
      success_criteria: ["Task is stored and its status is verified."],
      permissions: ["create_task", "task.inspect"],
      subskills: [],
      steps: [
        {
          id: "create",
          title: "Create client onboarding checklist",
          tool: "create_task",
          input: {
            title: "Skills acceptance onboarding checklist",
            priority: 3,
            project_id: project.id,
          },
          depends_on: [],
          critical: true,
          missing: [],
          source_action_from: null,
          repeat: 1,
          verification: {
            tool: "task.inspect",
            input: {
              task_id: { $from: "create", path: ["result", "task_id"] },
            },
            path: ["status"],
            equals: "pending",
            description: "Task exists",
          },
        },
      ],
    };
    evaluate(
      `Array.from(document.querySelectorAll('summary')).find(e=>e.textContent.includes('Structured workflow editor')).click();true`,
    );
    run("find", "label", "Workflow JSON", "fill", JSON.stringify(definition));
    click("Apply workflow edits");
    click("Save draft version");
    wait(`document.querySelector('[aria-label="Saved skill"]').value.length>0`);
    click("Review and approve version");
    wait(`document.querySelector('dialog[open]')`);
    click("Reject");
    wait(`!document.querySelector('dialog[open]')`);
    assert.equal(
      JSON.parse(await readFile(join(dir, ".data/demo.json"), "utf8")).tasks
        .length,
      persisted.tasks.length,
    );
    click("Review and approve version");
    wait(`document.querySelector('dialog[open]')`);
    click("Approve once and continue");
    wait(`document.body.innerText.includes('Reviewed · v1')`);
    // Editing a reviewed version makes the controls draft-only immediately.
    run("find", "label", "Skill title", "fill", "Edited onboarding acceptance");
    assert.equal(
      evaluate(
        `Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Create mission draft').disabled`,
      ),
      true,
    );
    run("find", "label", "Skill title", "fill", definition.title);
    click("Create mission draft");
    wait(`document.querySelector('[aria-label="Durable mission controls"]')`);
    click("Plan mission");
    wait(
      `document.querySelector('[aria-label="Durable mission controls"]').innerText.includes('PLANNING')`,
    );
    click("Process checkpoint");
    wait(
      `document.querySelector('[aria-label="Durable mission controls"]').innerText.includes('READY')`,
    );
    click("Start / resume mission");
    wait(
      `document.querySelector('[aria-label="Durable mission controls"]').innerText.includes('RUNNING')`,
    );
    click("Process checkpoint");
    wait(`document.body.innerText.includes('APPROVAL REQUIRED')`);
    click("Review exact approval");
    wait(`document.querySelector('dialog[open]')`);
    click("Approve once and continue");
    wait(
      `!document.querySelector('dialog[open]') && !document.querySelector('[aria-label="Ary execution plans"]').innerText.includes('Reviewing one exact step')`,
    );
    const beforeResume = evaluate(
      `document.querySelector('[aria-label="Durable mission controls"] [role="status"]').innerText`,
    );
    click("Start / resume mission");
    wait(
      `document.querySelector('[aria-label="Durable mission controls"] [role="status"]').innerText !== ${JSON.stringify(beforeResume)}`,
    );
    for (let n = 0; n < 5; n++) {
      if (
        evaluate(
          `document.querySelector('[aria-label="Durable mission controls"]').innerText.includes('COMPLETED')`,
        )
      )
        break;
      const before = evaluate(
        `document.querySelector('[aria-label="Durable mission controls"] [role="status"]').innerText`,
      );
      click("Process checkpoint");
      wait(
        `document.querySelector('[aria-label="Durable mission controls"] [role="status"]').innerText !== ${JSON.stringify(before)}`,
      );
      wait(
        `!Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Process checkpoint').disabled || document.querySelector('[aria-label="Durable mission controls"]').innerText.includes('COMPLETED')`,
      );
    }
    wait(
      `document.querySelector('[aria-label="Durable mission controls"]').innerText.includes('COMPLETED')`,
    );
    const after = JSON.parse(
      await readFile(join(dir, ".data/demo.json"), "utf8"),
    );
    const task = after.tasks.find(
      (t: Task) => t.title === "Skills acceptance onboarding checklist",
    );
    assert.ok(task);
    assert.ok(
      after.actions.some(
        (a: Action) =>
          a.tool_name === "create_task" && a.status === "succeeded",
      ),
    );
    assert.ok(after.outcomes.some((o: Outcome) => o.status === "success"));
    navigate("Automations");
    wait(`document.querySelector('[aria-label="Skill automations"]')`);
    const skill = after.messages.find(
      (m: { metadata: Record<string, unknown> }) => m.metadata.nexus_skill_v1,
    ).metadata.nexus_skill_v1;
    wait(
      `Array.from(document.querySelector('[aria-label="Saved skill"]').options).some(o=>o.value===${JSON.stringify(skill.id)})`,
    );
    evaluate(
      `document.querySelector('[aria-label="Saved skill"]').scrollIntoView({block:"center"});true`,
    );
    run("select", '[aria-label="Saved skill"]', skill.id);
    wait(
      `document.querySelector('[aria-label="Skill automations"]').innerText.includes('Reviewed · v1')`,
    );
    click("Save disabled trigger");
    wait(`document.body.innerText.includes('Disabled · manual')`);
    click("Review and enable");
    wait(`document.querySelector('dialog[open]')`);
    click("Approve once and continue");
    wait(`document.body.innerText.includes('Enabled · manual')`);
    click("Deliver trigger");
    wait(
      `document.querySelector('[aria-label="Durable mission controls"]')?.innerText.includes('DRAFT')`,
    );
    assert.equal(
      JSON.parse(
        await readFile(join(dir, ".data/demo.json"), "utf8"),
      ).tasks.filter((t: Task) => t.title === task.title).length,
      1,
    );
    navigate("Skills");
    wait(`document.querySelector('[aria-label="Skill workshop"] .react-flow')`);
    run("set", "media", "reduced-motion", "reduce");
    assert.equal(
      evaluate(
        `getComputedStyle(document.querySelector('[aria-label="Example skills"] button')).transitionDuration`,
      ),
      "0s",
    );
    evaluate(
      `document.querySelector('[aria-label="Skill workflow graph"]').scrollIntoView({block:"center"});true`,
    );
    run("screenshot", "/tmp/ary-skills-reduced.png");
    assert.equal(
      evaluate(
        `!!document.querySelector('[data-nextjs-dialog], .vite-error-overlay')`,
      ),
      false,
    );
    console.log(
      JSON.stringify({
        passed: 14,
        checks: [
          "Visible graph controls",
          "Skills navigation",
          "React Flow and six examples",
          "structured editing",
          "version persistence",
          "rejected version review",
          "approved exact version",
          "edits invalidate launch",
          "Mission Control navigation",
          "separate task approval",
          "actual task and outcome",
          "reviewed automation creates draft only",
          "reduced motion",
          "no framework overlays",
        ],
        providers: "isolated local storage, no model or external effects",
      }),
    );
  } catch (error) {
    await writeFile("/tmp/ary-skills-e2e-server.log", serverLog);
    try {
      run("screenshot", "/tmp/ary-skills-e2e-failure.png");
      console.error(run("snapshot"));
    } catch {}
    throw error;
  } finally {
    try {
      run("close");
    } catch {}
    if (server && server.exitCode === null) {
      const closed = once(server, "close");
      server.kill("SIGTERM");
      await closed;
    }
    await rm(dir, { recursive: true, force: true });
    console.log(
      "Disposable source, repository fixtures, server, and browser session cleaned up.",
    );
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
