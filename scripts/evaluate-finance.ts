/** Isolated UI fixtures. Every Ary API request is intercepted; no real financial data is imported. */
import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { LocalRepository } from "../src/infrastructure/repositories/local";
import { FinanceService } from "../src/services/finance-service";
async function main() {
  const dir = await mkdtemp(join(tmpdir(), "ary-finance-ui-")),
    session = `ary-finance-${process.pid}`,
    cli = resolve("node_modules/.bin/agent-browser");
  const run = (...args: string[]) =>
    execFileSync(cli, ["--session", session, ...args], {
      encoding: "utf8",
      timeout: 40000,
    });
  const evaluate = (s: string) => JSON.parse(run("eval", s).trim());
  const wait = (s: string) =>
    evaluate(
      `new Promise((resolve,reject)=>{const start=Date.now();function tick(){if(${s})resolve(true);else if(Date.now()-start>15000)reject(new Error('Timed out'));else setTimeout(tick,50)}tick()})`,
    );
  const click = (name: string) =>
    run("find", "role", "button", "click", "--name", name, "--exact");
  const results: string[] = [];
  const check = (name: string, v: unknown) => {
    if (!v) throw new Error(name);
    results.push(name);
  };
  const repo = new LocalRepository(randomUUID(), join(dir, "fixture.json")),
    finance = new FinanceService(repo);
  const project = await repo.insert("entities", {
    name: "Wag Trails",
    entity_type: "project",
    description: "Fixture",
    metadata: {},
  });
  const goal = await repo.insert("goals", {
    entity_id: project.id,
    title: "Finish tracking",
    description: "Fixture",
    status: "active",
    progress: 0,
    target_date: null,
    metadata: {},
  });
  const payload = {
    account: {
      name: "Operating cash",
      institution: "Fixture institution",
      currency: "USD",
      kind: "cash",
    },
    balance_minor: 100000,
    coverage: null,
    transactions: [],
    bills: [
      {
        source_id: "bill-1",
        name: "Hosting",
        amount_minor: 2500,
        next_due: "2026-09-20T00:00:00Z",
        frequency: "monthly",
      },
    ],
    holdings: [],
    holdings_complete: false,
    entity_ids: [project.id],
    goal_ids: [goal.id],
  };
  await finance.import({
    import_key: randomUUID(),
    account_key: "cash",
    parent_id: null,
    as_of: "2026-09-01T00:00:00Z",
    observed_at: "2026-09-01T00:00:00Z",
    source_label: "Earlier statement",
    source_reference: "fixture-aug.pdf page 1",
    payload,
  });
  await finance.import({
    import_key: randomUUID(),
    account_key: "cash",
    parent_id: null,
    as_of: "2026-09-07T00:00:00Z",
    observed_at: "2026-09-07T00:00:00Z",
    source_label: "Latest statement",
    source_reference: "fixture-sept.pdf page 1",
    payload: {
      ...payload,
      balance_minor: 90000,
      transactions: [
        {
          source_id: "tx-1",
          at: "2026-09-05T00:00:00Z",
          description: "Recorded hosting expense",
          kind: "expense",
          amount_minor: 10000,
          status: "posted",
          entity_id: project.id,
          goal_id: null,
        },
      ],
    },
  });
  const report = await finance.report({ as_of: "2026-09-07T00:00:00Z" });
  const dashboard = {
    reflectionDev: false,
    memories: [],
    memoryRecords: [],
    conflicts: [],
    jobs: [],
    aliases: [],
    graph: { nodes: [project], edges: [] },
    conversations: [],
    goals: [goal],
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
      `window.__imports=0;window.__approved=false;window.__denied=false;window.__requests=[];const report=${JSON.stringify(report)};const routes=${JSON.stringify({ "/api/config": { mode: "demo", configured: true }, "/api/dashboard": dashboard, "/api/priorities": { version: "priority-v1", evaluated_at: new Date().toISOString(), items: [], excluded: [], warnings: [] } })};const original=fetch.bind(window);window.fetch=async(input,options={})=>{const url=new URL(typeof input==='string'?input:input.url,location.origin);if(!url.pathname.startsWith('/api/'))return original(input,options);const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});if(url.pathname==='/api/actions/request'){const raw=JSON.parse(options.body);window.__requests.push(raw);if(raw.tool==='finance.read')return window.__denied?json({error:'Financial visibility denied'},403):json({result:report});window.__pending=raw;if(!window.__approved)return json({code:'approval_required',action_id:'fixture-approval',tool:raw.tool,error:'Approval required'},409);window.__approved=false;window.__imports++;return json({result:{snapshot_id:'fixture-new-source',recovered:false}});}if(url.pathname==='/api/permissions/attempts/fixture-approval')return json({id:'fixture-approval',tool_name:window.__pending.tool,input:{action_request:window.__pending},metadata:{request_envelope:window.__pending}});if(url.pathname.endsWith('/review')){window.__approved=JSON.parse(options.body).decision==='approved';return json({});}return json(routes[url.pathname]||{});};`,
    );
    run(
      "--init-script",
      init,
      "open",
      process.env.FINANCE_TEST_URL || "http://127.0.0.1:3000/",
    );
    run("set", "viewport", "1440", "1100");
    run("snapshot", "-i");
    click("Open Priority Intelligence ↗");
    run("snapshot", "-i");
    click("Finance");
    wait(`document.querySelector('[aria-label="USD recorded totals"]')`);
    run("snapshot", "-i");
    check(
      "recorded amounts and partial coverage shown",
      evaluate(
        `document.querySelector('[aria-label="USD recorded totals"]').textContent.includes('$900.00')&&document.querySelector('[aria-label="USD recorded totals"]').textContent.includes('Partial transaction coverage')`,
      ),
    );
    run("find", "role", "button", "click", "--name", "Operating cash");
    wait(`document.querySelector('[aria-label="Financial context"]')`);
    run("snapshot", "-i");
    click("Why did this change?");
    wait(`document.querySelector('[aria-label="Financial change evidence"]')`);
    check(
      "why shows both source statements without inferring causes",
      evaluate(
        `document.querySelector('[aria-label="Financial change evidence"]').textContent.includes('fixture-aug.pdf page 1')&&document.querySelector('[aria-label="Financial change evidence"]').textContent.includes('fixture-sept.pdf page 1')&&document.querySelector('[aria-label="Financial change evidence"]').textContent.includes('have not been inferred')`,
      ),
    );
    check(
      "source-linked transactions and explicit recurring bills",
      evaluate(
        `document.querySelector('[aria-label="Financial context"]').textContent.includes('tx-1')&&document.querySelector('[aria-label="Financial context"]').textContent.includes('Hosting · monthly')`,
      ),
    );
    check(
      "financial entity and goal relationship paths",
      evaluate(
        `document.querySelector('[aria-label="Financial relationships"]').textContent.includes('Wag Trails')&&document.querySelector('[aria-label="Financial relationships"]').textContent.includes('Finish tracking')&&document.querySelector('[aria-label="Financial relationships"] svg path')!==null`,
      ),
    );
    check(
      "historical balances have a timeline",
      evaluate(
        `document.querySelector('[aria-label="Financial timeline"]').textContent.includes('$1,000.00')&&document.querySelector('[aria-label="Financial timeline"]').textContent.includes('$900.00')`,
      ),
    );
    run("screenshot", "/tmp/ary-finance-evidence.png");
    click("Import statement");
    run("snapshot", "-i");
    for (const [label, value] of [
      ["Stable account key", "reviewed-account"],
      ["Account name", "Reviewed fixture account"],
      ["Institution", "Fixture bank"],
      ["Balance (blank means unknown)", "0.29"],
      ["Statement as of", "2026-09-07T00:00"],
      ["Source label", "Controlled fixture"],
      ["Source reference", "fixture.pdf page 1"],
    ])
      run("find", "label", label, "fill", value);
    // Native datetime-local controls do not accept the CLI text-fill path in this browser backend.
    evaluate(
      `(()=>{const input=document.querySelector('input[name="date"]');input.value='2026-09-07T00:00';input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));return input.checkValidity();})()`,
    );
    click("Preview source");
    wait(
      `document.querySelector('[aria-label="Financial statement import"] h4')`,
    );
    check(
      "decimal input preserves exact minor units in preview",
      evaluate(
        `window.__imports===0&&document.body.innerText.includes('$0.29')`,
      ),
    );
    click("Review and import");
    wait(`document.querySelector('dialog[open]')`);
    run("snapshot", "-i");
    check(
      "import approval shows account, source and amount",
      evaluate(
        `document.querySelector('[aria-label="Financial import review"]').textContent.includes('fixture.pdf page 1')&&document.querySelector('[aria-label="Financial import review"]').textContent.includes('$0.29')&&window.__imports===0`,
      ),
    );
    click("Reject");
    wait(`!document.querySelector('dialog[open]')`);
    check("rejection imports nothing", evaluate(`window.__imports===0`));
    click("Review and import");
    wait(`document.querySelector('dialog[open]')`);
    run("snapshot", "-i");
    click("Approve once and continue");
    wait(`document.body.innerText.includes('fixture-new-source')`);
    check(
      "approved import returns actual receipt field",
      evaluate(
        `window.__imports===1&&window.__requests.filter(r=>r.tool==='finance.import').every(r=>r.input.payload.balance_minor===29&&r.request_key)`,
      ),
    );
    run("set", "media", "reduced-motion");
    run("set", "viewport", "390", "844");
    check(
      "mobile has no horizontal page overflow",
      evaluate(`document.documentElement.scrollWidth<=innerWidth+1`),
    );
    check(
      "reduced motion disables relationship animation",
      evaluate(
        `getComputedStyle(document.querySelector('[aria-label="Financial relationships"] path')).animationName==='none'`,
      ),
    );
    evaluate(`window.__denied=true;true`);
    click("Refresh evidence");
    wait(`document.body.innerText.includes('Financial visibility denied')`);
    check(
      "denied refresh removes visible financial records",
      evaluate(
        `!document.querySelector('[aria-label="USD recorded totals"]')&&!document.querySelector('[aria-label="Financial context"]')`,
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
  } catch (error) {
    try {
      run("screenshot", "/tmp/ary-finance-ui-failure.png");
      await writeFile(
        "/tmp/ary-finance-ui-failure.txt",
        run("snapshot", "-i") + "\n" + run("eval", "document.body.innerText"),
      );
    } catch {}
    throw error;
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
