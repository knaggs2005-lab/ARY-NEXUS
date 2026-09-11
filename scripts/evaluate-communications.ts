/** Observed communication fixtures → real browser/HTTP → existing approval/task pipeline. No external provider calls. */
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

import { LocalRepository } from "../src/infrastructure/repositories/local";
import { communicationFixture } from "../tests/helpers/communications-fixture";
import { taskSnapshot } from "../src/domain/task-actions";

async function main() {
  const root = process.cwd();
  const dir = await mkdtemp(join(tmpdir(), "ary-communications-e2e-"));
  const session = `communications-e2e-${process.pid}`;
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
    const fixtureRepo = new LocalRepository(
      "00000000-0000-4000-8000-000000000001",
      join(dir, ".data/demo.json"),
    );
    const fixture = await communicationFixture(fixtureRepo);
    const quote =
      "I will send the revised interview schedule tomorrow morning.";
    const captured = await fixtureRepo.insert("actions", {
      tool_name: "phone.refresh",
      action_type: "fixture",
      conversation_id: null,
      permission_level: 1,
      status: "succeeded",
      input: {},
      error: null,
      metadata: { related_entity_ids: [fixture.person.id, fixture.project.id] },
      output: {
        result: {
          kind: "phone_call",
          operation_id: "debrief-fixture",
          provider: "fixture",
          capture_transcript: true,
          snapshot: {
            id: "debrief-fixture",
            status: "completed",
            transcript: { source_id: "synthetic-transcript", text: quote },
          },
          summary: "Synthetic call evidence for isolated debrief verification",
          observed_at: new Date().toISOString(),
        },
      },
    });
    const mockPath = join(dir, "src/infrastructure/providers/local.ts");
    const mock = await readFile(mockPath, "utf8");
    const marker = "  async reason(context: BrainContext) {";
    assert.ok(mock.includes(marker));
    await writeFile(
      mockPath,
      mock.replace(
        marker,
        marker +
          `
      if (context.intent === "communication_debrief") return ${JSON.stringify(JSON.stringify({ summary: "Synthetic recipient reports a schedule commitment.", candidates: [{ kind: "commitment", source_id: "synthetic-transcript", quote, reason: "Explicit reported commitment", confidence: 0.8, importance: 0.8 }] }))};
    `,
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
    await fetch(url); // Warm the isolated compiler before the browser's bounded navigation timeout.
    await fetch(`${url}/api/communications`);
    run("open", url);
    wait(`document.querySelector('[aria-label="Open Ary command palette"]')`);
    run("press", "Meta+k");
    run("find", "label", "Search Ary commands", "fill", "Communications");
    run("press", "Enter");
    wait(`document.querySelector('[aria-label="Ary Communications Hub"]')`);
    wait(`document.body.innerText.includes('Asked Jordan to review')`);
    const api = (path: string, body?: unknown) =>
      evaluate(
        `(async()=>{const r=await fetch('/api/'+${JSON.stringify(path)},${JSON.stringify(body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })});return {status:r.status,body:await r.json()};})()`,
      );
    const initial = api("communications");
    assert.equal(initial.status, 200);
    assert.equal(initial.body.timeline.length, 4);
    assert.equal(initial.body.follow_ups.length, 1);
    assert.equal(
      initial.body.people.find(
        (p: { entity: { id: string } }) => p.entity.id === fixture.person.id,
      ).unanswered_threads,
      1,
    );
    assert.ok(!JSON.stringify(initial.body).includes("PRIVATE"));
    click("Who do I need to follow up with?");
    wait(`document.body.innerText.includes('Follow up with Jordan')`);
    run("screenshot", "/tmp/ary-communications-e2e.png", "--full");
    run(
      "find",
      "text",
      "Plan a communication · review what happened",
      "click",
      "--exact",
    );
    run("select", '[aria-label="Communication planning"] select', "messaging");
    run(
      "find",
      "label",
      "Contact name, alias or ID",
      "fill",
      fixture.person.id,
    );
    run(
      "find",
      "label",
      "Objective",
      "fill",
      "Find out whether Thursday works",
    );
    run(
      "find",
      "label",
      "Proposed message",
      "fill",
      "Would Thursday work? Please reply to the owner.",
    );
    click("Prepare communication plan");
    wait(
      `document.body.innerText.includes('Messaging transport is not configured')`,
    );
    run("find", "label", "Call/email source action ID", "fill", captured.id);
    run(
      "find",
      "label",
      "Follow-up project ID · optional",
      "fill",
      fixture.project.id,
    );
    click("Prepare communication debrief");
    wait(
      `document.body.innerText.includes('Synthetic recipient reports a schedule commitment')`,
    );
    click("Review evidence 1 for memory");
    wait(`document.body.innerText.includes('Approve once and continue')`);
    click("Approve once and continue");
    wait(`document.body.innerText.includes('Recorded memory.capture result')`);
    click("Review follow-up 1");
    wait(`document.body.innerText.includes('Approve once and continue')`);
    click("Approve once and continue");
    wait(`document.body.innerText.includes('Recorded create_task result')`);
    const records = JSON.parse(
      await readFile(join(dir, ".data/demo.json"), "utf8"),
    );
    assert.equal(
      records.memories.filter((m: { content: string }) =>
        m.content.includes(captured.id),
      ).length,
      1,
    );
    assert.equal(
      records.tasks.filter((t: Task) => t.title.startsWith("Follow up:"))
        .length,
      1,
    );
    click("Review follow-up 1");
    wait(`document.body.innerText.includes('Recorded create_task result')`);
    const replayRecords = JSON.parse(
      await readFile(join(dir, ".data/demo.json"), "utf8"),
    );
    assert.equal(
      replayRecords.tasks.filter((t: Task) => t.title.startsWith("Follow up:"))
        .length,
      1,
    );
    evaluate(
      `document.querySelector('[aria-label="Communication planning"]').scrollIntoView({block:'start'})`,
    );
    run("screenshot", "/tmp/ary-communication-planning-e2e.png");
    run("set", "media", "dark", "reduced-motion");
    assert.equal(
      evaluate(`matchMedia('(prefers-reduced-motion: reduce)').matches`),
      true,
    );
    run("screenshot", "/tmp/ary-communication-planning-reduced.png");
    // Review through the existing owner approval endpoint; this never reaches an external provider.
    const rejected = api(`permissions/attempts/${fixture.pending.id}/review`, {
      decision: "rejected",
      reason: "Reject disposable fixture outreach",
    });
    assert.equal(rejected.status, 201);
    click("Refresh observed history");
    wait(`document.body.innerText.includes('0 pending approvals')`);
    // Complete the source-linked task using the existing transactional ToolRegistry pipeline.
    const update = {
      tool: "update_task",
      input: {
        task_id: fixture.task.id,
        expected_updated_at: fixture.task.updated_at,
        before: taskSnapshot(fixture.task),
        changes: { status: "completed" },
      },
      request_key: "communications-e2e-complete",
      reason: "User reviewed and completed the fixture follow-up",
    };
    const proposal = api("actions/request", update);
    assert.equal(proposal.status, 409);
    const approved = api(
      `permissions/attempts/${proposal.body.action_id}/review`,
      { decision: "approved", reason: "Approve fixture completion" },
    );
    assert.equal(approved.status, 201);
    const completed = api("actions/request", update);
    assert.equal(completed.status, 201);
    const replay = api("actions/request", update);
    assert.equal(replay.status, 201);
    click("Refresh observed history");
    wait(`document.body.innerText.includes('1 open follow-ups')`);
    click("Unified timeline");
    click("Open gmail source");
    wait(`document.querySelector('[aria-label="Ary Communications"]')`);
    wait(
      `document.body.innerText.includes('disconnected or different Gmail connection')`,
    );
    click("Communications hub");
    wait(`document.querySelector('[aria-label="Ary Communications Hub"]')`);
    const denied = api("permissions/policies", {
      tool: "gmail.read",
      level: 0,
      reason: "Fixture source access revocation",
    });
    assert.equal(denied.status, 201);
    const redacted = api("communications");
    assert.equal(
      redacted.body.timeline.some(
        (e: { source: { channel: string } }) => e.source.channel === "gmail",
      ),
      false,
    );
    const final = JSON.parse(
      await readFile(join(dir, ".data/demo.json"), "utf8"),
    );
    assert.equal(
      final.tasks.find((t: Task) => t.id === fixture.task.id).status,
      "completed",
    );
    assert.ok(
      final.outcomes.some(
        (o: Outcome) => o.action_id === completed.body.action_id,
      ),
    );
    assert.ok(
      final.action_approvals.some((a: ActionApproval) => a.consumed_at),
    );
    assert.equal(
      final.actions.filter((a: Action) => a.tool_name === "phone.initiate")
        .length,
      1,
    );
    assert.equal(
      final.actions.filter(
        (a: Action) => a.tool_name === "gmail.send" && a.status === "succeeded",
      ).length,
      0,
    );
    assert.ok(!run("errors").trim());
    console.log(
      JSON.stringify(
        {
          passed: true,
          storage: "disposable LocalRepository",
          external_execution: false,
          checks: [
            "unified source timeline",
            "unconfigured messaging plan never delivers",
            "bounded synthetic transcript debrief",
            "separate visible memory and follow-up approvals",
            "real local evidence memory and follow-up task",
            "derived task idempotent browser replay",
            "reduced-motion rendering",
            "contact/project follow-up ranking",
            "bounded references without raw mail/transcript",
            "rejected approval disappears",
            "existing approved transactional task completion",
            "idempotent replay and outcome audit",
            "follow-up removal without reload",
            "Gmail disconnected-source guard",
            "revoked source permission redaction",
            "no browser errors",
          ],
        },
        null,
        2,
      ),
    );
  } catch (error) {
    await writeFile("/tmp/ary-communications-e2e-server.log", serverLog);
    try {
      run("screenshot", "/tmp/ary-communications-e2e-failure.png");
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
