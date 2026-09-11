import { voiceSessionBrowserCheck } from "./lib/voice-session-browser-check";
import { controlBrowserCheck } from "./lib/control-browser-check";
import { permissionBrowserCheck } from "./lib/permission-browser-check";
import { toolsBrowserCheck } from "./lib/tools-browser-check";
import { intelligenceBrowserCheck } from "./lib/intelligence-browser-check";
import { memoryBrowserCheck } from "./lib/memory-browser-check";
/** Real browser → HTTP → approval → repository flow in a disposable, credential-free demo server. */
import { execFileSync, spawn } from "node:child_process";
import {
  cp,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { once } from "node:events";
import assert from "node:assert/strict";
import type { Entity, Task, Action, Outcome } from "../src/domain/models";
import type { StoredNexusEvent } from "../src/domain/nexus-events";
import type { ActionApproval } from "../src/domain/permissions";

async function main() {
  const root = process.cwd();
  const dir = await mkdtemp(join(tmpdir(), "ary-shell-e2e-"));
  const session = `shell-e2e-${process.pid}`;
  const cli = resolve("node_modules/.bin/agent-browser");
  const run = (...args: string[]) =>
    execFileSync(
      cli,
      [
        "--session",
        session,
        "--args",
        process.env.ARY_PRESENCE_GPU
          ? "--enable-unsafe-webgpu"
          : "--disable-gpu",
        ...args,
      ],
      {
        encoding: "utf8",
        timeout: 45000,
      },
    );
  const evaluate = (code: string) => JSON.parse(run("eval", code).trim());
  const wait = (condition: string) =>
    evaluate(
      `new Promise((resolve,reject)=>{const start=Date.now();const tick=()=>{if(${condition})resolve(true);else if(Date.now()-start>25000)reject(Error('Timed out: '+${JSON.stringify(condition)}));else setTimeout(tick,100)};tick()})`,
    );
  const click = (name: string) => {
    console.log(`Checking: ${name}`);
    run("snapshot", "-i");
    run("find", "role", "button", "click", "--name", name, "--exact");
  };
  let server: ReturnType<typeof spawn> | undefined;
  let serverLog = "";
  try {
    for (const file of [
      "src",
      "package.json",
      "tsconfig.json",
      "next-env.d.ts",
    ])
      await cp(join(root, file), join(dir, file), { recursive: true });
    await symlink(join(root, "node_modules"), join(dir, "node_modules"));
    // Read assets on demand; shell verification never needs to copy camera model binaries.
    await symlink(join(root, "public"), join(dir, "public"));
    console.log("Isolated shell fixture ready");
    // Port 0 allocates a free localhost port. No .env files or production data are copied.
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
    server.stdout?.on("data", (b) => {
      serverLog += b;
    });
    server.stderr?.on("data", (b) => {
      serverLog += b;
    });
    const start = Date.now();
    while (!serverLog.includes("Ready in")) {
      if (server.exitCode !== null || Date.now() - start > 60000)
        throw Error(serverLog);
      await new Promise((r) => setTimeout(r, 100));
    }
    const url = serverLog.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
    assert.ok(url, serverLog);
    run("set", "viewport", "1440", "1000");
    if (process.env.ARY_PRESENCE_REDUCED)
      run("set", "media", "reduced-motion", "reduce");
    run("open", url);
    run("snapshot", "-i");
    assert.equal(
      evaluate(
        `!!document.body.innerText.trim()&&!document.querySelector('[data-nextjs-dialog]')`,
      ),
      true,
    );
    const state = async () =>
      JSON.parse(await readFile(join(dir, ".data/demo.json"), "utf8")) as {
        entities: Entity[];
        tasks: Task[];
        actions: Action[];
        outcomes: Outcome[];
        action_approvals: ActionApproval[];
        nexus_events: StoredNexusEvent[];
      };
    wait(`document.querySelector('[aria-label="Open Ary command palette"]')`);
    wait(`document.querySelector('[data-nexus-shell]')`);
    assert.equal(evaluate(`!!document.querySelector('.sidebar')`), false);
    assert.equal(
      evaluate(
        `document.querySelectorAll('nav[aria-label="Primary destinations"] button').length`,
      ),
      11,
    );
    if (process.env.ARY_PRESENCE_REDUCED) {
      assert.equal(
        evaluate(`matchMedia("(prefers-reduced-motion: reduce)").matches`),
        true,
      );
      assert.equal(
        evaluate(
          `document.querySelector("[data-ary-presence] [data-gpu]").dataset.gpu`,
        ),
        "static",
      );
    }
    if (process.env.ARY_PRESENCE_GPU) {
      wait(
        `document.querySelector("canvas") && document.querySelector("[data-ary-presence] [data-gpu=active]")`,
      );
      run("screenshot", "/tmp/ary-presence-gpu-browser.png");
    }
    const project = (await state()).entities.find(
      (e) => e.entity_type === "project",
    );
    assert.ok(project);
    if (
      !process.env.ARY_VOICE_ONLY &&
      !process.env.ARY_CONTROL_ONLY &&
      !process.env.ARY_PERMISSIONS_ONLY &&
      !process.env.ARY_TOOLS_ONLY &&
      !process.env.ARY_WORLD_ONLY &&
      !process.env.ARY_AGENTS_ONLY &&
      !process.env.ARY_MEMORY_ONLY
    ) {
      // Observe real presence changes while using the existing Brain and action transports.
      evaluate(
        `window.__presenceStates=[];window.__presenceObserver=new MutationObserver(()=>document.querySelectorAll('[data-ary-presence]').forEach(e=>window.__presenceStates.push(e.dataset.aryPresence)));window.__presenceObserver.observe(document.body,{subtree:true,attributes:true,attributeFilter:['data-ary-presence']});true`,
      );
      run(
        "find",
        "label",
        "Message Ary",
        "fill",
        "What do you know about Ary Nexus memory?",
      );
      click("Send ↑");
      wait(`window.__presenceStates.includes('complete')`);
      if (!process.env.ARY_EVENTS_CHECK)
        assert.ok(
          evaluate(
            `window.__presenceStates.some(s=>['understanding','retrieving','thinking','remembering'].includes(s))`,
          ),
        );
      run("screenshot", "/tmp/ary-presence-chat.png");
      if (!process.env.ARY_PRESENCE_ONLY) {
        // Mode changes preserve the actual composer node and unsent input.
        run("find", "label", "Message Ary", "fill", "Keep this unsent thought");
        evaluate(
          `window.__composer=document.getElementById('chat-input');true`,
        );
        click("Ambient");
        assert.equal(
          evaluate(`document.querySelector('[data-nexus-shell]').dataset.mode`),
          "ambient",
        );
        assert.equal(
          evaluate(
            `document.getElementById('chat-input')===window.__composer&&window.__composer.value==='Keep this unsent thought'`,
          ),
          true,
        );
        run("screenshot", "/tmp/ary-shell-ambient.png");
        click("Systems");
        assert.equal(
          evaluate(`document.getElementById('chat-input')===window.__composer`),
          true,
        );
        click("Show context");
        assert.equal(
          evaluate(
            `getComputedStyle(document.querySelector('.retrieval-panel')).display!=='none'`,
          ),
          true,
        );
        click("Hide context");
        assert.equal(
          evaluate(
            `getComputedStyle(document.querySelector('.retrieval-panel')).display`,
          ),
          "none",
        );
        click("Open attention");
        wait(`document.querySelector('dialog[aria-label="Attention"][open]')`);
        assert.equal(evaluate(`document.activeElement.textContent`), "Close");
        run("press", "Escape");
        assert.equal(
          evaluate(`document.activeElement.getAttribute('aria-label')`),
          "Open attention",
        );
        // Every new primary destination renders an existing view or an honest capability boundary.
        for (const id of [
          "NEXUS",
          "ARY",
          "MISSIONS",
          "AGENTS",
          "MEMORY",
          "WORLD",
          "SKILLS",
          "TOOLS",
          "AUTOMATIONS",
          "ACTIVITY",
          "SYSTEM",
        ]) {
          evaluate(
            `Array.from(document.querySelectorAll('nav[aria-label="Primary destinations"] button')).find(b=>b.textContent===${JSON.stringify(id)}).click();true`,
          );
          wait(
            `document.querySelector('nav[aria-label="Primary destinations"] [aria-current="page"]')?.textContent===${JSON.stringify(id)}`,
          );
          assert.equal(
            evaluate(`!!document.querySelector('[data-nextjs-dialog]')`),
            false,
          );
        }
        click("Talk to Ary");
        wait(
          `document.querySelector('textarea[aria-label="Message Ary"]') || Array.from(document.querySelectorAll("label")).some(l => l.textContent?.includes("Message Ary"))`,
        );
        run("find", "label", "Message Ary", "fill", "");
        run("screenshot", "/tmp/ary-shell-stable.png");
        click("Ambient");
        click("Systems");
        console.log(
          run("diff", "screenshot", "--baseline", "/tmp/ary-shell-stable.png"),
        );
        // The native shell is now the default; the preserved orbit is an explicit destination.
        click("System");
        click("Open spatial navigation");
        assert.equal(
          evaluate(
            `document.querySelector('[aria-label="Existing Ary workspace"]').hidden`,
          ),
          true,
        );
        run("press", "Meta+k");
        wait(
          `document.querySelector('dialog[aria-label="Ary command palette"][open]')`,
        );
        assert.equal(
          evaluate(`document.activeElement.getAttribute('aria-label')`),
          "Search Ary commands",
        );
        assert.equal(
          evaluate(
            `document.querySelector('dialog[aria-label="Ary command palette"]').parentElement===document.body`,
          ),
          true,
        );
        run("find", "label", "Search Ary commands", "fill", "Projects");
        run("press", "Enter");
        wait(
          `!document.querySelector('[aria-label="Existing Ary workspace"]').hidden`,
        );
        assert.equal(
          evaluate(
            `document.querySelector('dialog[aria-label="Ary command palette"]').open`,
          ),
          false,
        );
      }
      run("press", "Meta+k");
      run("find", "label", "Search Ary commands", "fill", project.name);
      run("press", "Enter");
      wait(
        `document.activeElement.id===${JSON.stringify("entity-" + project.id)}`,
      );
      run("press", "Meta+k");
      run("find", "label", "Search Ary commands", "fill", "create task");
      wait(
        `document.querySelector('[role="option"]')?.textContent.includes('create task')`,
      );
      // Mouse chooses the same dispatcher, without submitting anything.
      run("snapshot", "-i");
      evaluate(
        `Array.from(document.querySelectorAll('[role="option"]')).find(e=>e.querySelector('strong')?.textContent==='create task').click();true`,
      );
      wait(
        `Array.from(document.querySelectorAll('select')).some(e=>e.value==='create_task')`,
      );
      const before = (await state()).tasks.length;
      run(
        "find",
        "label",
        "Inputs (JSON)",
        "fill",
        JSON.stringify({
          title: "Shell acceptance task",
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
      assert.equal((await state()).tasks.length, before);
      wait(`window.__presenceStates.includes('approval')`);
      run("screenshot", "/tmp/ary-presence-approval.png");
      click("Approve and run");
      wait(`document.body.innerText.includes('Approved action completed.')`);
      const created = (await state()).tasks.find(
        (t) => t.title === "Shell acceptance task",
      );
      assert.ok(created);
      run("press", "Meta+k");
      run(
        "find",
        "label",
        "Search Ary commands",
        "fill",
        "Shell acceptance task",
      );
      wait(
        `document.querySelector('[role="option"]')?.textContent.includes('Shell acceptance task')`,
      );
      run("press", "Enter");
      wait(
        `document.activeElement.id===${JSON.stringify("task-" + created.id)}`,
      );
      run("screenshot", "/tmp/ary-shell-task-receipt.png");
      const final = await state();
      const action = final.actions.find(
        (a) => a.tool_name === "create_task" && a.status === "succeeded",
      );
      assert.ok(action);
      assert.ok(final.outcomes.some((o) => o.action_id === action.id));
      assert.ok(
        final.action_approvals.some(
          (a) =>
            a.id === action.metadata.approval_id &&
            a.decision === "approved" &&
            !!a.consumed_at,
        ),
      );
      if (process.env.ARY_EVENTS_CHECK) {
        // Canonical records are real; only model answers are explicit local fixtures.
        const journal = final.nexus_events;
        for (const type of [
          "ary.understanding",
          "memory.retrieving",
          "ary.thinking",
          "tool.approval_required",
          "permission.approved",
          "tool.succeeded",
          "tool.outcome_recorded",
        ]) {
          assert.ok(
            journal.some((e) => e.type === type),
            `Missing ${type}`,
          );
        }
        const receipt = journal.find(
          (e) =>
            e.type === "tool.succeeded" && e.payload.record_id === action.id,
        );
        assert.ok(receipt);
        for (const key of [
          "id",
          "type",
          "timestamp",
          "source",
          "related_entity_id",
          "correlation_id",
          "mission_id",
          "severity",
          "visibility",
          "payload",
        ])
          assert.ok(key in receipt, key);
        click("Activity");
        wait(
          `document.querySelector('[aria-label="Nexus Activity inspector"]')`,
        );
        click("Systems");
        wait(
          `document.querySelector('[aria-label="Nexus Activity inspector"]')?.innerText.includes('Connected to the event journal')`,
        );
        wait(
          `document.querySelector('[aria-label="Nexus Activity inspector"]')?.innerText.includes('tool.succeeded')`,
        );
        assert.ok(
          evaluate(
            `Array.from(document.querySelectorAll('[aria-label="Nexus Activity inspector"] summary')).some(e=>e.textContent==='Raw event')`,
          ),
        );
        evaluate(
          `document.querySelector('[aria-label="Nexus Activity inspector"] details').open=true;true`,
        );
        evaluate(
          `document.querySelector('[aria-label="Nexus Activity inspector"]').scrollIntoView({block:"start",behavior:"instant"});true`,
        );
        run("screenshot", "/tmp/ary-events-systems.png");
        click("Ambient");
        assert.equal(
          evaluate(
            `document.querySelector('[aria-label="Nexus Activity inspector"] details')===null`,
          ),
          true,
        );
        // Ambient now intentionally opens the shared voice conversation, not the technical inspector.
        wait(
          `document.querySelector('[data-nexus-shell][data-mode="ambient"]')`,
        );
        run("screenshot", "/tmp/ary-events-ambient.png");
        click("Systems");
        // A fresh browser load hydrates history without replaying its work states.
        run("reload");
        wait(`document.querySelector('[data-nexus-shell]')`);
        click("Activity");
        wait(
          `document.querySelector('[aria-label="Nexus Activity inspector"]')?.innerText.includes('tool.succeeded')`,
        );
        wait(
          `document.querySelector('[aria-label="Nexus Activity inspector"]')?.innerText.includes('Connected to the event journal')`,
        );
        assert.equal(
          evaluate(
            `document.querySelector('[data-ary-presence]').dataset.aryPresence`,
          ),
          "idle",
        );
      }
      if (process.env.ARY_MISSION_CHECK) {
        const openMissions = () => {
          run("press", "Meta+k");
          run(
            "find",
            "label",
            "Search Ary commands",
            "fill",
            "Execution Plans",
          );
          run("press", "Enter");
          wait(`document.querySelector('[aria-label="Ary execution plans"]')`);
        };
        const checkpoint = () => {
          wait(
            `Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Process checkpoint'&&!b.disabled)`,
          );
          click("Process checkpoint");
          wait(
            `Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Process checkpoint'&&!b.disabled)`,
          );
        };
        openMissions();
        run(
          "find",
          "label",
          "Goal",
          "fill",
          "Finish Wag Trails durable acceptance",
        );
        evaluate(
          `Array.from(document.querySelectorAll('summary')).find(e=>e.textContent.includes('Advanced: reviewed structured plan')).click();true`,
        );
        run(
          "find",
          "label",
          "Structured plan JSON",
          "fill",
          JSON.stringify({
            title: "Durable acceptance mission",
            questions: [],
            steps: [
              {
                id: "task",
                title: "Create durable acceptance task",
                tool: "create_task",
                input: {
                  title: "Durable mission acceptance task",
                  priority: 3,
                  project_id: project.id,
                },
                depends_on: [],
                critical: true,
                missing: [],
                source_action_from: null,
                verification: {
                  tool: "task.inspect",
                  input: {
                    task_id: { $from: "task", path: ["result", "task_id"] },
                  },
                  path: ["status"],
                  equals: "pending",
                  description: "Created task is pending",
                },
              },
            ],
          }),
        );
        click("Save durable mission");
        wait(
          `document.querySelector('[aria-label="Durable mission controls"] strong')?.textContent==='DRAFT'`,
        );
        click("Plan mission");
        wait(
          `document.querySelector('[aria-label="Durable mission controls"] strong')?.textContent==='PLANNING'`,
        );
        checkpoint();
        wait(
          `document.querySelector('[aria-label="Durable mission controls"] strong')?.textContent==='READY'`,
        );
        click("Start / resume mission");
        wait(
          `document.querySelector('[aria-label="Durable mission controls"] strong')?.textContent==='RUNNING'`,
        );
        checkpoint();
        wait(
          `document.querySelector('[aria-label="Durable mission controls"] strong')?.textContent==='APPROVAL REQUIRED'`,
        );
        const readMission = async () =>
          (await (await fetch(url + "/api/orchestrator/plans")).json()).find(
            (p: { spec: { title: string } }) =>
              p.spec.title === "Durable acceptance mission",
          );
        const waiting = await readMission();
        assert.ok(waiting.states.task.approval_action_id);
        wait(
          `document.querySelector('[aria-label="Mission Control"] .react-flow__node')`,
        );
        run(
          "find",
          "role",
          "button",
          "click",
          "--name",
          "approval · Human approval",
          "--exact",
        );
        wait(
          `document.querySelector('[aria-label="Mission node inspector"]')?.innerText.includes('Review exact approval')`,
        );
        assert.equal(
          evaluate(
            `document.querySelectorAll('[aria-label="Mission Control"]').length`,
          ),
          1,
        );
        const controlBefore = await (
          await fetch(url + "/api/orchestrator/plans/" + waiting.id)
        ).json();
        assert.ok(
          controlBefore.receipts.some(
            (r: { action: { id: string } }) =>
              r.action.id === waiting.states.task.approval_action_id,
          ),
        );
        assert.equal(controlBefore.plan.id, waiting.id);

        run("reload");
        wait(`document.querySelector('[data-nexus-shell]')`);
        openMissions();
        wait(
          `Array.from(document.querySelectorAll('[aria-label="Saved plans"] button')).some(b=>b.textContent.includes("Durable acceptance mission"))`,
        );
        click("Durable acceptance mission · APPROVAL_REQUIRED");
        wait(
          `document.querySelector('[aria-label="Durable mission controls"] strong')?.textContent==='APPROVAL REQUIRED'`,
        );
        assert.equal(
          (await readMission()).states.task.approval_action_id,
          waiting.states.task.approval_action_id,
        );
        evaluate(
          `document.querySelector('[aria-label="Ary execution plans"] input[type="checkbox"]').click();true`,
        );
        click("Approve selected actions");
        wait(
          `!document.querySelector('[aria-label="Ary execution plans"]').innerText.includes('Saving reviewed decision')`,
        );
        click("Start / resume mission");
        for (let i = 0; i < 4; i++) {
          checkpoint();
          if ((await readMission()).mission.state === "COMPLETED") break;
        }
        wait(
          `document.querySelector('[aria-label="Durable mission controls"] strong')?.textContent==='COMPLETED'`,
        );
        const completed = await readMission(),
          snapshot = await state();
        const tasks = snapshot.tasks.filter(
          (t) => t.title === "Durable mission acceptance task",
        );
        assert.equal(tasks.length, 1);
        assert.ok(completed.states.task.verification_action_id);
        assert.ok(
          snapshot.outcomes.some(
            (o) =>
              o.action_id === completed.states.task.action_id &&
              o.status === "success",
          ),
        );
        wait(
          `document.querySelector('[aria-label="Mission Control"]')?.innerText.includes('1/1 verified')`,
        );
        run(
          "find",
          "role",
          "button",
          "click",
          "--name",
          "tool · Create durable acceptance task",
          "--exact",
        );
        wait(
          `document.querySelector('[aria-label="Mission node inspector"]')?.innerText.includes('create_task · succeeded')`,
        );
        evaluate(
          `Array.from(document.querySelectorAll('[aria-label="Mission node inspector"] summary')).find(s=>s.textContent.includes('create_task · succeeded')).click();true`,
        );
        wait(
          `document.querySelector('[aria-label="Mission node inspector"]')?.innerText.includes(${JSON.stringify(tasks[0].id)})`,
        );
        const controlAfter = await (
          await fetch(url + "/api/orchestrator/plans/" + completed.id)
        ).json();
        assert.ok(
          controlAfter.receipts.some((r: { outcomes: { status: string }[] }) =>
            r.outcomes.some((o) => o.status === "success"),
          ),
        );
        evaluate(
          `document.querySelector('[aria-label="Mission Control"]').scrollIntoView({block:'start'});true`,
        );
        run("screenshot", "/tmp/ary-mission-control.png");
        console.log(
          "Mission Control: XYFlow, exact approval, stable mission ID, real task result and outcome verified",
        );
        assert.equal(
          evaluate(
            `document.querySelectorAll('[aria-label="Mission Control"]').length`,
          ),
          1,
        );
        click("Focus selection");
        if (process.env.ARY_PRESENCE_REDUCED) {
          assert.equal(
            evaluate(
              `document.querySelector('[aria-label="Mission execution graph"]').dataset.reducedMotion`,
            ),
            "true",
          );
          assert.equal(
            evaluate(
              `document.querySelectorAll('[aria-label="Mission execution graph"] [data-active="true"]').length`,
            ),
            0,
          );
          run("set", "viewport", "900", "1000");
          evaluate(
            `document.querySelector('[aria-label="Mission Control"]').scrollIntoView({block:'start'});true`,
          );
          assert.ok(
            evaluate(`document.documentElement.scrollWidth <= innerWidth + 1`),
          );
          run("screenshot", "/tmp/ary-mission-control-reduced.png");
          run("set", "viewport", "1440", "1000");
        }
        evaluate(
          `Array.from(document.querySelectorAll('summary')).find(s=>s.textContent==='Open a mission by ID').click();true`,
        );
        run("find", "label", "Mission ID", "fill", completed.id);
        click("Open mission");
        wait(
          `document.querySelector('[aria-label="Mission Control"]')?.innerText.includes('COMPLETED')`,
        );

        run("screenshot", "/tmp/ary-durable-mission.png");
      }
      if (process.env.ARY_MAP_CHECK) {
        click("NEXUS");
        wait(
          `document.querySelector('[aria-label="Central Nexus intelligence map"] canvas')`,
        );
        wait(
          `!document.querySelector('[aria-label="Central Nexus intelligence map"]').innerText.includes('Reading your connected context')`,
        );
        const map = await (await fetch(url + "/api/nexus-map")).json();
        assert.ok(map.nodes.some((n: { id: string }) => n.id === "system:ary"));
        assert.ok(map.nodes.length <= 180);
        assert.ok(
          map.edges.every(
            (e: { source: string; target: string }) =>
              map.nodes.some((n: { id: string }) => n.id === e.source) &&
              map.nodes.some((n: { id: string }) => n.id === e.target),
          ),
        );
        assert.equal(map.meta.warnings.length, 0);
        run("find", "label", "Search Nexus map", "fill", project.name);
        wait(
          `document.querySelector('[aria-label="Nexus search results"]')?.innerText.includes(${JSON.stringify(project.name)})`,
        );
        evaluate(
          `Array.from(document.querySelectorAll('[aria-label="Nexus search results"] button')).find(e=>e.textContent.includes(${JSON.stringify(project.name)})).click();true`,
        );
        wait(
          `document.querySelector('[aria-label="Nexus map context"]')?.innerText.includes('Canonical entity')`,
        );
        click("Focus neighborhood");
        wait(`document.querySelector('[aria-label="Neighborhood depth"]')`);
        run("select", '[aria-label="Neighborhood depth"]', "2");
        click("Pan mode");
        evaluate(
          `const c=document.querySelector('[aria-label^="Nexus spatial map"]');c.focus();true`,
        );
        run("press", "ArrowRight");
        wait(
          `Number(document.querySelector('[data-map-yaw]').dataset.mapYaw)>0`,
        );
        click("Zoom in Nexus");
        click("Overview");
        run("select", '[aria-label="Filter Nexus category"]', "automation");
        wait(`document.body.innerText.includes('No recorded automations.')`);
        run("select", '[aria-label="Filter Nexus category"]', "");
        wait(`document.body.innerText.includes('One connected workspace.')`);
        click("Directory");
        wait(
          `Array.from(document.querySelectorAll('[aria-label="Map record directory"] button')).some(e=>e.textContent.includes('Perspectives'))`,
        );
        assert.ok(
          evaluate(
            `document.querySelectorAll('[aria-label="Map record directory"] button').length<=100`,
          ),
        );
        evaluate(
          `Array.from(document.querySelectorAll('[aria-label="Map record directory"] button')).find(e=>e.textContent.includes('Perspectives')).click();true`,
        );
        wait(
          `document.querySelector('[aria-label="Nexus map context"]')?.innerText.includes('Semantic view group')`,
        );
        evaluate(
          `Array.from(document.querySelectorAll('[aria-label="Nexus map context"] button')).find(e=>e.textContent.includes('Open group')).click();true`,
        );
        wait(
          `document.querySelector('[aria-label="Map record directory"]')?.innerText.includes('Sales Ary')`,
        );
        click("Overview");
        evaluate(
          `document.querySelector('[aria-label="Central Nexus intelligence map"]').scrollIntoView({block:"start",behavior:"instant"});true`,
        );
        wait(
          `(()=>{const c=document.querySelector('[aria-label^="Nexus spatial map"]');return c.dataset.settled==='true'&&Number(c.dataset.viewportNodes)===Number(c.dataset.drawnNodes)})()`,
        );
        run("screenshot", "/tmp/ary-nexus-map-overview.png");
        run("set", "viewport", "900", "1000");
        run("screenshot", "/tmp/ary-nexus-map-compact.png");
        click("Entity Brain Graph");
        wait(
          `document.querySelector('[aria-label="Ary Nexus Brain Graph"] canvas')`,
        );
        click("Nexus map");
        wait(
          `document.querySelector('[aria-label="Central Nexus intelligence map"] canvas')`,
        );
      }
    }
    if (process.env.ARY_VOICE_ONLY)
      await voiceSessionBrowserCheck({ run, evaluate, wait, click, dir });
    if (process.env.ARY_CONTROL_ONLY)
      await controlBrowserCheck({ run, evaluate, wait, click, dir });
    if (process.env.ARY_PERMISSIONS_ONLY)
      await permissionBrowserCheck({ run, evaluate, wait, click, dir });
    if (process.env.ARY_TOOLS_ONLY)
      await toolsBrowserCheck({ run, evaluate, wait, click, dir });
    if (process.env.ARY_WORLD_ONLY)
      await intelligenceBrowserCheck({ run, evaluate, wait, click, dir });
    if (process.env.ARY_MEMORY_ONLY)
      await memoryBrowserCheck({ run, evaluate, wait, click, url, dir });
    if (process.env.ARY_AGENTS_CHECK) {
      const openAgents = () => {
        run("press", "Meta+k");
        run("find", "label", "Search Ary commands", "fill", "Agent Runtime");
        run("press", "Enter");
        wait(`document.querySelector('[aria-label="Nexus Agent Runtime"]')`);
      };
      openAgents();
      run("find", "label", "Agent name", "fill", "Delivery acceptance worker");
      run(
        "find",
        "label",
        "Functional purpose",
        "fill",
        "Deliver the scoped Wag Trails acceptance task with evidence",
      );
      run(
        "find",
        "label",
        "Tool access (comma separated)",
        "fill",
        "mission.agent, agent.delegate, create_task, task.inspect",
      );
      run("select", "#agent-permission-ceiling", "4");
      assert.equal(
        evaluate(`document.querySelector('#agent-permission-ceiling').value`),
        "4",
      );
      click("Create agent");
      wait(
        `document.querySelector('[aria-label="Agent inspector"]')?.textContent.includes('Delivery acceptance worker')`,
      );
      wait(
        `document.querySelector('[aria-label="Agent delegation graph"] .react-flow__node')`,
      );
      const agents = async () =>
        (await (await fetch(url + "/api/agents")).json()).agents;
      const worker = (await agents()).find(
        (v: any) => v.agent.name === "Delivery acceptance worker",
      ).agent;
      assert.equal(worker.parent_id, null);
      assert.equal(worker.permission_level, 4);
      run(
        "find",
        "label",
        "Assignment objective",
        "fill",
        "Create a verified Wag Trails acceptance task",
      );
      evaluate(
        `Array.from(document.querySelectorAll('summary')).find(s=>s.textContent==='Optional reviewed mission specification').click();true`,
      );
      run(
        "find",
        "label",
        "Agent mission JSON",
        "fill",
        JSON.stringify({
          title: "Worker acceptance mission",
          questions: [],
          steps: [
            {
              id: "task",
              title: "Deliver scoped task",
              tool: "create_task",
              input: {
                title: "Agent Runtime acceptance task",
                priority: 3,
                project_id: project.id,
              },
              depends_on: [],
              critical: true,
              missing: [],
              source_action_from: null,
              verification: {
                tool: "task.inspect",
                input: {
                  task_id: { $from: "task", path: ["result", "task_id"] },
                },
                path: ["status"],
                equals: "pending",
                description: "Task persists",
              },
            },
          ],
        }),
      );
      click("Submit assignment");
      wait(`document.querySelector('[aria-label="Agent missions"] button')`);
      click("Worker acceptance mission · DRAFT → Mission Control");
      wait(
        `document.querySelector('[aria-label="Durable mission controls"] strong')?.textContent==='DRAFT'`,
      );
      const checkpoint = () => {
        wait(
          `Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Process checkpoint'&&!b.disabled)`,
        );
        click("Process checkpoint");
        wait(
          `document.querySelector('[aria-label="Durable mission controls"] strong')?.textContent==='COMPLETED' || Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Process checkpoint'&&!b.disabled)`,
        );
      };
      click("Plan mission");
      wait(
        `document.querySelector('[aria-label="Durable mission controls"] strong')?.textContent==='PLANNING'`,
      );
      checkpoint();
      wait(
        `document.querySelector('[aria-label="Durable mission controls"] strong')?.textContent==='READY'`,
      );
      click("Start / resume mission");
      wait(
        `document.querySelector('[aria-label="Durable mission controls"] strong')?.textContent==='RUNNING'`,
      );
      checkpoint();
      wait(
        `document.querySelector('[aria-label="Durable mission controls"] strong')?.textContent==='APPROVAL REQUIRED'`,
      );
      assert.equal(
        (await state()).tasks.filter(
          (t) => t.title === "Agent Runtime acceptance task",
        ).length,
        0,
      );
      evaluate(
        `document.querySelector('[aria-label="Ary execution plans"] input[type="checkbox"]').click();true`,
      );
      click("Approve selected actions");
      wait(
        `!document.querySelector('[aria-label="Ary execution plans"]').innerText.includes('Saving reviewed decision')`,
      );
      click("Start / resume mission");
      for (let n = 0; n < 4; n++) {
        checkpoint();
        if (
          evaluate(
            `document.querySelector('[aria-label="Durable mission controls"] strong')?.textContent==='COMPLETED'`,
          )
        )
          break;
      }
      wait(
        `document.querySelector('[aria-label="Durable mission controls"] strong')?.textContent==='COMPLETED'`,
      );
      const done = await state(),
        task = done.tasks.find(
          (t) => t.title === "Agent Runtime acceptance task",
        );
      assert.ok(task);
      assert.equal(task.metadata.requesting_agent, worker.id);
      const action = done.actions.find((a) => a.id === task.metadata.action_id);
      assert.equal(action?.metadata.agent_id, worker.id);
      assert.ok(done.outcomes.some((o) => o.action_id === action?.id));
      openAgents();
      wait(
        `Array.from(document.querySelectorAll('[aria-label="Registered agents"] button')).some(b=>b.textContent==='Delivery acceptance worker · IDLE')`,
      );
      click("Delivery acceptance worker · IDLE");
      run(
        "find",
        "label",
        "Assignment objective",
        "fill",
        "Review the remaining delivery dependencies",
      );
      click("Delegate child worker");
      wait(
        `document.querySelectorAll('[aria-label="Registered agents"] button').length===2`,
      );
      const records = await agents(),
        child = records.find((v: any) => v.agent.parent_id === worker.id);
      assert.ok(child);
      assert.equal(child.agent.lifetime, "ephemeral");
      wait(
        `document.querySelectorAll('[aria-label="Agent delegation graph"] .react-flow__node').length===3`,
      );
      evaluate(
        `document.querySelector('[aria-label="Agent delegation graph"]').scrollIntoView({block:'center'});true`,
      );
      wait(
        `(()=>{const g=document.querySelector('[aria-label="Agent delegation graph"]').getBoundingClientRect();return Array.from(document.querySelectorAll('[aria-label="Agent delegation graph"] .react-flow__node')).every(n=>{const r=n.getBoundingClientRect();return r.left>=g.left && r.right<=g.right && r.top>=g.top && r.bottom<=g.bottom;});})()`,
      );
      run(
        "screenshot",
        process.env.ARY_PRESENCE_REDUCED
          ? "/tmp/ary-agents-reduced.png"
          : "/tmp/ary-agents.png",
      );
      run("set", "viewport", "900", "1000");
      assert.equal(
        evaluate(`document.documentElement.scrollWidth<=window.innerWidth+2`),
        true,
      );
      run("screenshot", "/tmp/ary-agents-compact.png");
      click("Terminate agent and workers");
      wait(
        `document.querySelector('[aria-label="Agent inspector"]')?.innerText.includes('TERMINATED')`,
      );
      assert.ok((await agents()).every((v: any) => v.status === "TERMINATED"));
      console.log(
        "Agent Runtime browser acceptance passed: persistent identity, assignment, approval, real task, read-back, outcome, child graph, subtree termination, responsive layout.",
      );
    }
    assert.equal(run("errors").trim(), "");
    console.log(
      JSON.stringify(
        {
          passed: true,
          apiMocked: process.env.ARY_VOICE_ONLY
            ? "Speech endpoints only; real Brain/actions/storage"
            : false,
          gpu: process.env.ARY_PRESENCE_GPU
            ? "WebGPU presence active in browser"
            : "disabled; static SVG presence",
          storage: "disposable LocalRepository",
          durableMission: process.env.ARY_MISSION_CHECK
            ? "draft, planning, activation, exact approval across reload, real task, read-back, completion"
            : undefined,
          spatialMap: process.env.ARY_MAP_CHECK
            ? "bounded projection, search, canonical neighborhood/depth, orbit keyboard, zoom, cluster expansion, empty automations, directory, legacy graph, responsive capture"
            : undefined,
          events: process.env.ARY_EVENTS_CHECK
            ? "canonical journal, SSE, approval/task/outcome linkage, Systems raw inspector, Ambient hiding, reload without replay"
            : undefined,
          reducedMotion: !!process.env.ARY_PRESENCE_REDUCED,
          checks: process.env.ARY_VOICE_ONLY
            ? [
                "AudioWorklet/VAD → final voice turn → real Brain/memory/approvals; interruption and cleanup",
              ]
            : process.env.ARY_CONTROL_ONLY
              ? [
                  "guarded browser action, real failure events, persistent STOP CONTROL/reset, responsive view",
                ]
              : process.env.ARY_PERMISSIONS_ONLY
                ? [
                    "explained approvals, class deny, durable emergency stop, real task/audit/outcome, responsive layout",
                  ]
                : process.env.ARY_TOOLS_ONLY
                  ? [
                      "capability discovery, policy/schema inspector, honest health, existing action entry, responsive view",
                    ]
                  : process.env.ARY_WORLD_ONLY
                    ? [
                        "recorded entity → mission → outcome navigation",
                        "episodic timeline, confidence/provenance, supersession",
                        "existing semantic retrieval and responsive map",
                      ]
                    : process.env.ARY_MEMORY_ONLY
                      ? [
                          "classified capture and exact approval",
                          "canonical evidence, outcome and retrieval explanation",
                          "rejected and approved deletion",
                          "separate Knowledge, reload persistence, responsive view",
                          "no browser errors",
                        ]
                      : process.env.ARY_AGENTS_ONLY
                        ? [
                            "agent creation, scoped assignment, approval, real task and read-back",
                            "parent-child graph and termination",
                            "responsive and reduced-motion states",
                            "no browser errors",
                          ]
                        : process.env.ARY_PRESENCE_ONLY
                          ? [
                              process.env.ARY_EVENTS_CHECK
                                ? "persisted Brain stages and real completion"
                                : "Brain presence stages and completion",
                              "approval presence before real task creation",
                              "canonical project navigation",
                              "action form selection",
                              "approved task creation",
                              "task focus",
                              "audit/outcome/approval linkage",
                              "no browser errors",
                            ]
                          : [
                              "real Brain presence stages and completion",
                              "server-confirmed approval presence",
                              "11 destinations; no giant sidebar",
                              "Ambient/Systems preserve composer node and draft",
                              "context toggle and attention focus restoration",
                              "mode round-trip screenshot comparison",
                              "portal outside hidden HUD",
                              "keyboard and mouse",
                              "canonical project focus",
                              "action form selection",
                              "approval before real task creation",
                              "task focus after refresh",
                              "audit and outcome",
                              "Escape and dialog focus",
                              "no browser errors",
                            ],
        },
        null,
        2,
      ),
    );
  } catch (error) {
    await writeFile("/tmp/ary-shell-e2e-server.log", serverLog);
    try {
      run("screenshot", "/tmp/ary-shell-e2e-failure.png");
      console.error(run("snapshot"));
    } catch {}
    throw error;
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
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
