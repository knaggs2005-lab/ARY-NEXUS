/** Isolated browser fixtures; never sends meeting requests to the user's database/provider. */
import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  boardRoles,
  type BoardReport,
  type BoardEvent,
} from "../src/domain/board";
async function main() {
  const dir = await mkdtemp(join(tmpdir(), "ary-board-ui-"));
  const session = `ary-board-${process.pid}`,
    cli = resolve("node_modules/.bin/agent-browser");
  const run = (...args: string[]) =>
    execFileSync(cli, ["--session", session, ...args], {
      encoding: "utf8",
      timeout: 40000,
    });
  const evaluate = (code: string) => JSON.parse(run("eval", code).trim());
  const wait = (code: string) =>
    evaluate(
      `new Promise((resolve,reject)=>{const start=Date.now();const tick=()=>{if(${code})resolve(true);else if(Date.now()-start>15000)reject(new Error('Timed out'));else setTimeout(tick,50)};tick()})`,
    );
  const results: string[] = [];
  const check = (name: string, value: unknown) => {
    if (!value) throw new Error(name);
    results.push(name);
  };
  const report: BoardReport = {
    version: "board-v1",
    id: "fixture",
    conversation_id: "fixture-conversation",
    created_at: "2026-09-07T12:00:00Z",
    focus: "Fixture meeting",
    status: "complete",
    latency_ms: 1000,
    warnings: ["Fixture. No real actions."],
    summary: "Fix the tracking blocker first.",
    evidence: [
      {
        key: "W1",
        table: "tasks",
        id: "fixture-task",
        label: "Fixture tracking task",
        detail: "Existing fixture evidence",
        entity_id: "fixture-project",
        score: 26,
      },
    ],
    roles: boardRoles.map((role, i) => ({
      role,
      status: "complete",
      summary: `${role} completed review`,
      findings:
        i < 4
          ? [
              {
                id: `${i}-1`,
                role,
                observation: "Tracking needs validation",
                next_step: "Review the tracking fix",
                evidence: ["W1"],
                confidence: 0.7,
              },
            ]
          : [],
      model: "fixture-model",
      provider: "fixture",
      metrics: null,
    })),
    ranked_findings: ["0-1", "1-1", "2-1", "3-1"],
    plan: [{ finding_id: "0-1", next_step: "Review the tracking fix" }],
  };
  const events: BoardEvent[] = [
    { type: "stage", stage: "Specialist review", role: "Sales Ary" },
    ...report.roles.flatMap((result) => [
      { type: "role", result } as BoardEvent,
    ]),
    { type: "complete", report },
  ];
  const dashboard = {
    reflectionDev: false,
    memories: [],
    memoryRecords: [],
    conflicts: [],
    jobs: [],
    aliases: [],
    graph: { nodes: [], edges: [] },
    conversations: [],
    goals: [],
    decisions: [],
    tasks: [],
    actions: [],
    outcomes: [],
    mode: "demo",
    provider: "fixture",
    embeddingModel: "fixture",
  };
  try {
    const init = join(dir, "init.js");
    await writeFile(
      init,
      `window.__boardWrites=0;window.__outsideWrites=0;window.__saved=[];const originalFetch=window.fetch.bind(window);window.fetch=async(input,options={})=>{const url=new URL(typeof input==='string'?input:input.url,location.origin);if(!url.pathname.startsWith('/api/'))return originalFetch(input,options);const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});if(url.pathname==='/api/board/meetings'){if(options.method!=='POST')return json(window.__saved);window.__boardWrites++;if(window.__deny)return json({error:'Board is not permitted'},403);const events=${JSON.stringify(events)};const encoder=new TextEncoder();return new Response(new ReadableStream({async start(c){for(const event of events){await new Promise(r=>setTimeout(r,300));if(options.signal?.aborted){c.error(new DOMException('Aborted','AbortError'));return;}c.enqueue(encoder.encode(JSON.stringify(event)+'\\n'));}window.__saved=[events.at(-1).report];c.close();}}),{headers:{'content-type':'application/x-ndjson'}});}if(options.method&&options.method!=='GET'){window.__outsideWrites++;return json({},500);}const routes=${JSON.stringify({ "/api/config": { mode: "demo", configured: true }, "/api/dashboard": dashboard, "/api/priorities": { version: "priority-v1", evaluated_at: "2026-09-07T12:00:00Z", items: [], excluded: [], warnings: [] } })};return json(routes[url.pathname]||{});};`,
    );
    run(
      "--init-script",
      init,
      "open",
      process.env.BOARD_TEST_URL || "http://127.0.0.1:3000/",
    );
    run("set", "viewport", "1440", "1100");
    run(
      "find",
      "role",
      "button",
      "click",
      "--name",
      "Open Priority Intelligence ↗",
    );
    run("find", "role", "button", "click", "--name", "Board", "--exact");
    wait(`document.querySelector('[aria-label="Daily Board Meeting"]')`);
    check(
      "six waiting roles visible",
      evaluate(
        `document.querySelectorAll('[data-state="waiting"]').length===6`,
      ),
    );
    run("find", "role", "button", "click", "--name", "Start daily meeting");
    wait(`document.querySelector('[data-state="running"]')`);
    check(
      "actual streaming stage visible",
      evaluate(`document.body.innerText.includes('Specialist review')`),
    );
    wait(`document.body.innerText.includes('Brief ready')`);
    check(
      "six completed role cards",
      evaluate(
        `document.querySelectorAll('[data-state="complete"]').length===6`,
      ),
    );
    check(
      "final plan and entity link",
      evaluate(
        `document.querySelector('[aria-label="Consolidated daily plan"]').innerText.includes('Review the tracking fix') && [...document.querySelectorAll('button')].some(b=>b.textContent.includes('Fixture tracking task'))`,
      ),
    );
    check(
      "history displays durable fixture",
      evaluate(`document.body.innerText.includes('Fixture meeting')`),
    );
    run("set", "media", "reduced-motion");
    check(
      "reduced motion disables briefing animation",
      evaluate(
        `getComputedStyle(document.querySelector('[aria-label="Consolidated daily plan"] li')).animationName==='none'`,
      ),
    );
    run("set", "viewport", "390", "844");
    check(
      "mobile board fits viewport",
      evaluate(
        `document.querySelector('[aria-label="Daily Board Meeting"]').getBoundingClientRect().right<=innerWidth+1`,
      ),
    );
    run("find", "role", "button", "click", "--name", "Start daily meeting");
    wait(`document.querySelector('[data-state="running"]')`);
    run("find", "role", "button", "click", "--name", "Stop meeting");
    wait(`document.querySelector('[role="alert"]')`);
    check(
      "stop produces explicit cancellation",
      evaluate(
        `document.querySelector('[role="alert"]').textContent.includes('Meeting stopped')`,
      ),
    );
    evaluate(`window.__deny=true;true`);
    run("find", "role", "button", "click", "--name", "Start daily meeting");
    wait(`document.body.innerText.includes('Board is not permitted')`);
    check("permission denial visible", true);
    check(
      "no external or work mutations",
      evaluate(`window.__outsideWrites===0`),
    );
    check(
      "no page reload",
      evaluate(`performance.getEntriesByType('navigation').length===1`),
    );
    check("no browser errors", !run("errors").trim());
    console.log(
      JSON.stringify(
        { fixtureOnly: true, passed: results.length, results },
        null,
        2,
      ),
    );
  } finally {
    try {
      run("close");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
