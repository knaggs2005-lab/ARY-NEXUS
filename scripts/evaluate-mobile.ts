/** Disposable mobile-sized browser + real local Brain, capture, mission and approval workflow. */
import { execFileSync, spawn } from "node:child_process";
import {
  cp,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
async function main() {
  const root = process.cwd(),
    dir = await mkdtemp(join(tmpdir(), "ary-mobile-e2e-")),
    session = `mobile-${process.pid}`;
  const cli = resolve("node_modules/.bin/agent-browser");
  const run = (...args: string[]) =>
    execFileSync(cli, ["--session", session, ...args], {
      encoding: "utf8",
      timeout: 45000,
    });
  const evaluate = (code: string) => JSON.parse(run("eval", code).trim());
  const wait = (condition: string) =>
    evaluate(
      `new Promise((resolve,reject)=>{const start=Date.now();const tick=()=>{if(${condition})resolve(true);else if(Date.now()-start>25000)reject(Error('Timed out'));else setTimeout(tick,100)};tick()})`,
    );
  const click = (name: string) => {
    run("snapshot", "-i");
    run("find", "role", "button", "click", "--name", name, "--exact");
  };
  let server: ReturnType<typeof spawn> | undefined,
    log = "";
  try {
    for (const file of [
      "src",
      "public",
      "package.json",
      "tsconfig.json",
      "next-env.d.ts",
    ])
      await cp(join(root, file), join(dir, file), { recursive: true });
    await symlink(join(root, "node_modules"), join(dir, "node_modules"));
    server = spawn(
      process.execPath,
      [
        join(root, "node_modules/next/dist/bin/next"),
        "dev",
        "--webpack",
        "--hostname",
        "127.0.0.1",
        "--port",
        "0",
      ],
      {
        cwd: dir,
        env: {
          PATH: process.env.PATH,
          TMPDIR: process.env.TMPDIR,
          NODE_ENV: "development",
          ARY_STORAGE: "demo",
          ARY_LLM_PROVIDER: "mock",
          ARY_EMBEDDING_PROVIDER: "local",
          ARY_REFLECTION_ENABLED: "false",
          NEXT_TELEMETRY_DISABLED: "1",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    server.stdout?.on("data", (b) => (log += b));
    server.stderr?.on("data", (b) => (log += b));
    const started = Date.now();
    while (!log.includes("Ready in")) {
      if (server.exitCode !== null || Date.now() - started > 60000)
        throw Error(log);
      await new Promise((r) => setTimeout(r, 100));
    }
    const url = log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
    assert.ok(url);
    await (await fetch(url)).text();
    await (await fetch(url + "/mobile")).text();
    await (await fetch(url + "/api/dashboard?surface=mobile")).text();
    run("set", "viewport", "390", "844");
    run("open", url);
    wait(`document.querySelector('[aria-label="ARY mobile companion"]')`);
    assert.ok(evaluate(`location.pathname === '/mobile'`));
    assert.ok(evaluate(`document.documentElement.scrollWidth <= 390`));
    assert.equal(
      evaluate(
        `document.querySelectorAll('[aria-label="Mobile destinations"] button').length`,
      ),
      5,
    );
    run("screenshot", "/tmp/ary-mobile-home.png");
    const api = (path: string, body?: unknown) =>
      evaluate(
        `(async()=>{const r=await fetch('/api/'+${JSON.stringify(path)},${JSON.stringify(body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })});return {status:r.status,body:await r.json()};})()`,
      );
    const boot = api("dashboard?surface=mobile");
    assert.equal(boot.status, 200);
    assert.deepEqual(boot.body.memories, []);
    assert.deepEqual(boot.body.actions, []);
    const project = boot.body.graph.nodes.find(
      (n: { entity_type: string }) => n.entity_type === "project",
    );
    assert.ok(project);
    run(
      "find",
      "label",
      "Message Ary",
      "fill",
      "Remember: My mobile launch review is on Thursday.",
    );
    click("Send to Ary");
    wait(
      `document.body.innerText.includes('Here is the stored context') || document.body.innerText.includes('I did not find a relevant')`,
    );
    click("Capture");
    run(
      "find",
      "label",
      "Quick capture",
      "fill",
      "Mobile field note: review the location release before the next studio session.",
    );
    click("Review & save capture");
    wait(`document.body.innerText.includes('Approve once and continue')`);
    click("Approve once and continue");
    wait(`document.body.innerText.includes('Captured in Ary memory')`);
    const fixture = JSON.parse(
      await readFile(join(dir, ".data/demo.json"), "utf8"),
    );
    assert.equal(
      fixture.memories.filter((m: { content: string }) =>
        m.content.startsWith("Mobile field note:"),
      ).length,
      1,
    );
    click("Camera or image input");
    wait(`document.querySelector('[aria-label="Ary Perception"]')`);
    assert.equal(
      evaluate(
        `document.querySelector('[aria-label="Ary Perception"] select').options.length`,
      ),
      2,
    );
    assert.equal(evaluate(`document.querySelectorAll('video').length`), 0);
    click("Close camera input");
    const create = {
      tool: "create_task",
      input: { title: "Mobile approval acceptance", project_id: project.id },
      reason: "Isolated mobile owner approval test",
      request_key: "mobile-browser-create-task",
    };
    const pending = api("actions/request", create);
    assert.equal(pending.status, 409);
    click("Updates");
    run("press", "Tab");
    // Refresh from the existing event path, then review through the same shared dialog.
    evaluate(`window.dispatchEvent(new Event('ary:action-settled')); true`);
    wait(
      `document.body.innerText.includes('Mobile owner approval test') || document.body.innerText.includes('Isolated mobile owner approval test')`,
    );
    click("Inspect approval");
    wait(`document.body.innerText.includes('Approve once and continue')`);
    click("Approve once and continue");
    wait(`document.body.innerText.includes('Nothing awaiting your review')`);
    const executed = api("actions/request", create);
    assert.equal(executed.status, 201);
    const afterTask = JSON.parse(
      await readFile(join(dir, ".data/demo.json"), "utf8"),
    );
    assert.equal(
      afterTask.tasks.filter(
        (t: { title: string }) => t.title === create.input.title,
      ).length,
      1,
    );
    const mission = api("actions/request", {
      tool: "mission.create",
      request_key: "mobile-browser-mission",
      reason: "Owner requested a disposable mobile mission",
      input: {
        goal: "Review mobile readiness",
        spec: {
          title: "Mobile readiness",
          questions: [],
          steps: [
            {
              id: "observe",
              title: "Inspect synthetic workspace",
              tool: "mock.observe",
              input: {},
              depends_on: [],
              critical: true,
              missing: [],
              source_action_from: null,
              verification: null,
            },
          ],
        },
      },
    });
    assert.equal(mission.status, 201);
    click("Missions");
    wait(`document.body.innerText.includes('Review mobile readiness')`);
    assert.ok(evaluate(`document.body.innerText.includes('DRAFT')`));
    click("plan");
    wait(`document.body.innerText.includes('PLANNING')`);
    click("Process checkpoint");
    wait(`document.body.innerText.includes('READY')`);
    click("Nexus");
    wait(
      `document.querySelector('[aria-label="Connected entity neighborhood"]')`,
    );
    assert.ok(
      evaluate(
        `document.querySelectorAll('svg [role="button"]').length > 0 && document.querySelectorAll('svg [role="button"]').length <= 18`,
      ),
    );
    run("screenshot", "/tmp/ary-mobile-nexus.png");
    click("memory");
    run(
      "find",
      "label",
      "What should Ary remember?",
      "fill",
      "Mobile field note studio session",
    );
    click("Search memory");
    wait(`document.body.innerText.includes('Mobile field note:')`);
    click("Open mobile command interface");
    wait(`document.querySelector('[aria-label="Search Ary commands"]')`);
    run("press", "Escape");
    run("set", "media", "dark", "reduced-motion");
    click("Ary");
    assert.equal(
      evaluate(`matchMedia('(prefers-reduced-motion: reduce)').matches`),
      true,
    );
    run("screenshot", "/tmp/ary-mobile-reduced.png");
    run("set", "offline", "on");
    wait(`document.body.innerText.includes('Nothing is queued automatically')`);
    run("set", "offline", "off");
    assert.equal(api("config").status, 200);
    const manifest = evaluate(
      `(async () => (await fetch("/mobile/manifest.webmanifest")).json())()`,
    );
    assert.equal(manifest.start_url, "/mobile");
    assert.equal(
      evaluate(`document.querySelector('[data-nextjs-dialog]') === null`),
      true,
    );
    // Desktop remains available on the same build.
    run("set", "viewport", "1280", "900");
    run("open", url + "/?systems=1");
    wait(`document.querySelector('[aria-label="Primary destinations"]')`);
    const errors = run("errors").trim();
    assert.ok(!errors, errors);
    console.log(
      JSON.stringify(
        {
          passed: true,
          checks: [
            "phone root routing",
            "390px layout without overflow",
            "five mobile destinations",
            "bounded startup data",
            "shared Brain text conversation",
            "reviewed real local quick capture",
            "mobile camera choices without activation",
            "shared detailed task approval",
            "task idempotent replay",
            "durable mission visibility and plan transition",
            "bounded real spatial graph",
            "semantic memory recall",
            "shared mobile command interface",
            "reduced motion",
            "offline no replay",
            "install manifest",
            "desktop preserved",
            "no browser errors",
          ],
          external_effects: false,
        },
        null,
        2,
      ),
    );
  } catch (e) {
    await writeFile("/tmp/ary-mobile-server.log", log);
    try {
      run("screenshot", "/tmp/ary-mobile-failure.png");
      console.error(run("snapshot"));
    } catch {}
    throw e;
  } finally {
    try {
      run("close");
    } catch {}
    if (server && server.exitCode === null) {
      const closed = once(server, "close");
      server.kill("SIGTERM");
      await closed;
    }
    await rm(dir, { recursive: true, force: true });
    console.log("Mobile browser/server and all isolated fixtures removed.");
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
