/** Disposable real Next.js/UI acceptance of the UNCONFIGURED Hermes path. No cloud endpoint or credentials are used. */
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
  const dir = await mkdtemp(join(tmpdir(), "ary-hermes-e2e-"));
  const session = `hermes-e2e-${process.pid}`;
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
    const diagnostics = await (
      await fetch(url + "/api/workers/hermes/diagnostics")
    ).json();
    assert.equal(diagnostics.health.status, "unconfigured");
    assert.equal(diagnostics.health.endpointConfigured, false);
    assert.equal(diagnostics.health.credentialsConfigured, false);
    const beforeStore = JSON.parse(
      await readFile(join(dir, ".data/demo.json"), "utf8"),
    );
    navigate("Settings");
    wait(
      `document.body.innerText.includes('Hermes · subordinate cloud worker')`,
    );
    run(
      "find",
      "text",
      "Hermes · subordinate cloud worker",
      "click",
      "--exact",
    );
    click("Check connection");
    wait(`document.body.innerText.includes('Disconnected')`);
    click("Test Hermes Worker");
    wait(`document.body.innerText.includes('Approve once and continue')`);
    assert.equal(
      evaluate(
        `document.body.innerText.includes('Return a short diagnostic confirming you received this delegated job.')`,
      ),
      true,
    );
    click("Approve once and continue");
    wait(
      `document.body.innerText.includes('Configure the server-side Hermes environment variables')`,
    );
    click("Check connection");
    wait(`document.body.innerText.includes('diagnostic · FAILED')`);
    const final = await (
      await fetch(url + "/api/workers/hermes/diagnostics")
    ).json();
    assert.equal(final.jobs.length, 1);
    assert.equal(final.jobs[0].status, "FAILED");
    const store = JSON.parse(
      await readFile(join(dir, ".data/demo.json"), "utf8"),
    );
    assert.ok(
      store.actions.some(
        (a: Action) =>
          a.tool_name === "worker.submit" && a.status === "approval_required",
      ),
    );
    assert.ok(
      store.actions.some(
        (a: Action) => a.tool_name === "worker.submit" && a.status === "failed",
      ),
    );
    assert.ok(
      store.action_approvals.some(
        (a: ActionApproval) => a.decision === "approved",
      ),
    );
    assert.deepEqual(store.tasks, beforeStore.tasks);
    const outcome = {
      checked_at: new Date().toISOString(),
      mode: "isolated-unconfigured-browser",
      checks: 12,
      passed: true,
      live_connection: false,
      side_effects:
        "No cloud credentials/endpoint provided; no outbound provider request possible",
      cleanup: "fixture removed in finally",
    };
    await writeFile(
      "/tmp/hermes-browser-result.json",
      JSON.stringify(outcome, null, 2),
    );
    console.log(JSON.stringify(outcome));
  } finally {
    try {
      run("close");
    } catch {}
    if (server && server.exitCode === null) {
      server.kill("SIGTERM");
      await once(server, "exit").catch(() => {});
    }
    await rm(dir, { recursive: true, force: true });
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
