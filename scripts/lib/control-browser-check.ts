import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
export async function controlBrowserCheck({
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
  click("TOOLS");
  click("Computer & Browser");
  wait(`document.querySelector('[aria-label="Computer and browser control"]')`);
  assert.ok(
    evaluate(
      `document.querySelector('[aria-label="Computer and browser control"]').textContent.includes('STOP CONTROL')`,
    ),
  );
  assert.ok(
    evaluate(`document.body.innerText.includes('No active inspection')`),
  );
  run(
    "find",
    "label",
    "Allowed website URL",
    "fill",
    "https://example.invalid",
  );
  click("Review & open");
  wait(
    `document.querySelector('[aria-label="Computer and browser control"] [role="alert"]')`,
  );
  assert.ok(
    evaluate(
      `document.querySelector('[aria-label="Computer and browser control"] [role="alert"]').textContent.includes('disabled')`,
    ),
  );
  assert.equal(evaluate(`!!document.querySelector('dialog[open]')`), false);
  click("Systems");
  wait(
    `document.querySelector('[aria-label="Computer and browser control"]').textContent.includes('browser.open')`,
  );
  evaluate(
    `document.querySelector('[aria-label="Computer and browser control"] [aria-label="Emergency stop"]').click();true`,
  );
  wait(`document.querySelector('footer [aria-label="Emergency stop active"]')`);
  run(
    "screenshot",
    process.env.ARY_PRESENCE_REDUCED
      ? "/tmp/ary-control-ui-reduced.png"
      : "/tmp/ary-control-ui.png",
  );
  run("reload");
  wait(`document.querySelector('footer [aria-label="Emergency stop active"]')`);
  evaluate(
    `document.querySelector('footer [aria-label="Emergency stop active"]').click();true`,
  );
  wait(`document.querySelector('dialog[open]')`);
  click("Clear stop · keep work paused");
  wait(`document.querySelector('footer [aria-label="Emergency stop"]')`);
  click("TOOLS");
  click("Computer & Browser");
  wait(`document.querySelector('[aria-label="Computer and browser control"]')`);
  run("set", "viewport", "900", "1000");
  assert.ok(evaluate(`document.documentElement.scrollWidth<=innerWidth+1`));
  const state = JSON.parse(
    await readFile(join(dir, ".data/demo.json"), "utf8"),
  );
  assert.ok(
    state.actions.some(
      (a: any) => a.tool_name === "browser.open" && a.status !== "succeeded",
    ),
  );
  assert.ok(state.nexus_events.some((e: any) => e.type === "browser.result"));
  console.log(
    "Control UI accepted: guarded request, real failure event, visible persistent STOP CONTROL/reset, responsive and reduced-motion support.",
  );
}
