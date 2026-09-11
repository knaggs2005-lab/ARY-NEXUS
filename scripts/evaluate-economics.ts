/** Browser fixtures use real RoiService calculations; no live financial assessments are written. */
import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { LocalRepository } from "../src/infrastructure/repositories/local";
import { ActionService } from "../src/services/action-service";
import { RoiService } from "../src/services/roi-service";
async function main() {
  const dir = await mkdtemp(join(tmpdir(), "ary-economics-")),
    session = `ary-economics-${process.pid}`,
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
  try {
    const repo = new LocalRepository(randomUUID(), join(dir, "db.json")),
      actions = new ActionService(repo),
      roi = new RoiService(repo),
      month = new Date().toISOString().slice(0, 7);
    await actions.run("memory.read", null, async () => {});
    const a = (await repo.list("actions"))[0],
      o = (await repo.list("outcomes"))[0];
    const cost = {
      action_id: a.id,
      parent_id: null,
      estimated_compute_cost_usd: null,
      actual_model_cost_usd: 2,
      additional_compute_cost_usd: 3,
      tool_cost_usd: 5,
      confidence: 1,
      attribution_notes: "Synthetic cost fixture",
      evidence: "fixture:bill",
    };
    const entry = await roi.recordCost(cost);
    await roi.recordOutcome({
      outcome_id: o.id,
      parent_id: null,
      effective_at: new Date().toISOString(),
      time_saved_minutes: 90,
      revenue_influenced_usd: 100,
      expense_avoided_usd: 20,
      status: "confirmed",
      confidence: 1,
      attribution_notes: "Synthetic, non-overlapping impact",
      evidence: "fixture:measurement",
    });
    const first = await roi.report(month);
    await roi.recordCost({
      ...cost,
      parent_id: entry.id,
      actual_model_cost_usd: 4,
    });
    const changed = await roi.report(month);
    await actions.run("entity.read", null, async () => {});
    const partial = await roi.report(month);
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
    const init = join(dir, "init.js");
    await writeFile(
      init,
      `window.__economicsReport=0;window.__metricAnimations=[];window.__writes=0;const reports=${JSON.stringify([first, changed, partial])};const original=fetch.bind(window);window.fetch=async(input,options={})=>{const url=new URL(typeof input==='string'?input:input.url,location.origin);if(!url.pathname.startsWith('/api/'))return original(input,options);const json=(v,status=200)=>new Response(JSON.stringify(v),{status,headers:{'Content-Type':'application/json'}});if(options.method&&options.method!=='GET'){window.__writes++;return json({},500)}if(url.pathname==='/api/roi')return window.__deny?json({error:'Economics access denied'},403):json(reports[window.__economicsReport]);const routes=${JSON.stringify({ "/api/config": { mode: "demo", configured: true }, "/api/dashboard": dashboard, "/api/priorities": { version: "priority-v1", evaluated_at: new Date().toISOString(), items: [], excluded: [], warnings: [] } })};return json(routes[url.pathname]||{});};const native=Element.prototype.animate;Element.prototype.animate=function(...args){if(this.matches('[data-metric]'))window.__metricAnimations.push(this.dataset.metric);return native.apply(this,args);};`,
    );
    run(
      "--init-script",
      init,
      "open",
      process.env.ECONOMICS_TEST_URL || "http://127.0.0.1:3000/",
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
    run("find", "role", "button", "click", "--name", "ROI", "--exact");
    wait(`document.querySelector('[data-metric="Operating cost"] strong')`);
    const metric = (name: string) =>
      evaluate(
        `document.querySelector('[data-metric="${name}"] strong').textContent`,
      );
    check(
      "recorded operating cost combines three non-overlapping categories",
      metric("Operating cost") === "$10.00",
    );
    check(
      "time is shown without monetization",
      metric("Time saved") === "1.5 hours",
    );
    check(
      "correct net and ROI",
      metric("Monthly net contribution") === "$110.00" &&
        metric("ROI multiple") === "12.00×",
    );
    check(
      "unknown trend periods remain gaps",
      evaluate(
        `document.querySelector('svg[aria-label^="Recorded monthly"]').textContent.includes('Unknown')`,
      ),
    );
    check(
      "attribution confidence and status visible",
      evaluate(
        `document.body.innerText.includes('1 confirmed')&&document.body.innerText.includes('100%')`,
      ),
    );
    run("screenshot", "/tmp/ary-economics-dashboard.png");
    evaluate(`window.__economicsReport=1;true`);
    run("find", "role", "button", "click", "--name", "View month");
    wait(
      `document.querySelector('[data-metric="Operating cost"] strong').textContent==='$12.00'`,
    );
    check(
      "refresh updates exact values without reload",
      metric("ROI multiple") === "10.00×" &&
        evaluate(`performance.getEntriesByType('navigation').length===1`),
    );
    check(
      "metric changes animate without counting intermediate money",
      evaluate(`window.__metricAnimations.includes('Operating cost')`),
    );
    run("set", "media", "reduced-motion");
    evaluate(`window.__metricAnimations=[];window.__economicsReport=0;true`);
    run("find", "role", "button", "click", "--name", "View month");
    wait(
      `document.querySelector('[data-metric="Operating cost"] strong').textContent==='$10.00'`,
    );
    check(
      "reduced motion disables metric animations",
      evaluate(`window.__metricAnimations.length===0`),
    );
    evaluate(`window.__economicsReport=2;true`);
    run("find", "role", "button", "click", "--name", "View month");
    wait(
      `document.body.innerText.includes('Net contribution and ROI are withheld')`,
    );
    check(
      "partial costs withhold ROI",
      metric("ROI multiple") === "Not available",
    );
    run("set", "viewport", "390", "844");
    check(
      "mobile screen fits viewport",
      evaluate(
        `document.querySelector('[aria-label="Ary Economics"]').getBoundingClientRect().right<=innerWidth+1`,
      ),
    );
    evaluate(`window.__deny=true;true`);
    run("find", "role", "button", "click", "--name", "View month");
    wait(`document.body.innerText.includes('Economics access denied')`);
    check(
      "denial clears prior report",
      evaluate(`!document.querySelector('[data-metric]')`),
    );
    check("no live business writes", evaluate(`window.__writes===0`));
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
