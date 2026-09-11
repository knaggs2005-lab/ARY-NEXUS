/** Real browser → HTTP → approval → repository flow in a disposable, credential-free demo server. */
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
  const dir = await mkdtemp(join(tmpdir(), "ary-palette-e2e-"));
  const session = `palette-e2e-${process.pid}`;
  const cli = resolve("node_modules/.bin/agent-browser");
  const run = (...args: string[]) =>
    execFileSync(cli, ["--session", session, ...args], {
      encoding: "utf8",
      timeout: 45000,
    });
  const evaluate = (code: string) => JSON.parse(run("eval", code).trim());
  const wait = (condition: string) =>
    evaluate(
      `new Promise((resolve,reject)=>{const start=Date.now();const tick=()=>{if(${condition})resolve(true);else if(Date.now()-start>25000)reject(Error('Timed out: '+${JSON.stringify(condition)}));else setTimeout(tick,100)};tick()})`,
    );
  const click = (name: string) => {
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
    run("open", url);
    run("snapshot", "-i");
    assert.equal(
      evaluate(
        `!!document.body.innerText.trim()&&!document.querySelector('[data-nextjs-dialog]')`,
      ),
      true,
    );
    const state = async () =>
      JSON.parse(await readFile(join(dir, ".data/demo.json"), "utf8")) as {
        entities: Entity[];
        tasks: Task[];
        actions: Action[];
        outcomes: Outcome[];
        action_approvals: ActionApproval[];
      };
    wait(`document.querySelector('[aria-label="Open Ary command palette"]')`);
    // The native shell is now the default; the preserved orbit is an explicit destination.
    click("System");
    click("Open spatial navigation");
    assert.equal(
      evaluate(
        `document.querySelector('[aria-label="Existing Ary workspace"]').hidden`,
      ),
      true,
    );
    run("press", "Meta+k");
    wait(
      `document.querySelector('dialog[aria-label="Ary command palette"][open]')`,
    );
    assert.equal(
      evaluate(`document.activeElement.getAttribute('aria-label')`),
      "Search Ary commands",
    );
    assert.equal(
      evaluate(
        `document.querySelector('dialog[aria-label="Ary command palette"]').parentElement===document.body`,
      ),
      true,
    );
    run("find", "label", "Search Ary commands", "fill", "Projects");
    run("press", "Enter");
    wait(
      `!document.querySelector('[aria-label="Existing Ary workspace"]').hidden`,
    );
    assert.equal(
      evaluate(
        `document.querySelector('dialog[aria-label="Ary command palette"]').open`,
      ),
      false,
    );
    const project = (await state()).entities.find(
      (e) => e.entity_type === "project",
    );
    assert.ok(project);
    run("press", "Meta+k");
    run("find", "label", "Search Ary commands", "fill", project.name);
    run("press", "Enter");
    wait(
      `document.activeElement.id===${JSON.stringify("entity-" + project.id)}`,
    );
    run("press", "Meta+k");
    run("find", "label", "Search Ary commands", "fill", "create task");
    wait(
      `document.querySelector('[role="option"]')?.textContent.includes('create task')`,
    );
    // Mouse chooses the same dispatcher, without submitting anything.
    run("snapshot", "-i");
    evaluate(
      `Array.from(document.querySelectorAll('[role="option"]')).find(e=>e.querySelector('strong')?.textContent==='create task').click();true`,
    );
    wait(
      `Array.from(document.querySelectorAll('select')).some(e=>e.value==='create_task')`,
    );
    const before = (await state()).tasks.length;
    run(
      "find",
      "label",
      "Inputs (JSON)",
      "fill",
      JSON.stringify({
        title: "Palette acceptance task",
        project_id: project.id,
        priority: 2,
      }),
    );
    click("Submit action request");
    wait(
      `Array.from(document.querySelectorAll('summary')).some(s=>s.textContent.includes('create_task')&&s.textContent.includes('approval_required'))`,
    );
    evaluate(
      `Array.from(document.querySelectorAll('summary')).find(s=>s.textContent.includes('create_task')&&s.textContent.includes('approval_required')).click();true`,
    );
    assert.equal((await state()).tasks.length, before);
    click("Approve and run");
    wait(`document.body.innerText.includes('Approved action completed.')`);
    const created = (await state()).tasks.find(
      (t) => t.title === "Palette acceptance task",
    );
    assert.ok(created);
    run("press", "Meta+k");
    run(
      "find",
      "label",
      "Search Ary commands",
      "fill",
      "Palette acceptance task",
    );
    wait(
      `document.querySelector('[role="option"]')?.textContent.includes('Palette acceptance task')`,
    );
    run("press", "Enter");
    wait(`document.activeElement.id===${JSON.stringify("task-" + created.id)}`);
    run("press", "Meta+k");
    run(
      "find",
      "label",
      "Search Ary commands",
      "fill",
      "unmatched quasar test",
    );
    assert.equal(
      evaluate(`document.querySelectorAll('[role="option"]').length`),
      0,
    );
    assert.equal(
      evaluate(
        `document.querySelector('dialog[open]').textContent.includes('Search Ary memory for')`,
      ),
      true,
    );
    run("press", "Escape");
    assert.equal(evaluate(`!!document.querySelector('dialog[open]')`), false);
    run("set", "media", "reduced-motion");
    run("press", "Meta+k");
    run("find", "label", "Search Ary commands", "fill", "http://example.com");
    assert.equal(
      evaluate(
        `document.querySelector('[role="option"]')?.textContent.includes('website')`,
      ),
      true,
    );
    // Do not execute a website or enable the bridge in an isolated web session.
    run("screenshot", "/tmp/ary-palette-e2e.png");
    run("press", "Escape");
    const final = await state();
    const action = final.actions.find(
      (a) => a.tool_name === "create_task" && a.status === "succeeded",
    );
    assert.ok(action);
    assert.ok(final.outcomes.some((o) => o.action_id === action.id));
    assert.ok(
      final.action_approvals.some(
        (a) =>
          a.id === action.metadata.approval_id &&
          a.decision === "approved" &&
          !!a.consumed_at,
      ),
    );
    assert.equal(run("errors").trim(), "");
    console.log(
      JSON.stringify(
        {
          passed: true,
          apiMocked: false,
          storage: "disposable LocalRepository",
          checks: [
            "portal outside hidden HUD",
            "keyboard and mouse",
            "canonical project focus",
            "action form selection",
            "approval before real task creation",
            "task focus after refresh",
            "audit and outcome",
            "irrelevant suppression and semantic fallback entry",
            "website source tag",
            "Escape and reduced motion",
            "no browser errors",
          ],
        },
        null,
        2,
      ),
    );
  } catch (error) {
    await writeFile("/tmp/ary-palette-e2e-server.log", serverLog);
    try {
      run("screenshot", "/tmp/ary-palette-e2e-failure.png");
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
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
