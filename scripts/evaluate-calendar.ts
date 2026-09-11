/** Isolated UI fixtures. Every API request is intercepted; no Google or database writes. */
import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
async function main() {
  const dir = await mkdtemp(join(tmpdir(), "ary-calendar-ui-")),
    session = `ary-calendar-${process.pid}`,
    cli = resolve("node_modules/.bin/agent-browser");
  const run = (...args: string[]) =>
    execFileSync(cli, ["--session", session, ...args], {
      encoding: "utf8",
      timeout: 40000,
    });
  const evaluate = (s: string) => JSON.parse(run("eval", s).trim());
  const wait = (s: string) =>
    evaluate(
      `new Promise((resolve,reject)=>{const started=Date.now();const tick=()=>{if(${s})resolve(true);else if(Date.now()-started>15000)reject(new Error('Timed out'));else setTimeout(tick,50)};tick()})`,
    );
  const results: string[] = [];
  const check = (n: string, v: unknown) => {
    if (!v) throw new Error(n);
    results.push(n);
  };
  const secondary = randomUUID();
  const connection = randomUUID(),
    project = {
      id: randomUUID(),
      name: "Wag Trails",
      entity_type: "project",
      description: "Trails fixture",
      metadata: {},
    };
  const event = {
    id: "fixture-event",
    etag: '"v1"',
    summary: "Wag Trails planning",
    description: "Review tracking",
    start: new Date(Date.now() + 3600000).toISOString(),
    end: new Date(Date.now() + 7200000).toISOString(),
    time_zone: "UTC",
    all_day: false,
    busy: true,
    editable: true,
    people: [],
    entity_ids: [project.id],
    entities: [{ id: project.id, name: project.name, type: "project" }],
    resolution: [],
  };
  const report = {
    events: [event],
    connection_id: connection,
    complete: true,
    time_zone: "UTC",
    conflicts: [],
    window: { start: event.start, end: event.end },
  };
  const dashboard = {
    reflectionDev: false,
    memories: [],
    memoryRecords: [],
    conflicts: [],
    jobs: [],
    aliases: [],
    graph: { nodes: [project], edges: [] },
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
      `window.__requests=[];window.__executions=0;window.__approved=false;const report=${JSON.stringify(report)};const routes=${JSON.stringify(
        {
          "/api/config": { mode: "demo", configured: true },
          "/api/dashboard": dashboard,
          "/api/priorities": {
            version: "priority-v1",
            evaluated_at: new Date().toISOString(),
            items: [],
            excluded: [],
            warnings: [],
          },
          "/api/calendar/status": {
            configured: true,
            connected: true,
            writable: true,
            connection_id: connection,
            account: "fixture@example.com",
            accounts: [
              {
                connection_id: connection,
                account: "fixture@example.com",
                writable: true,
              },
              {
                connection_id: secondary,
                account: "work@example.com",
                writable: false,
              },
            ],
          },
        },
      )};const original=fetch.bind(window);window.fetch=async(input,options={})=>{const url=new URL(typeof input==='string'?input:input.url,location.origin);if(!url.pathname.startsWith('/api/'))return original(input,options);const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});if(url.pathname==='/api/actions/request'){const raw=JSON.parse(options.body);window.__requests.push(raw);if(raw.tool==='google_calendar.read')return window.__denied?json({error:'Calendar access denied'},403):json({result:{...report,connection_id:raw.input.connection_id||report.connection_id,events:report.events.map(e=>({...e,summary:raw.input.connection_id===report.connection_id?e.summary:'Work account event'}))}});if(raw.tool==='google_calendar.recommend')return json({result:{...report,blocks:[{start:report.events[0].end,end:new Date(Date.parse(report.events[0].end)+3600000).toISOString(),reason:'No busy primary-calendar event in this window.'}]}});window.__pending=raw;if(!window.__approved)return json({code:'approval_required',action_id:'fixture-approval',tool:raw.tool,error:'Approval required'},409);window.__approved=false;window.__executions++;return json({result:{event:{...report.events[0],...raw.input.event},recovered:false}});}if(url.pathname==='/api/permissions/attempts/fixture-approval')return json({id:'fixture-approval',tool_name:window.__pending.tool,input:{action_request:window.__pending},metadata:{request_envelope:window.__pending}});if(url.pathname.endsWith('/review')){window.__approved=JSON.parse(options.body).decision==='approved';return json({});}return json(routes[url.pathname]||{});};`,
    );
    run(
      "--init-script",
      init,
      "open",
      process.env.CALENDAR_TEST_URL || "http://127.0.0.1:3000/",
    );
    run("set", "viewport", "1440", "1100");
    run("find", "role", "button", "click", "--name", "WORLD");
    run("find", "role", "button", "click", "--name", "Calendar", "--exact");
    wait(`document.querySelector('[aria-label="Ary Calendar"]')`);
    run("find", "role", "button", "click", "--name", "Read events", "--exact");
    wait(`document.getElementById('calendar-event-fixture-event')`);
    check(
      "native timeline and canonical entity chips",
      evaluate(
        `document.querySelector('[aria-label="Event timeline"]').textContent.includes('Wag Trails')&&!document.querySelector('iframe')`,
      ),
    );
    check(
      "both authorized accounts are visible",
      evaluate(
        `document.querySelector('[aria-label="Google Calendar account"]').options.length===2`,
      ),
    );
    run("select", '[aria-label="Google Calendar account"]', secondary);
    check(
      "switching accounts clears the prior timeline",
      evaluate(`!document.getElementById('calendar-event-fixture-event')`),
    );
    run("find", "role", "button", "click", "--name", "Read events", "--exact");
    wait(
      `document.getElementById('calendar-event-fixture-event')?.textContent.includes('Work account event')`,
    );
    check(
      "selected account is sent through the action request",
      evaluate(
        `window.__requests.at(-1).input.connection_id===${JSON.stringify(secondary)}`,
      ),
    );
    check(
      "read-only account does not inherit default editing consent",
      evaluate(
        `[...document.querySelectorAll('button')].find(b=>b.textContent==='Propose event').disabled`,
      ),
    );
    run("select", '[aria-label="Google Calendar account"]', connection);
    run("find", "role", "button", "click", "--name", "Read events", "--exact");
    wait(
      `document.getElementById('calendar-event-fixture-event')?.textContent.includes('Wag Trails')`,
    );
    run("click", "#calendar-event-fixture-event");
    wait(
      `document.querySelector('[aria-label="Calendar context panel"]').textContent.includes('Review tracking')`,
    );
    check(
      "selected event receives focus and contextual panel",
      evaluate(
        `document.getElementById('calendar-event-fixture-event').getAttribute('aria-pressed')==='true'`,
      ),
    );
    run("screenshot", "/tmp/ary-calendar-timeline.png");
    run(
      "find",
      "role",
      "button",
      "click",
      "--name",
      "Propose changes",
      "--exact",
    );
    run("find", "label", "Title", "fill", "Revised tracking plan");
    check(
      "review shows before and after",
      evaluate(
        `document.querySelector('[aria-label="Calendar change review"]').textContent.includes('Wag Trails planning')&&document.querySelector('[aria-label="Calendar change review"]').textContent.includes('Revised tracking plan')`,
      ),
    );
    run(
      "find",
      "role",
      "button",
      "click",
      "--name",
      "Request approval",
      "--exact",
    );
    wait(`document.querySelector('dialog[open]')`);
    check("no write before approval", evaluate(`window.__executions===0`));
    run("find", "role", "button", "click", "--name", "Reject", "--exact");
    wait(`!document.querySelector('dialog[open]')`);
    check(
      "rejection has no external execution",
      evaluate(`window.__executions===0`),
    );
    run(
      "find",
      "role",
      "button",
      "click",
      "--name",
      "Request approval",
      "--exact",
    );
    wait(`document.querySelector('dialog[open]')`);
    run(
      "find",
      "role",
      "button",
      "click",
      "--name",
      "Approve once and continue",
      "--exact",
    );
    wait(`document.body.innerText.includes('GOOGLE CONFIRMED')`);
    check(
      "approved update renders actual provider receipt",
      evaluate(
        `window.__executions===1&&document.querySelector('[aria-label="Calendar context panel"]').textContent.includes('Revised tracking plan')`,
      ),
    );
    run("find", "role", "button", "click", "--name", "Read events", "--exact");
    wait(`document.getElementById('calendar-event-fixture-event')`);
    run(
      "find",
      "role",
      "button",
      "click",
      "--name",
      "Suggest 60-minute blocks",
      "--exact",
    );
    wait(`document.body.innerText.includes('Review this block')`);
    check(
      "recommendation does not create events",
      evaluate(`window.__executions===1`),
    );
    run(
      "find",
      "role",
      "button",
      "click",
      "--name",
      "Review this block",
      "--exact",
    );
    run(
      "find",
      "role",
      "button",
      "click",
      "--name",
      "Request approval",
      "--exact",
    );
    wait(`document.querySelector('dialog[open]')`);
    run(
      "find",
      "role",
      "button",
      "click",
      "--name",
      "Approve once and continue",
      "--exact",
    );
    wait(`window.__executions===2`);
    check(
      "approved recommendation creates through same pipeline",
      evaluate(
        `window.__requests.some(r=>r.tool==='google_calendar.create'&&r.input.operation_id&&r.request_key)`,
      ),
    );
    run("set", "media", "reduced-motion");
    run("set", "viewport", "390", "844");
    check(
      "mobile layout stays within viewport",
      evaluate(
        `document.querySelector('[aria-label="Ary Calendar"]').getBoundingClientRect().right<=innerWidth+1`,
      ),
    );
    check(
      "reduced motion disables decorative animation",
      evaluate(
        `getComputedStyle(document.querySelector('[aria-label="Calendar context panel"]')).animationName==='none'`,
      ),
    );
    evaluate(`window.__denied=true;true`);
    run("find", "role", "button", "click", "--name", "Read events", "--exact");
    wait(`document.body.innerText.includes('Calendar access denied')`);
    check(
      "denied refresh clears previous events",
      evaluate(`!document.getElementById('calendar-event-fixture-event')`),
    );
    check(
      "no full page reload",
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
