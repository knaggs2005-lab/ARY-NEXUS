/** Disposable Design UI/action/approval test. No Cinema 4D scene changes. */
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
  const dir = await mkdtemp(join(tmpdir(), "ary-design-e2e-"));
  const session = `design-e2e-${process.pid}`;
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
    await writeFile(
      join(dir, "src/infrastructure/design/fixture.ts"),
      `
let revision=1;const objects=[];
export class FixtureDesign {
 assertAvailable(){}
 async inspect(){return {adapter:"cinema4d-fixture",revision:"fixture-"+revision,document_id:"doc-1",document_name:"Disposable design",document_path:"/fixture.c4d",mm_per_unit:10,complete:true,safe_scene:true,undo_token:null,export_formats:["obj"],objects:[...objects]};}
 async execute(verb,input){if(input.expected_revision!=="fixture-"+revision)throw Error("Stale design state");revision++;if(verb==="create_object")objects.push({id:"object-1",name:input.args.name,kind:"box",dimensions_mm:input.args.dimensions_mm,selected:false,editable:true});else if(verb==="modify_dimensions")objects[0].dimensions_mm=input.args.dimensions_mm;else throw Error("Unexpected fixture command");return {provider:"cinema4d-fixture",verb,object_id:"object-1",after_state:await this.inspect(),simulated:true};}
}`,
    );
    const source = await readFile(contextPath, "utf8");
    await writeFile(
      contextPath,
      'import {FixtureDesign} from "../infrastructure/design/fixture";\n' +
        source.replace(
          /new Cinema4DDesignTool\([\s\S]*?\n      \),/,
          "new FixtureDesign(),",
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
    const warmed = await fetch(url, { signal: AbortSignal.timeout(60000) });
    assert.equal(warmed.status, 200);
    run("open", url);
    wait(`document.querySelector('[aria-label="Open Ary command palette"]')`);
    run("press", "Meta+k");
    run("find", "label", "Search Ary commands", "fill", "Creative");
    run("press", "Enter");
    wait(`document.querySelector('[aria-label="Ary Design Tools"]')`);
    click("Inspect design document");
    wait(`document.body.innerText.includes('Disposable design')`);
    run(
      "find",
      "label",
      "Design inputs",
      "fill",
      JSON.stringify({
        kind: "box",
        name: "Bracket blank",
        dimensions_mm: [50, 20, 10],
      }),
    );
    click("Prepare design plan");
    wait(`document.body.innerText.includes('Review design change')`);
    click("Request design approval");
    wait(`document.querySelector('dialog[open]')`);
    click("Reject");
    wait(`!document.querySelector('dialog[open]')`);
    let persisted = JSON.parse(
      await readFile(join(dir, ".data/demo.json"), "utf8"),
    );
    assert.ok(
      !persisted.actions.some(
        (a: Action) =>
          a.tool_name === "design.create_object" && a.status === "succeeded",
      ),
    );
    click("Prepare design plan");
    click("Request design approval");
    wait(`document.querySelector('dialog[open]')`);
    click("Approve once and continue");
    wait(`document.body.innerText.includes('Design receipt')`);
    run(
      "select",
      '[aria-label="Ary Design Tools"] select',
      "modify_dimensions",
    );
    run(
      "find",
      "label",
      "Design inputs",
      "fill",
      JSON.stringify({ object_id: "object-1", dimensions_mm: [60, 20, 10] }),
    );
    click("Prepare design plan");
    click("Request design approval");
    wait(`document.querySelector('dialog[open]')`);
    click("Approve once and continue");
    wait(`document.body.innerText.includes('"verb": "modify_dimensions"')`);
    persisted = JSON.parse(
      await readFile(join(dir, ".data/demo.json"), "utf8"),
    );
    const changed = persisted.actions.find(
      (a: Action) =>
        a.tool_name === "design.modify_dimensions" && a.status === "succeeded",
    );
    assert.ok(changed);
    assert.deepEqual(
      changed.output.result.after_state.objects[0].dimensions_mm,
      [60, 20, 10],
    );
    assert.ok(
      persisted.outcomes.some((o: Outcome) => o.action_id === changed.id),
    );
    assert.ok(
      persisted.action_approvals.some(
        (a: ActionApproval) => a.decision === "rejected",
      ),
    );
    assert.equal(
      persisted.action_approvals.filter(
        (a: ActionApproval) => a.decision === "approved" && a.consumed_at,
      ).length,
      2,
    );
    assert.ok(!run("errors").trim());
    run("screenshot", "/tmp/ary-design-e2e.png", "--full");
    console.log(
      JSON.stringify(
        {
          passed: true,
          provider: "test-only Design port; no native geometry",
          checks: [
            "Creative Design UI",
            "inspection before planning",
            "rejected creation does not execute",
            "approved box creation",
            "approved 10 mm width change",
            "exact result and outcome",
            "consumed approvals and rejection history",
            "no browser errors",
          ],
        },
        null,
        2,
      ),
    );
  } catch (error) {
    await writeFile("/tmp/ary-design-e2e-server.log", serverLog);
    try {
      run("screenshot", "/tmp/ary-design-e2e-failure.png");
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
