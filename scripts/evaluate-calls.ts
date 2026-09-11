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
  const dir = await mkdtemp(join(tmpdir(), "ary-calls-e2e-"));
  const session = `calls-e2e-${process.pid}`;
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
    // Inject a test-only telephony port into the disposable copy, never the working source.
    const contextPath = join(dir, "src/server/context.ts");
    const fixtureSource = `
import { appendFile } from "node:fs/promises";
import type { PhoneProvider, CallSnapshot } from "../../domain/phone";
export class FixturePhone implements PhoneProvider {
 readonly name="fixture"; readonly supportsTranscript=true;
 assertConfigured(){}
 async inspectNumber(number:string){return {number,valid:true,country:"US",lineType:"mobile"};}
 async initiate(){await appendFile(".data/fixture-dials.log","fixture dial\\n");return this.snapshot("ringing");}
 async getCall(){return {...this.snapshot("completed"),duration_seconds:12,transcript:{text:"Please follow up tomorrow.",source_id:"fixture-transcript"}};}
 async cancelCall(){return this.snapshot("canceled");}
 private snapshot(status:CallSnapshot["status"]):CallSnapshot{return {id:"fixture-call",status,duration_seconds:null,cost:null,transcript:null};}
}`;
    await writeFile(
      join(dir, "src/infrastructure/phone/fixture-phone.ts"),
      fixtureSource,
    );
    const source = await readFile(contextPath, "utf8");
    await writeFile(
      contextPath,
      'import {FixturePhone} from "../infrastructure/phone/fixture-phone";\n' +
        source.replace(
          "new PhoneService(repository, new TwilioPhoneProvider())",
          "new PhoneService(repository, new FixturePhone(), () => {})",
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
          ARY_CALLS_ALLOWED_NUMBERS: "+14155550123",
          ARY_INTEGRATION_ENCRYPTION_KEY: "a".repeat(64),
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
    run("press", "Meta+k");
    run("find", "label", "Search Ary commands", "fill", "Calls");
    run("press", "Enter");
    wait(`document.querySelector('[aria-label="Ary Calls"]')`);
    wait(`document.body.innerText.includes('fixture configured')`);
    run("find", "label", "Phone number (E.164)", "fill", "+14155550123");
    run(
      "find",
      "label",
      "Approved message",
      "fill",
      "Please call back about the project tomorrow.",
    );
    run(
      "find",
      "label",
      "I explicitly want Ary to call this destination with this script.",
      "check",
    );
    click("Review and request call");
    wait(
      `document.querySelector('dialog[open] [aria-label="Exact call review"]')`,
    );
    assert.equal(
      evaluate(
        `document.querySelector('dialog[open]').textContent.includes('automated assistant')`,
      ),
      true,
    );
    assert.equal(
      (await state()).actions.some(
        (a) => a.tool_name === "phone.initiate" && a.status === "succeeded",
      ),
      false,
    );
    click("Reject");
    wait(`!document.querySelector('dialog[open]')`);
    run(
      "find",
      "label",
      "Approved message",
      "fill",
      "Please call back about the project next week.",
    );
    run(
      "find",
      "label",
      "I explicitly want Ary to call this destination with this script.",
      "check",
    );
    run("find", "label", "Capture transcript when supported", "check");
    run(
      "find",
      "label",
      "I confirm the required recording/transcription consent.",
      "check",
    );
    click("Review and request call");
    wait(
      `document.querySelector('dialog[open] [aria-label="Exact call review"]')`,
    );
    click("Approve once and continue");
    wait(`document.body.innerText.includes('phone.initiate recorded.')`);
    const initial = (await state()).actions.find(
      (a) => a.tool_name === "phone.initiate" && a.status === "succeeded",
    );
    assert.ok(initial);
    const existing = (await state()).tasks.length;
    click("Refresh provider status");
    wait(`document.body.innerText.includes('Please follow up tomorrow.')`);
    const project = (await state()).entities.find(
      (e) => e.entity_type === "project",
    );
    assert.ok(project);
    run("select", "#call-related-project", project.id);
    // First receipt is the newly refreshed snapshot; use its existing follow-up action control.
    run("snapshot", "-i");
    evaluate(
      `Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Propose follow-up task').click();true`,
    );
    wait(`document.querySelector('dialog[open]')`);
    assert.equal((await state()).tasks.length, existing);
    click("Approve once and continue");
    wait(`document.body.innerText.includes('Created task ')`);
    const task = (await state()).tasks.find(
      (t) => t.title === "Follow up on the call",
    );
    assert.ok(task?.metadata.source_action_id);
    run("snapshot", "-i");
    evaluate(
      `Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Stop this call').click();true`,
    );
    wait(`document.body.innerText.includes('phone.cancel recorded.')`);
    assert.equal(
      (await readFile(join(dir, ".data/fixture-dials.log"), "utf8")).trim(),
      "fixture dial",
    );
    const final = await state();
    assert.ok(final.action_approvals.some((a) => a.decision === "rejected"));
    assert.ok(
      final.action_approvals.some(
        (a) => a.decision === "approved" && a.consumed_at,
      ),
    );
    assert.ok(
      final.outcomes.some(
        (o) => o.metadata.transcript_source === "fixture-transcript",
      ),
    );
    run("screenshot", "/tmp/ary-calls-e2e.png");
    assert.equal(run("errors").trim(), "");
    console.log(
      JSON.stringify(
        {
          passed: true,
          apiMocked: false,
          provider: "test-only telephony port; no real calls",
          storage: "disposable LocalRepository",
          checks: [
            "Calls palette navigation",
            "exact script review",
            "rejection never dials",
            "explicit approval initiates once",
            "consented transcript/status summary",
            "separately approved real task with call evidence",
            "stop call",
            "audit/outcome/approval linkage",
            "no browser errors",
          ],
        },
        null,
        2,
      ),
    );
  } catch (error) {
    await writeFile("/tmp/ary-calls-e2e-server.log", serverLog);
    try {
      run("screenshot", "/tmp/ary-calls-e2e-failure.png");
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
