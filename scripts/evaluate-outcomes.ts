/** Disposable Outcomes UI/action/approval test. No physical hardware is contacted. */
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
  const dir = await mkdtemp(join(tmpdir(), "ary-outcomes-e2e-"));
  const session = `outcomes-e2e-${process.pid}`;
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
    const post = async (path: string, body: unknown) => {
      const response = await fetch(`${url}/api/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: url },
        body: JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    };
    const execute = async (tool: string, input: Record<string, unknown>) => {
      const payload = {
        tool,
        input,
        request_key: crypto.randomUUID(),
        reason: "Isolated Outcome Engine acceptance",
      };
      let response = await post("actions/request", payload);
      assert.equal(
        response.body.code,
        "approval_required",
        JSON.stringify(response),
      );
      const review = await post(
        `permissions/attempts/${response.body.action_id}/review`,
        {
          decision: "approved",
          reason: "Approve this isolated fixture action",
        },
      );
      assert.ok(review.status < 300);
      response = await post("actions/request", payload);
      return response;
    };
    const initial = JSON.parse(
      await readFile(join(dir, ".data/demo.json"), "utf8"),
    );
    const project = initial.entities.find((e: Entity) =>
      ["project", "company", "product"].includes(e.entity_type),
    );
    assert.ok(project);
    const created = await execute("create_task", {
      project_id: project.id,
      title: "Verify outcome learning acceptance",
      priority: 3,
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    for (let n = 0; n < 3; n++) {
      const failed = await execute("mock.execute", {
        message: `Outcome acceptance run ${n}`,
        simulate_failure: true,
      });
      assert.equal(failed.status, 422);
    }
    const readReport = async () => {
      const response = await fetch(`${url}/api/outcome-engine`);
      assert.equal(response.status, 200);
      return response.json();
    };
    const baseline = await readReport();
    const failed = baseline.rows.filter(
      (r: any) => r.tool === "mock.execute" && r.action.status === "failed",
    );
    assert.equal(failed.length, 3);
    const task = baseline.rows.find(
      (r: any) => r.tool === "create_task" && r.action.status === "succeeded",
    );
    assert.ok(task);
    navigate("Economics");
    wait(`document.querySelector('[aria-label="Economics perspective"]')`);
    click("Outcome learning");
    wait(`document.querySelector('[aria-label="Recorded outcomes"] input')`);
    // Open the actual task outcome, inspect and approve an explicit user assessment.
    evaluate(
      `document.querySelector('[aria-label="Compare ${task.outcome.id}"]').parentElement.querySelector('button').click();true`,
    );
    wait(`document.querySelector('[aria-label="Assess outcome"]')`);
    evaluate(
      `document.querySelector('[aria-label="Assess outcome"]').scrollIntoView({block:'center'});true`,
    );
    run(
      "find",
      "label",
      "Observed result",
      "fill",
      "The requested task exists with the intended priority.",
    );
    run("select", '[name="achievement"]', "success");
    run(
      "find",
      "label",
      "User correction",
      "fill",
      "Require a task ID in the confirmation.",
    );
    click("Review assessment");
    wait(`document.querySelector('dialog[open]')`);
    click("Reject");
    wait(`!document.querySelector('dialog[open]')`);
    assert.equal(
      (await readReport()).rows.find(
        (r: any) => r.outcome.id === task.outcome.id,
      ).learning.assessments.length,
      0,
    );
    click("Review assessment");
    wait(`document.querySelector('dialog[open]')`);
    click("Approve once and continue");
    wait(
      `document.querySelector('[aria-label="Assess outcome"]')?.innerText.includes('Revision 1')`,
    );
    for (const row of failed) {
      evaluate(
        `document.querySelector('[aria-label="Compare ${row.outcome.id}"]').scrollIntoView({block:'center'});true`,
      );
      run("check", `[aria-label="Compare ${row.outcome.id}"]`);
    }
    wait(
      `document.querySelectorAll('[aria-label="Selected outcome comparison"] article').length===3`,
    );
    evaluate(
      `document.querySelector('[aria-label="Outcome comparison"]').scrollIntoView({block:'start'});true`,
    );
    click("Find repeated lessons");
    wait(`document.querySelector('[aria-label="Learned recommendations"] h4')`);
    evaluate(
      `document.querySelector('[aria-label="Learned recommendations"]').scrollIntoView({block:'center'});true`,
    );
    run(
      "find",
      "label",
      "Review reason",
      "fill",
      "Test this verification practice on the next controlled run.",
    );
    click("Review recommendation");
    wait(`document.querySelector('dialog[open]')`);
    click("Approve once and continue");
    wait(
      `Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Withdraw recommendation')`,
    );
    let report = await readReport();
    assert.equal(report.recommendations[0].active, true);
    run(
      "find",
      "label",
      "Review reason",
      "fill",
      "Withdrawing the experiment; no core behavior was changed.",
    );
    click("Withdraw recommendation");
    wait(`document.querySelector('dialog[open]')`);
    click("Approve once and continue");
    wait(
      `document.querySelector('[aria-label="Learned recommendations"]')?.innerText.includes('WITHDRAWN')`,
    );
    report = await readReport();
    assert.equal(report.recommendations[0].active, false);
    assert.deepEqual(
      report.recommendations[0].history.map((h: any) => h.state),
      ["proposed", "accepted", "withdrawn"],
    );
    const persisted = JSON.parse(
      await readFile(join(dir, ".data/demo.json"), "utf8"),
    );
    assert.ok(
      persisted.tasks.some(
        (t: Task) => t.title === "Verify outcome learning acceptance",
      ),
    );
    assert.equal(
      persisted.actions.filter(
        (a: Action) =>
          a.tool_name === "outcome.review" && a.status === "succeeded",
      ).length,
      2,
    );
    evaluate(
      `document.querySelector('[aria-label="Selected outcome comparison"]').scrollIntoView({block:'center'});true`,
    );
    run("screenshot", "/tmp/ary-outcomes-comparison.png");
    run("set", "media", "reduced-motion", "reduce");
    assert.equal(
      evaluate(`matchMedia('(prefers-reduced-motion: reduce)').matches`),
      true,
    );
    assert.equal(
      evaluate(
        `getComputedStyle(document.querySelector('[aria-label="Selected outcome comparison"] article')).animationName`,
      ),
      "none",
    );
    run("screenshot", "/tmp/ary-outcomes-reduced.png");
    assert.equal(
      evaluate(
        `!!document.querySelector('[data-nextjs-dialog],.vite-error-overlay')`,
      ),
      false,
    );
    console.log(
      JSON.stringify({
        passed: 12,
        checks: [
          "real internal task receipt",
          "three audited mock failures",
          "Economics navigation",
          "assessment rejection",
          "assessment approval",
          "three-way comparison",
          "repeated evidence proposal",
          "explicit acceptance",
          "reversible withdrawal",
          "audit history",
          "reduced motion",
          "no framework overlay",
        ],
        providers: "isolated local/mock; no external effects",
      }),
    );
  } catch (error) {
    await writeFile("/tmp/ary-outcomes-e2e-server.log", serverLog);
    try {
      run("screenshot", "/tmp/ary-outcomes-e2e-failure.png");
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
