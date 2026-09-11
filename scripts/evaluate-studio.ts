/** Disposable Studio UI/action/approval test. No physical hardware is contacted. */
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
  const dir = await mkdtemp(join(tmpdir(), "ary-studio-e2e-"));
  const session = `studio-e2e-${process.pid}`;
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
    const contextPath = join(dir, "src/server/context.ts");
    await writeFile(
      join(dir, "src/infrastructure/studio/fixture.ts"),
      `
import {StudioService} from "../../services/studio-service";
import {StudioNotSent} from "../../domain/studio";
import {EncryptedCalendarVault} from "../calendar/vault";
import {readFile,writeFile} from "node:fs/promises";
const config={devices:["key","fill","back"].map(id=>({id,name:id,kind:"light",adapter:"amaran",node_id:id})),scenes:[{id:"podcast",name:"Podcast mode",aliases:["podcast"],steps:["key","fill","back"].map(id=>({id,device_id:id,command:{verb:"intensity",value:400},depends_on:id==="back"?["fill"]:[],required:true}))},{id:"recording",name:"Recording setup",aliases:["recording mode"],steps:[{id:"key",device_id:"key",command:{verb:"intensity",value:600},depends_on:[],required:true}]}]};
async function data(){try{return JSON.parse(await readFile(".data/studio-fixture.json","utf8"));}catch{return {levels:{key:100,fill:100,back:100},calls:[]};}}
export function fixtureStudio(user){return new StudioService(user,()=>true,async()=>config,{amaran:{async inspect(d){const f=await data();return {device_id:d.id,status:"available",state:{intensity:f.levels[d.id]},capabilities:["intensity"],observed_at:new Date().toISOString(),detail:"Fixture device"};},async execute(d,c){if(d.id==="fill")throw new StudioNotSent("Fixture fill unavailable before send");const f=await data();f.calls.push(d.id);f.levels[d.id]=c.value;await writeFile(".data/studio-fixture.json",JSON.stringify(f));return {confirmation:"observed",detail:"Fixture applied"};}}},new EncryptedCalendarVault(".data/studio-fixture-vault","a".repeat(64)),()=>{});}
`,
    );
    const source = await readFile(contextPath, "utf8");
    await writeFile(
      contextPath,
      'import {fixtureStudio} from "../infrastructure/studio/fixture";\n' +
        source.replace(
          /new StudioService\([\s\S]*?\n    \),/,
          "fixtureStudio(repository.userId),",
        ),
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
    run("press", "Meta+k");
    run("find", "label", "Search Ary commands", "fill", "Studio");
    run("press", "Enter");
    wait(`document.querySelector('[aria-label="Ary Studio"]')`);
    click("Inspect studio");
    wait(
      `document.querySelector('[aria-label="Physical World spatial view"] [data-status="available"]')`,
    );
    evaluate(
      `document.querySelector('[aria-label="Locations"] button:nth-child(2)').click(); true`,
    );
    wait(
      `document.body.innerText.includes('No configured devices at this location.')`,
    );
    evaluate(
      `document.querySelector('[aria-label="Locations"] button:first-child').click(); true`,
    );
    evaluate(
      `document.querySelector('[aria-label="Device positions"] button').click(); true`,
    );
    wait(`document.querySelector('[aria-label="Selected device telemetry"]')`);
    assert.equal(
      evaluate(
        `!!document.querySelector('[data-nextjs-dialog], .vite-error-overlay')`,
      ),
      false,
    );
    run("screenshot", "/tmp/ary-physical-space.png");
    click("Plan scene");
    wait(`document.body.innerText.includes('REVIEW / Podcast mode')`);
    click("Review and execute scene");
    wait(`document.querySelector('dialog[open]')`);
    click("Reject");
    wait(`!document.querySelector('dialog[open]')`);
    let persisted = JSON.parse(
      await readFile(join(dir, ".data/demo.json"), "utf8"),
    );
    assert.ok(
      !persisted.actions.some(
        (a: Action) =>
          a.tool_name === "studio.execute_scene" && a.status === "succeeded",
      ),
    );
    click("Plan scene");
    wait(`document.body.innerText.includes('REVIEW / Podcast mode')`);
    click("Review and execute scene");
    wait(`document.querySelector('dialog[open]')`);
    click("Approve once and continue");
    wait(`document.body.innerText.includes('Scene result: partial')`);
    assert.ok(
      evaluate(
        `document.body.innerText.includes('Dependency did not succeed')`,
      ),
    );
    persisted = JSON.parse(
      await readFile(join(dir, ".data/demo.json"), "utf8"),
    );
    const action = persisted.actions.find(
      (a: Action) =>
        a.tool_name === "studio.execute_scene" && a.status === "succeeded",
    );
    assert.ok(action);
    assert.ok(
      persisted.outcomes.some(
        (o: Outcome) =>
          o.action_id === action.id &&
          o.status === "failure" &&
          o.metadata.studio_status === "partial",
      ),
    );
    const body = action.input.action_request;
    const replay = await fetch(url + "/api/actions/request", {
      method: "POST",
      headers: { "content-type": "application/json", origin: url },
      body: JSON.stringify(body),
    });
    assert.equal(replay.status, 201);
    assert.equal(
      JSON.parse(await readFile(join(dir, ".data/studio-fixture.json"), "utf8"))
        .calls.length,
      1,
    );
    run("select", '[aria-label="Ary Studio"] select', "recording");
    click("Plan scene");
    wait(`document.body.innerText.includes('REVIEW / Recording setup')`);
    click("Review and execute scene");
    wait(`document.querySelector('dialog[open]')`);
    click("Approve once and continue");
    wait(`document.body.innerText.includes('Scene result: success')`);
    const fixture = JSON.parse(
      await readFile(join(dir, ".data/studio-fixture.json"), "utf8"),
    );
    assert.equal(fixture.levels.key, 600);
    assert.equal(fixture.calls.length, 2);
    wait(`document.body.innerText.includes('Readiness: ready')`);
    const map = await (await fetch(url + "/api/nexus-map")).json();
    assert.ok(map.nodes.some((n: { kind: string }) => n.kind === "location"));
    assert.ok(map.edges.some((e: { type: string }) => e.type === "located_in"));
    click("Create preparation mission");
    wait(`document.body.innerText.includes('Mission saved as a draft')`);
    run("screenshot", "/tmp/ary-studio-e2e.png");
    run("set", "media", "reduced-motion");
    assert.equal(
      evaluate(
        `getComputedStyle(document.querySelector('[aria-label="Device positions"] button')).transitionDuration`,
      ),
      "0s",
    );
    run("screenshot", "/tmp/ary-studio-reduced.png");
    click("Open preparation mission");
    wait(
      `document.body.innerText.includes('DRAFT') && document.body.innerText.includes('Process checkpoint')`,
    );
    console.log(
      JSON.stringify({
        passed: 14,
        checks: [
          "Studio palette navigation",
          "spatial device selection",
          "location switching",
          "fresh read-back readiness",
          "Nexus location/device edges",
          "durable mission draft navigation",
          "reduced-motion transitions",
          "inventory",
          "rejected approval has no effects",
          "approved partial execution",
          "dependency skip",
          "truthful outcome",
          "idempotent replay",
          "recording setup success",
        ],
        hardware: "fixture only",
        screenshot: "/tmp/ary-studio-e2e.png",
      }),
    );
  } catch (error) {
    await writeFile("/tmp/ary-studio-e2e-server.log", serverLog);
    try {
      run("screenshot", "/tmp/ary-studio-e2e-failure.png");
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
