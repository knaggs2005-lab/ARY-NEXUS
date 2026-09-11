import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
export async function toolsBrowserCheck({
  run,
  evaluate,
  wait,
  click,
  dir,
}: {
  run: (...args: string[]) => string;
  evaluate: (code: string) => any;
  wait: (code: string) => any;
  click: (name: string) => void;
  dir: string;
}) {
  const baseline = JSON.parse(
    await readFile(join(dir, ".data/demo.json"), "utf8"),
  );
  run("press", "Meta+k");
  run("find", "label", "Search Ary commands", "fill", "Tools");
  run("press", "Enter");
  wait(`document.querySelector('[aria-label="Nexus Tools intelligence"]')`);
  wait(`document.querySelector('[aria-label="Capability results"] button')`);
  assert.equal(
    evaluate(
      `document.querySelector('[aria-label="Capability results"]').querySelectorAll('img').length`,
    ),
    0,
  );
  evaluate(
    `Array.from(document.querySelectorAll('[aria-label="Capability results"] button')).find(b=>b.querySelector('strong')?.textContent==='create_task').click();true`,
  );
  wait(
    `document.querySelector('[aria-label="Capability inspector"] h2')?.textContent==='create_task'`,
  );
  assert.ok(
    evaluate(
      `document.querySelector('[aria-label="Capability inspector"]').textContent.includes('Level 4')`,
    ),
  );
  run("find", "text", "Input / output schemas", "click");
  assert.ok(
    evaluate(
      `document.querySelector('[aria-label="Capability inspector"] pre').textContent.includes('title')`,
    ),
  );
  run("find", "label", "Find tools by meaning", "fill", "create a task");
  click("Discover");
  wait(`document.body.innerText.includes('reciprocal rank fusion')`);
  assert.ok(
    evaluate(
      `document.querySelector('[aria-label="Capability results"]').textContent.includes('create_task')`,
    ),
  );
  assert.ok(
    evaluate(
      `document.querySelector('[aria-label="Capability inspector"]').textContent.includes('Why matched')`,
    ),
  );
  run("screenshot", "/tmp/ary-tools-discovery.png");
  click("All capabilities");
  run("select", '[aria-label="Tool source"]', "mcp");
  wait(
    `document.querySelector('[aria-label="Capability results"]').textContent.includes('mcp.invoke')`,
  );
  evaluate(
    `Array.from(document.querySelectorAll('[aria-label="Capability results"] button')).find(b=>b.querySelector('strong')?.textContent==='mcp.invoke').click();true`,
  );
  assert.ok(
    evaluate(
      `document.querySelector('[aria-label="Capability inspector"]').textContent.includes('unconfigured')`,
    ),
  );
  run("select", '[aria-label="Tool availability"]', "offline");
  wait(`document.body.innerText.includes('No matching capabilities')`);
  run("select", '[aria-label="Tool availability"]', "");
  run("select", '[aria-label="Tool source"]', "");
  evaluate(
    `Array.from(document.querySelectorAll('[aria-label="Capability results"] button')).find(b=>b.querySelector('strong')?.textContent==='create_task').click();true`,
  );
  run("set", "viewport", "900", "1000");
  run("screenshot", "/tmp/ary-tools-compact.png");
  assert.ok(evaluate(`document.documentElement.scrollWidth<=innerWidth+1`));
  click("Review action");
  wait(
    `Array.from(document.querySelectorAll('select')).some(e=>e.value==='create_task')`,
  );
  const state = JSON.parse(
    await readFile(join(dir, ".data/demo.json"), "utf8"),
  );
  assert.ok(
    state.actions.some(
      (a: any) => a.tool_name === "tools.discover" && a.status === "succeeded",
    ),
  );
  assert.ok(
    !state.actions.some(
      (a: any) => a.tool_name.startsWith("mcp.") && a.status === "succeeded",
    ),
  );
  assert.deepEqual(
    state.tasks.map((t: any) => t.id),
    baseline.tasks.map((t: any) => t.id),
  );
  console.log(
    "Tools browser acceptance: real discovery HTTP, policy/schema inspector, honest MCP state, filters, existing action entry and responsive view passed",
  );
}
