/** Isolated client integration test. Fixtures come from the real priority read service. */
import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { LocalRepository } from "../src/infrastructure/repositories/local";
import { PriorityService } from "../src/services/priority-service";
async function main() {
  const directory = await mkdtemp(join(tmpdir(), "ary-priority-ui-"));
  const session = `ary-priority-${process.pid}`,
    cli = resolve("node_modules/.bin/agent-browser");
  const run = (...args: string[]) =>
    execFileSync(cli, ["--session", session, ...args], {
      encoding: "utf8",
      timeout: 40000,
    });
  const evaluate = (code: string) => JSON.parse(run("eval", code).trim());
  const waitFor = (code: string) =>
    evaluate(
      `new Promise((resolve,reject)=>{const start=Date.now();const tick=()=>{if(${code})resolve(true);else if(Date.now()-start>15000)reject(new Error('Timed out'));else setTimeout(tick,60)};tick()})`,
    );
  const results: { name: string; passed: true }[] = [];
  const check = (name: string, value: unknown) => {
    if (!value) throw new Error(name);
    results.push({ name, passed: true });
  };
  try {
    const repo = new LocalRepository(randomUUID(), join(directory, "db.json"));
    const p = await repo.insert("entities", {
      entity_type: "project",
      name: "Fixture project",
      description: "Browser test only",
      metadata: {},
    });
    const t = (title: string, priority: number, due_at: string | null) =>
      repo.insert("tasks", {
        title,
        priority,
        due_at,
        description: "Fixture",
        entity_id: p.id,
        goal_id: null,
        status: "pending",
        metadata: {},
      });
    const a = await t("Fixture urgent work", 3, null),
      b = await t("Fixture dated work", 0, "2026-09-27T12:00:00Z");
    const report = await new PriorityService(repo).report(
      new Date("2026-09-07T12:00:00Z"),
    );
    const dashboard = {
      reflectionDev: false,
      memories: [],
      memoryRecords: [],
      conflicts: [],
      jobs: [],
      aliases: [],
      graph: { nodes: [p], edges: [] },
      conversations: [],
      goals: [],
      decisions: [],
      tasks: [a, b],
      actions: [],
      outcomes: [],
      mode: "demo",
      provider: "test fixture",
      embeddingModel: "test fixture",
    };
    const init = join(directory, "init.js");
    await writeFile(
      init,
      `window.__priorityReads=0;window.__priorityWrites=0;window.__rankAnimations=[];
 const originalFetch=window.fetch.bind(window);
 window.fetch=async(input,options={})=>{const url=new URL(typeof input==='string'?input:input.url,location.origin);
 if(!url.pathname.startsWith('/api/'))return originalFetch(input,options);
 if((options.method||'GET')!=='GET'){window.__priorityWrites++;return new Response('{}',{status:500})}
 const routes=${JSON.stringify({ "/api/config": { mode: "demo", configured: true }, "/api/dashboard": dashboard, "/api/priorities": report })};
 if(url.pathname==='/api/priorities'){window.__priorityReads++;if(window.__priorityFail)return new Response(JSON.stringify({error:'Evidence access denied'}),{status:403,headers:{'content-type':'application/json'}});}
 return new Response(JSON.stringify(routes[url.pathname]||{error:'Unexpected fixture request'}),{status:routes[url.pathname]?200:404,headers:{'content-type':'application/json'}})};
 const animate=Element.prototype.animate;
 Element.prototype.animate=function(...args){if(this.matches('[data-priority-id]'))window.__rankAnimations.push(args[1]);return animate.apply(this,args)};
 `,
    );
    run(
      "--init-script",
      init,
      "open",
      process.env.PRIORITY_TEST_URL || "http://127.0.0.1:3000/",
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
    waitFor(`document.querySelector('[data-priority-id]')`);
    const first = () =>
      evaluate(
        `document.querySelector('[data-priority-id]').dataset.priorityId`,
      );
    check("canonical task initially ranks first", first() === `task:${a.id}`);
    run("find", "text", "Scoring policy & what-if planning", "click");
    // Native range setter + input event are the same React-controlled input path.
    evaluate(
      `const slider=document.querySelector('input[aria-label="Deadline emphasis"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(slider,'2');slider.dispatchEvent(new Event('input',{bubbles:true}));true`,
    );
    waitFor(
      `document.querySelector('[data-priority-id]').dataset.priorityId==='task:${b.id}'`,
    );
    check("evidence weighting reorders ranks without a navigation", true);
    check(
      "rank movement animates",
      evaluate(`window.__rankAnimations.length>0`),
    );
    check(
      "what-if label is explicit",
      evaluate(`document.body.innerText.includes('WHAT-IF PREVIEW')`),
    );
    check(
      "unknown revenue stays unknown",
      evaluate(`document.body.innerText.includes('3 revenue unassessed')`),
    );
    run("find", "role", "button", "click", "--name", "Deadline order");
    check(
      "deadline view retains canonical rows",
      evaluate(`document.querySelectorAll('[data-priority-id]').length===3`),
    );
    run("set", "media", "reduced-motion");
    evaluate(`window.__rankAnimations=[];true`);
    run("find", "role", "button", "click", "--name", "Reset preview");
    run("find", "role", "button", "click", "--name", "Priority order");
    check(
      "reduced motion disables reorder animation",
      evaluate(`window.__rankAnimations.length===0`),
    );
    run("find", "role", "button", "click", "--name", "Refresh evidence");
    waitFor(`window.__priorityReads>=2`);
    check(
      "refresh stays within the page",
      evaluate(`performance.getEntriesByType('navigation').length===1`),
    );
    check(
      "no business mutation requests",
      evaluate(`window.__priorityWrites===0`),
    );
    check(
      "no duplicate or modified tasks",
      (await repo.list("tasks")).length === 2 &&
        (await repo.get("tasks", a.id))?.priority === 3,
    );
    evaluate(`window.__priorityFail=true;true`);
    run("find", "role", "button", "click", "--name", "Refresh evidence");
    waitFor(`document.body.innerText.includes('Evidence access denied')`);
    check(
      "denied refresh clears prior evidence",
      evaluate(`document.querySelectorAll('[data-priority-id]').length===0`),
    );
    const errors = run("errors").trim();
    check("no browser errors", !errors);
    console.log(
      JSON.stringify({ results, fixtureOnly: true, errors }, null, 2),
    );
  } finally {
    try {
      run("close");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
