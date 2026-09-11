/** Isolated UI fixtures: every Ary API call is intercepted. No email, model, or database writes. */
import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
async function main() {
  const dir = await mkdtemp(join(tmpdir(), "ary-gmail-ui-")),
    session = `ary-gmail-${process.pid}`,
    cli = resolve("node_modules/.bin/agent-browser");
  const run = (...args: string[]) =>
    execFileSync(cli, ["--session", session, ...args], {
      encoding: "utf8",
      timeout: 40000,
    });
  const evaluate = (s: string) => JSON.parse(run("eval", s).trim());
  const wait = (s: string) =>
    evaluate(
      `new Promise((resolve,reject)=>{const started=Date.now();const tick=()=>{if(${s})resolve(true);else if(Date.now()-started>15000)reject(new Error('Timed out: '+${JSON.stringify(s)}));else setTimeout(tick,50)};tick()})`,
    );
  const click = (name: string) =>
    run("find", "role", "button", "click", "--name", name, "--exact");
  const results: string[] = [];
  const check = (name: string, value: unknown) => {
    if (!value) throw new Error(name);
    results.push(name);
  };
  const connection = randomUUID(),
    draftId = randomUUID(),
    analysisId = randomUUID(),
    project = {
      id: randomUUID(),
      name: "Wag Trails",
      entity_type: "project",
      description: "Trails fixture",
      metadata: {},
    };
  const quote =
    "We decided to prioritize fixing Wag Trails tracking before adding more features.";
  const thread = {
    id: "abc123",
    connection_id: connection,
    account: "fixture@example.com",
    truncated: false,
    entities: [{ id: project.id, name: project.name, type: "project" }],
    resolution: [],
    messages: [
      {
        id: "def456",
        thread_id: "abc123",
        from: "Alex <alex@example.com>",
        to: "fixture@example.com",
        subject: "Wag Trails tracking decision",
        date: new Date().toISOString(),
        text: quote,
        body_available: true,
        truncated: false,
      },
    ],
  };
  const analysis = {
    summary:
      "The team decided to fix Wag Trails tracking before adding features.",
    candidates: [
      {
        kind: "decision",
        message_id: "def456",
        quote,
        importance: 0.9,
        confidence: 0.8,
        reason: "Explicit project decision",
      },
    ],
    thread,
    discarded_candidates: 0,
    memory_written: false,
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
      `window.__requests=[];window.__sends=0;window.__memories=0;window.__approved=false;window.__denied=false;const thread=${JSON.stringify(thread)},analysis=${JSON.stringify(analysis)};const routes=${JSON.stringify({ "/api/config": { mode: "demo", configured: true }, "/api/dashboard": dashboard, "/api/priorities": { version: "priority-v1", evaluated_at: new Date().toISOString(), items: [], excluded: [], warnings: [] }, "/api/gmail/status": { configured: true, connected: true, writable: true, connection_id: connection, account: "fixture@example.com" } })};const original=fetch.bind(window);window.fetch=async(input,options={})=>{const url=new URL(typeof input==='string'?input:input.url,location.origin);if(!url.pathname.startsWith('/api/'))return original(input,options);const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});if(url.pathname==='/api/actions/request'){const raw=JSON.parse(options.body);window.__requests.push(raw);if(raw.tool==='gmail.search')return window.__denied?json({error:'Gmail access denied'},403):json({result:{connection_id:thread.connection_id,threads:[{id:thread.id,snippet:'Wag Trails tracking decision'}],next_page:null}});if(raw.tool==='gmail.read')return json({result:thread});if(raw.tool==='gmail.summarize')return json({action_id:${JSON.stringify(analysisId)},result:analysis});if(raw.tool==='gmail.draft')return json({action_id:${JSON.stringify(draftId)},result:{subject:'Re: Wag Trails tracking',body:'Thanks for confirming the tracking priority.',source_thread_id:thread.id,connection_id:thread.connection_id,from_account:thread.account}});window.__pending=raw;if(!window.__approved)return json({code:'approval_required',action_id:'fixture-approval',tool:raw.tool,error:'Approval required'},409);window.__approved=false;if(raw.tool==='gmail.evidence'){window.__memories++;return json({result:{memory_id:'fixture-memory',recovered:false}});}window.__sends++;return json({result:{message_id:'fed1',thread_id:'fed2',recovered:false}});}if(url.pathname==='/api/permissions/attempts/fixture-approval')return json({id:'fixture-approval',tool_name:window.__pending.tool,input:{action_request:window.__pending},metadata:{request_envelope:window.__pending}});if(url.pathname.endsWith('/review')){window.__approved=JSON.parse(options.body).decision==='approved';return json({});}return json(routes[url.pathname]||{});};`,
    );
    run(
      "--init-script",
      init,
      "open",
      process.env.GMAIL_TEST_URL || "http://127.0.0.1:3000/",
    );
    run("set", "viewport", "1440", "1100");
    run("snapshot", "-i");
    click("Open Priority Intelligence ↗");
    run("snapshot", "-i");
    click("Communications");
    wait(`document.querySelector('[aria-label="Ary Communications"]')`);
    run("snapshot", "-i");
    click("Find context");
    wait(
      `document.querySelector('[aria-label="Relevant conversations"] button')`,
    );
    run("snapshot", "-i");
    run(
      "find",
      "role",
      "button",
      "click",
      "--name",
      "Wag Trails tracking decision Open conversation →",
    );
    wait(
      `document.querySelector('[aria-label="Ary Communications"]').textContent.includes('Alex <alex@example.com>')`,
    );
    check(
      "source conversation and canonical project context",
      evaluate(
        `document.querySelector('[aria-label="Ary Communications"]').textContent.includes('project · Wag Trails')&&!document.querySelector('iframe')`,
      ),
    );
    run("snapshot", "-i");
    click("Understand conversation");
    wait(`document.querySelector('[aria-label="Ary email summary"]')`);
    check(
      "summary and attributed evidence proposal without permanent memory",
      evaluate(
        `window.__memories===0&&window.__sends===0&&document.querySelector('[aria-label="Ary email summary"]').textContent.includes('Source message def456')`,
      ),
    );
    run("screenshot", "/tmp/ary-gmail-understanding.png");
    run("snapshot", "-i");
    click("Review for memory");
    wait(`document.querySelector('dialog[open]')`);
    check(
      "memory capture requires separate approval",
      evaluate(`window.__memories===0`),
    );
    run("snapshot", "-i");
    click("Approve once and continue");
    wait(`document.body.innerText.includes('Reviewed email evidence saved')`);
    check(
      "only selected evidence was captured",
      evaluate(
        `window.__memories===1&&window.__requests.filter(r=>r.tool==='gmail.evidence').every(r=>r.input.quote===${JSON.stringify(quote)})`,
      ),
    );
    click("Prepare draft");
    wait(`document.querySelector('[aria-label="Proposed email draft"]')`);
    run("snapshot", "-i");
    check(
      "drafting never sends and recipients start empty",
      evaluate(
        `window.__sends===0&&document.querySelector('[aria-label="Proposed email draft"] input').value===''`,
      ),
    );
    run(
      "find",
      "label",
      "To — email addresses, comma separated",
      "fill",
      "alex@example.com",
    );
    run(
      "find",
      "label",
      "Message",
      "fill",
      "I reviewed the tracking decision. Thank you.",
    );
    click("Review and send");
    wait(`document.querySelector('dialog[open]')`);
    run("snapshot", "-i");
    check(
      "approval displays exact recipients and edited text",
      evaluate(
        `document.querySelector('dialog[open]').textContent.includes('From: fixture@example.com')&&document.querySelector('dialog[open]').textContent.includes('alex@example.com')&&document.querySelector('dialog[open]').textContent.includes('I reviewed the tracking decision. Thank you.')&&window.__sends===0`,
      ),
    );
    run("screenshot", "/tmp/ary-gmail-approval.png");
    click("Reject");
    wait(`!document.querySelector('dialog[open]')`);
    check(
      "rejection does not send",
      evaluate(
        `window.__sends===0&&document.body.innerText.includes('Action rejected')`,
      ),
    );
    click("Review and send");
    wait(`document.querySelector('dialog[open]')`);
    run("snapshot", "-i");
    click("Approve once and continue");
    wait(`document.body.innerText.includes('GMAIL ACCEPTED')`);
    check(
      "one approved send renders provider receipt and sent stage",
      evaluate(
        `window.__sends===1&&document.querySelector('[aria-current="step"]').textContent.includes('Sent')&&document.body.innerText.includes('Message fed1')`,
      ),
    );
    check(
      "send uses operation key and durable source draft",
      evaluate(
        `window.__requests.filter(r=>r.tool==='gmail.send').every(r=>r.input.operation_id&&r.request_key&&r.input.draft_action_id===${JSON.stringify(draftId)}&&r.input.source_thread_id==='abc123')`,
      ),
    );
    run("set", "media", "reduced-motion");
    run("set", "viewport", "390", "844");
    check(
      "mobile view stays within viewport",
      evaluate(
        `document.querySelector('[aria-label="Ary Communications"]').getBoundingClientRect().right<=innerWidth+1&&document.documentElement.scrollWidth<=innerWidth+1`,
      ),
    );
    check(
      "reduced motion disables content entrance animation",
      evaluate(
        `getComputedStyle(document.querySelector('[aria-label="Proposed email draft"]')).animationName==='none'`,
      ),
    );
    evaluate(`window.__denied=true;true`);
    click("Find context");
    wait(`document.body.innerText.includes('Gmail access denied')`);
    check(
      "denied search clears previous email context",
      evaluate(
        `!document.querySelector('[aria-label="Proposed email draft"]')&&document.querySelector('[aria-label="Relevant conversations"]').children.length===0`,
      ),
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
