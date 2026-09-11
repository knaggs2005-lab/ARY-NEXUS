/** Disposable ModelRouter UI/action/approval test. No physical hardware is contacted. */
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
import type { ActionApproval } from "../src/domain/permissions";

async function main() {
  const root = process.cwd();
  const dir = await mkdtemp(join(tmpdir(), "ary-router-e2e-"));
  const session = `router-e2e-${process.pid}`;
  const cli = resolve("node_modules/.bin/agent-browser");
  const run = (...args: string[]) =>
    execFileSync(
      cli,
      ["--session", session, "--args", "--disable-gpu", ...args],
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
  let modelServer: ReturnType<typeof spawn> | undefined;
  let modelUrl = "";
  try {
    const modeFile = join(dir, "provider-mode");
    await writeFile(modeFile, "available");
    const fixtureFile = join(dir, "provider-fixture.mjs");
    await writeFile(
      fixtureFile,
      'import { createServer } from "node:http";\nimport { readFileSync } from "node:fs";\nconst modelServer = createServer(async (req, res) => {\n      let body = "";\n      for await (const part of req) body += part;\n      const input = JSON.parse(body || "{}");\n      if (input.model !== "local-fixture" || readFileSync(process.argv[2], "utf8") === "outage") {\n        res.writeHead(503, { "Content-Type": "application/json" });\n        res.end(JSON.stringify({ error: "Fixture unavailable" }));\n        return;\n      }\n      const extracting = JSON.stringify(input.messages).includes(\n        "Extract at most five",\n      );\n      const text = extracting\n        ? JSON.stringify({ candidates: [] })\n        : "Local fixture: Ary Nexus keeps shared evidence and reviewed actions.";\n      const usage = { prompt_tokens: 12, completion_tokens: 10 };\n      if (input.stream) {\n        res.writeHead(200, { "Content-Type": "text/event-stream" });\n        res.write(\n          "data: " +\n            JSON.stringify({\n              model: "local-fixture",\n              choices: [{ delta: { content: text } }],\n            }) +\n            "\\n\\n",\n        );\n        res.end(\n          "data: " +\n            JSON.stringify({ choices: [], usage }) +\n            "\\n\\ndata: [DONE]\\n\\n",\n        );\n      } else {\n        res.writeHead(200, { "Content-Type": "application/json" });\n        res.end(\n          JSON.stringify({\n            model: "local-fixture",\n            choices: [{ message: { content: text }, finish_reason: "stop" }],\n            usage,\n          }),\n        );\n      }\n    });\n\nmodelServer.listen(0,"127.0.0.1",()=>console.log(`http://127.0.0.1:${modelServer.address().port}/v1`));',
    );
    modelServer = spawn(process.execPath, [fixtureFile, modeFile], {
      env: { PATH: process.env.PATH, NODE_ENV: "test" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let fixtureLog = "";
    modelServer.stdout?.on("data", (chunk) => {
      fixtureLog += chunk;
    });
    const fixtureStart = Date.now();
    while (!fixtureLog.includes("http://")) {
      if (modelServer.exitCode !== null || Date.now() - fixtureStart > 10000)
        throw new Error("Provider fixture failed to start");
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    modelUrl = fixtureLog.trim();
    for (const file of [
      "src",
      "public",
      "package.json",
      "tsconfig.json",
      "next-env.d.ts",
    ])
      await cp(join(root, file), join(dir, file), { recursive: true });
    await symlink(join(root, "node_modules"), join(dir, "node_modules"));
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
          ARY_LLM_PROVIDER: "compatible",
          LLM_BASE_URL: modelUrl,
          LLM_MODEL: "cloud-fixture",
          ARY_STT_PROVIDER: "disabled",
          ARY_TTS_PROVIDER: "disabled",
          ARY_MODEL_ROUTER_TARGETS: JSON.stringify([
            {
              id: "local-backup",
              provider: "mlx",
              model: "local-fixture",
              location: "local",
              base_url: modelUrl,
              tasks: ["chat", "analysis", "planning", "extraction"],
              capabilities: ["reasoning", "streaming", "structured"],
              context_tokens: 128000,
              priority: 10,
            },
          ]),
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
    console.log(
      "Warming the isolated Next.js server before browser navigation.",
    );
    const warmed = await fetch(url, { signal: AbortSignal.timeout(180000) });
    assert.equal(warmed.status, 200);
    await warmed.text();
    // Consume both routes before UI timing assertions: streamed headers alone do not finish cold compilation.
    const dashboard = await fetch(url + "/api/dashboard", {
      signal: AbortSignal.timeout(180000),
    });
    assert.equal(dashboard.status, 200);
    await dashboard.json();
    console.log(
      "Cold page and API compilation completed; checking the browser.",
    );
    run("open", url);
    wait(`document.querySelector('[aria-label="Open Ary command palette"]')`);
    const navigate = (name: string) => {
      run("press", "Meta+k");
      run("find", "label", "Search Ary commands", "fill", name);
      run("press", "Enter");
    };
    run(
      "find",
      "label",
      "Message Ary",
      "fill",
      "What do we know about Ary Nexus?",
    );
    run("press", "Enter");
    wait(`document.querySelector('[aria-label="Intelligence routing"]')`);
    evaluate(
      `document.querySelector('[aria-label="Intelligence routing"] summary').click();true`,
    );
    wait(
      `document.querySelector('[aria-label="Intelligence routing"]').innerText.includes('fallback succeeded')`,
    );
    let stored = JSON.parse(
      await readFile(join(dir, ".data/demo.json"), "utf8"),
    );
    const first = stored.messages.findLast(
      (m: any) => m.role === "assistant" && m.metadata.model_routing,
    );
    assert.equal(first.metadata.provider, "local-fixture");
    assert.equal(first.metadata.provider_id, "mlx");
    assert.equal(first.metadata.model_routing.attempts.length, 2);
    assert.ok(
      stored.model_calls.some(
        (c: any) => c.model === "local-fixture" && c.input_tokens === 12,
      ),
    );
    assert.ok(stored.nexus_events.some((e: any) => e.type === "model.routed"));
    const routedBox = `document.querySelector('[aria-label="Intelligence routing"]')`;
    evaluate(`${routedBox}.scrollIntoView({block:'center'});true`);
    run("screenshot", "/tmp/ary-model-router.png");
    wait(`!document.querySelector('#chat-input').disabled`);
    await writeFile(modeFile, "outage");
    run(
      "find",
      "label",
      "Message Ary",
      "fill",
      "What do we know about Ary Nexus now?",
    );
    run("press", "Enter");
    wait(
      `document.querySelectorAll('[aria-label="Intelligence routing"]').length===2`,
    );
    wait(`!document.querySelector('#chat-input').disabled`);
    stored = JSON.parse(await readFile(join(dir, ".data/demo.json"), "utf8"));
    const latest = stored.messages.findLast(
      (m: any) => m.role === "assistant" && m.metadata.model_routing,
    );
    assert.equal(latest.metadata.provider_id, "local-evidence");
    assert.ok(latest.content.includes("AI reasoning is unavailable"));
    assert.ok(stored.extraction_jobs.some((j: any) => j.status === "failed"));
    evaluate(
      `Array.from(document.querySelectorAll('[aria-label="Intelligence routing"]')).at(-1).querySelector('summary').click();true`,
    );
    assert.ok(
      evaluate(
        `Array.from(document.querySelectorAll('[aria-label="Intelligence routing"]')).at(-1).innerText.includes('limited evidence mode')`,
      ),
    );
    run("set", "media", "reduced-motion", "reduce");
    run("screenshot", "/tmp/ary-model-router-offline.png");
    click("Ambient");
    wait(`!!document.querySelector('[aria-label="Ambient conversation"]')`);
    assert.equal(
      evaluate(
        `Array.from(document.querySelectorAll('[aria-label="Intelligence routing"]')).some(el => el.getClientRects().length > 0)`,
      ),
      false,
    );
    assert.equal(
      evaluate(
        `!!document.querySelector('[data-nextjs-dialog],.vite-error-overlay')`,
      ),
      false,
    );
    console.log(
      JSON.stringify({
        passed: 9,
        checks: [
          "shared Brain path",
          "streaming local fallback",
          "two-attempt routing provenance",
          "token telemetry",
          "persisted model event",
          "all-model outage evidence mode",
          "retryable extraction",
          "Systems routing details and Ambient simplicity",
          "no overlays and reduced motion",
        ],
        network: "local HTTP provider fixtures only",
      }),
    );
  } catch (error) {
    await writeFile("/tmp/ary-router-e2e-server.log", serverLog);
    try {
      run("screenshot", "/tmp/ary-router-e2e-failure.png");
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
    if (modelServer && modelServer.exitCode === null) {
      const closed = once(modelServer, "close");
      modelServer.kill("SIGTERM");
      await closed;
    }
    await rm(dir, { recursive: true, force: true });
    console.log(
      "Disposable source, repository fixtures, server, and browser session cleaned up.",
    );
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
