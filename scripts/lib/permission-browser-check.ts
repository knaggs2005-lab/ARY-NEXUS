import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
export async function permissionBrowserCheck({
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
  const state = async () =>
    JSON.parse(await readFile(join(dir, ".data/demo.json"), "utf8"));
  const baseline = await state();
  click("System");
  click("Permissions & settings");
  wait(`document.querySelector('[aria-label="Permissions settings"]')`);
  wait(`document.querySelector('[aria-label="Mock action playground"]')`);
  click("Run mock action");
  wait(
    `document.querySelector('dialog[open] [aria-label="Approval explanation"]')`,
  );
  for (const label of [
    "What Ary wants to do",
    "Why",
    "Requested by",
    "Data and tool",
    "What could happen",
    "Can it be undone?",
  ])
    assert.ok(
      evaluate(
        `document.querySelector('dialog[open]').textContent.includes(${JSON.stringify(label)})`,
      ),
    );
  run("screenshot", "/tmp/ary-permission-approval.png");
  click("Reject");
  wait(`document.body.innerText.includes('Action rejected')`);
  click("Run mock action");
  wait(
    `document.querySelector('dialog[open] [aria-label="Approval explanation"]')`,
  );
  click("Approve once and continue");
  wait(`document.body.innerText.includes('Simulation completed')`);
  run("select", 'select[aria-label="Permission class"]', "EXECUTE");
  run("select", 'select[aria-label="Decision behavior"]', "deny");
  run("find", "label", "Reason", "fill", "Isolated browser execution freeze");
  click("Save policy");
  wait(`document.body.innerText.includes('Policy saved.')`);
  click("Run mock action");
  wait(
    `document.querySelector('[aria-label="Mock action playground"]').textContent.includes('not permitted')`,
  );
  assert.equal(evaluate(`!!document.querySelector('dialog[open]')`), false);
  // Disable the existing policy through its history-preserving UI.
  evaluate(
    `Array.from(document.querySelectorAll('article')).find(e=>e.textContent.includes('Isolated browser execution freeze')).querySelector('button:last-child').click();true`,
  );
  wait(`document.body.innerText.includes('Policy disabled')`);
  // Use the persistent shell control, then reload to prove it survives UI restart.
  evaluate(
    `document.querySelector('footer [aria-label="Emergency stop"]').click();true`,
  );
  wait(`document.querySelector('footer [aria-label="Emergency stop active"]')`);
  run("reload");
  wait(`document.querySelector('footer [aria-label="Emergency stop active"]')`);
  evaluate(
    `document.querySelector('footer [aria-label="Emergency stop active"]').click();true`,
  );
  wait(`document.querySelector('dialog[open]')`);
  run(
    "screenshot",
    process.env.ARY_PRESENCE_REDUCED
      ? "/tmp/ary-permission-stop-reduced.png"
      : "/tmp/ary-permission-stop.png",
  );
  click("Clear stop · keep work paused");
  wait(`document.querySelector('footer [aria-label="Emergency stop"]')`);
  // Existing real task path remains the only executor.
  run("press", "Meta+k");
  run("find", "label", "Search Ary commands", "fill", "create task");
  wait(
    `Array.from(document.querySelectorAll('[role="option"]')).some(e=>e.querySelector('strong')?.textContent==='create task')`,
  );
  evaluate(
    `Array.from(document.querySelectorAll('[role="option"]')).find(e=>e.querySelector('strong')?.textContent==='create task').click();true`,
  );
  wait(
    `Array.from(document.querySelectorAll('select')).some(e=>e.value==='create_task')`,
  );
  const project = baseline.entities.find(
    (e: any) => e.entity_type === "project",
  );
  run(
    "find",
    "label",
    "Inputs (JSON)",
    "fill",
    JSON.stringify({
      title: "Permission acceptance task",
      project_id: project.id,
      priority: 2,
    }),
  );
  click("Submit action request");
  wait(
    `Array.from(document.querySelectorAll('summary')).some(s=>s.textContent.includes('create_task')&&s.textContent.includes('approval_required'))`,
  );
  evaluate(
    `Array.from(document.querySelectorAll('summary')).find(s=>s.textContent.includes('create_task')&&s.textContent.includes('approval_required')).click();true`,
  );
  assert.equal((await state()).tasks.length, baseline.tasks.length);
  wait(`document.querySelector('[aria-label="Approval explanation"]')`);
  click("Approve and run");
  wait(`document.body.innerText.includes('Approved action completed.')`);
  const final = await state(),
    task = final.tasks.find(
      (t: any) => t.title === "Permission acceptance task",
    );
  assert.ok(task);
  assert.equal(final.tasks.length, baseline.tasks.length + 1);
  const action = final.actions.find(
    (a: any) => a.tool_name === "create_task" && a.status === "succeeded",
  );
  assert.ok(action);
  assert.ok(final.outcomes.some((o: any) => o.action_id === action.id));
  assert.ok(
    final.action_approvals.some(
      (a: any) => a.id === action.metadata.approval_id && a.consumed_at,
    ),
  );
  assert.ok(
    final.nexus_events.some((e: any) => e.type.startsWith("permission.")),
  );
  run("set", "viewport", "900", "1000");
  assert.ok(evaluate(`document.documentElement.scrollWidth <= innerWidth + 1`));
  run("screenshot", "/tmp/ary-permission-result.png");
  console.log(
    "Permission browser acceptance: explained rejection/one-use approval, class deny, persistent emergency stop/reset, approved real task, audit/outcome linkage and responsive layout passed",
  );
}
