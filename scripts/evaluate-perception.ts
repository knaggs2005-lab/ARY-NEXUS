import { perceptionFixture } from "./perception-fixtures";
/** Disposable Perception UI/action/approval test. Uploaded synthetic fixtures only. */
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
import type { Action } from "../src/domain/models";

async function main() {
  const root = process.cwd();
  const dir = await mkdtemp(join(tmpdir(), "ary-perception-e2e-"));
  const session = `perception-e2e-${process.pid}`;
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
    const contextPath = join(dir, "src/server/context.ts");
    const before = join(dir, "before.png"),
      after = join(dir, "after.png");
    await writeFile(before, await perceptionFixture(false));
    await writeFile(after, await perceptionFixture(true));
    await writeFile(
      join(dir, "src/infrastructure/perception/fixture.ts"),
      `
import {PerceptionService} from "../../services/perception-service";
import {perceptionFrames} from "./frame-store";
import {writeFile,readFile} from "node:fs/promises";
export function fixturePerception(repo,actions){return new PerceptionService(repo,actions,{model:"fixture-vision",async analyze(){let n=0;try{n=Number(await readFile(".data/perception-count","utf8"));}catch{}await writeFile(".data/perception-count",String(n+1));return {provider:"fixture",model:"fixture-vision",latency_ms:2,finding:{summary:"Export dialog appeared",observations:[{frame:2,evidence:"Export Media title is visible"}],differences:["Frame 2 adds an export dialog"],verification:{verdict:"supported",reason:"Dialog title is readable",confidence:.8},limitations:["This does not prove an export completed."]}};}},perceptionFrames);}
`,
    );
    let source = await readFile(contextPath, "utf8");
    const a = source.indexOf("  const perception = new PerceptionService("),
      b = source.indexOf("  const actionTools =", a);
    assert.ok(a >= 0 && b > a);
    source =
      source.slice(0, a) +
      "  const perception = fixturePerception(repository,actions);\n" +
      source.slice(b);
    await writeFile(
      contextPath,
      'import {fixturePerception} from "../infrastructure/perception/fixture";\n' +
        source,
    );
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
    const warmed = await fetch(url, { signal: AbortSignal.timeout(60000) });
    assert.equal(warmed.status, 200);
    run("open", url);
    run("set", "viewport", "1440", "1000");
    wait(`document.querySelector('[aria-label="Open Ary command palette"]')`);
    run("press", "Meta+k");
    run("find", "label", "Search Ary commands", "fill", "Perception");
    run("press", "Enter");
    wait(`document.querySelector('[aria-label="Ary Perception"]')`);
    click("Authorize one image");
    wait(`document.querySelector('dialog[open]')`);
    click("Reject");
    wait(`!document.querySelector('dialog[open]')`);
    assert.ok(evaluate(`!document.querySelector('input[type="file"]')`));
    for (const [index, file] of [before, after].entries()) {
      click("Authorize one image");
      wait(`document.querySelector('dialog[open]')`);
      click("Approve once and continue");
      wait(`document.querySelector('input[type="file"]')`);
      run("upload", 'input[type="file"]', file);
      wait(`document.querySelectorAll('figure img').length===${index + 1}`);
    }
    run("select", '[aria-label="Ary Perception"] > label select', "compare");
    assert.equal(
      evaluate(
        `document.querySelector('[aria-label="Ary Perception"] > label select').value`,
      ),
      "compare",
    );
    run(
      "find",
      "label",
      "Question or visible success criterion",
      "fill",
      "Did the Export Media dialog appear? Do not infer completed export.",
    );
    click("Review and analyze images");
    wait(`document.querySelector('dialog[open]')`);
    click("Approve once and continue");
    wait(`document.querySelector('[aria-label="Visual evidence report"]')`);
    wait(`document.querySelectorAll('figure img').length===0`);
    assert.ok(
      evaluate(
        `document.body.innerText.includes('does not prove an export completed')`,
      ),
    );
    const persisted = JSON.parse(
      await readFile(join(dir, ".data/demo.json"), "utf8"),
    );
    const action = persisted.actions.find(
      (a: Action) =>
        a.tool_name === "perception.analyze" && a.status === "succeeded",
    );
    assert.ok(action);
    assert.equal(action.input.mode, "compare");
    assert.equal(action.output.result.images_retained, false);
    assert.ok(!JSON.stringify(persisted.actions).includes("data:image"));
    const replay = await fetch(url + "/api/actions/request", {
      method: "POST",
      headers: { "content-type": "application/json", origin: url },
      body: JSON.stringify(action.input.action_request),
    });
    assert.equal(replay.status, 201);
    assert.equal(
      await readFile(join(dir, ".data/perception-count"), "utf8"),
      "1",
    );
    run("screenshot", "/tmp/ary-perception-e2e.png");
    console.log(
      JSON.stringify({
        passed: 8,
        checks: [
          "Perception navigation",
          "source rejection",
          "approved source upload",
          "before/after previews",
          "separate analysis approval",
          "preview cleanup",
          "image-free audit",
          "idempotent model replay",
        ],
        provider: "fixture only",
        capture: "synthetic uploaded files only",
      }),
    );
  } catch (error) {
    await writeFile("/tmp/ary-perception-e2e-server.log", serverLog);
    try {
      run("screenshot", "/tmp/ary-perception-e2e-failure.png");
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
