import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
export async function memoryBrowserCheck(opts: {
  run: (...args: string[]) => string;
  evaluate: (code: string) => any;
  wait: (code: string) => any;
  click: (name: string) => void;
  url: string;
  dir: string;
}) {
  const { run, evaluate, wait, click, url, dir } = opts;
  const state = async () =>
    JSON.parse(await readFile(join(dir, ".data/demo.json"), "utf8"));
  const open = () => {
    run("press", "Meta+k");
    run("find", "label", "Search Ary commands", "fill", "Memories");
    run("press", "Enter");
    wait(
      `Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Memory intelligence')`,
    );
    click("Memory intelligence");
    wait(`document.body.innerText.includes('What Ary remembers')`);
  };
  open();
  run("find", "text", "Capture classified memory", "click");
  run("select", "#memory-capture-class", "PROCEDURAL");
  run("find", "label", "Summary", "fill", "Export preparation acceptance");
  run(
    "find",
    "label",
    "Content",
    "fill",
    "Review the export preset before rendering the sequence",
  );
  click("Review capture");
  wait(`document.querySelector('dialog[open]')`);
  assert.ok(
    !(await state()).memories.some(
      (m: any) => m.summary === "Export preparation acceptance",
    ),
  );
  click("Approve once and continue");
  wait(`document.body.innerText.includes('Committed through permissions')`);
  const created = (await state()).memories.find(
    (m: any) => m.summary === "Export preparation acceptance",
  );
  assert.ok(created);
  assert.equal(created.metadata.nexus_memory.class, "PROCEDURAL");
  const action = (await state()).actions.find(
    (a: any) => a.tool_name === "memory.capture" && a.status === "succeeded",
  );
  assert.ok(action);
  assert.ok(
    (await state()).outcomes.some(
      (o: any) => o.action_id === action.id && o.status === "success",
    ),
  );
  click("Export preparation acceptance · PROCEDURAL · active");
  wait(
    `document.querySelector('[aria-label="Memory explanation"]')?.textContent.includes('Versions')||document.querySelector('[aria-label="Memory explanation"]')?.textContent.includes('versions:')`,
  );
  assert.ok(
    evaluate(
      `document.querySelector('[aria-label="Memory explanation"]').textContent.includes('confidence')`,
    ),
  );
  run("find", "label", "Explain relevance", "fill", "export preset rendering");
  click("Search context");
  wait(`document.body.innerText.includes('retrieval explanation')`);
  run(
    "screenshot",
    process.env.ARY_PRESENCE_REDUCED
      ? "/tmp/ary-memory-reduced.png"
      : "/tmp/ary-memory.png",
  );
  // Rejection retains the real task-independent memory record.
  click("Export preparation acceptance · PROCEDURAL · active");
  wait(`document.querySelector('[aria-label="Memory explanation"]')`);
  click("Review record deletion");
  wait(`document.querySelector('dialog[open]')`);
  click("Reject");
  wait(`document.body.innerText.includes('Action rejected')`);
  assert.ok((await state()).memories.some((m: any) => m.id === created.id));
  // A fresh inspection carries the current revision into approved deletion.
  click("Export preparation acceptance · PROCEDURAL · active");
  wait(`document.querySelector('[aria-label="Memory explanation"]')`);
  click("Review record deletion");
  wait(`document.querySelector('dialog[open]')`);
  click("Approve once and continue");
  wait(`document.body.innerText.includes('Committed through permissions')`);
  assert.ok(!(await state()).memories.some((m: any) => m.id === created.id));
  assert.ok(
    !(await state()).memory_sources.some(
      (s: any) => s.memory_id === created.id,
    ),
  );
  click("Knowledge");
  wait(
    `document.body.innerText.includes('Curated references are not automatically learned facts')`,
  );
  evaluate(
    `(()=>{const d=Array.from(document.querySelectorAll('details')).find(d=>d.querySelector('summary')?.textContent==='Add / revise curated knowledge');if(!d.open)d.querySelector('summary').click();return true})()`,
  );
  run(
    "find",
    "label",
    "Reference title",
    "fill",
    "Editorial reference acceptance",
  );
  run(
    "find",
    "label",
    "Content",
    "fill",
    "Use the approved editorial export standard",
  );
  run(
    "find",
    "label",
    "Source reference",
    "fill",
    "Owner supplied editorial manual, revision 1",
  );
  click("Review capture");
  wait(`document.querySelector('dialog[open]')`);
  click("Approve once and continue");
  wait(`document.body.innerText.includes('Committed through permissions')`);
  const knowledge = (await state()).knowledge_documents.find(
    (k: any) => k.title === "Editorial reference acceptance",
  );
  assert.ok(knowledge);
  assert.ok(
    !(await state()).memories.some((m: any) => m.content === knowledge.content),
  );
  run("reload");
  wait(`document.querySelector('[data-nexus-shell]')`);
  open();
  click("Knowledge");
  wait(`document.body.innerText.includes('Editorial reference acceptance')`);
  click("Editorial reference acceptance");
  assert.ok(
    evaluate(
      `document.body.innerText.includes('Owner supplied editorial manual')`,
    ),
  );
  run("set", "viewport", "900", "1000");
  assert.equal(
    evaluate(`document.documentElement.scrollWidth<=window.innerWidth+2`),
    true,
  );
  run("screenshot", "/tmp/ary-memory-compact.png");
  const response = await fetch(url + "/api/memories?q=editorial%20standard");
  assert.equal(response.status, 200);
  assert.ok(!(await response.json()).some((m: any) => m.id === knowledge.id));
  console.log(
    "Memory browser acceptance passed: classified capture, exact approval, real memory/evidence/outcome, relevance inspector, rejected deletion, approved deletion, separate Knowledge, reload persistence and responsive view.",
  );
}
