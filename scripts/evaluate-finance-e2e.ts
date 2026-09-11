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

async function main() {
  const root = process.cwd();
  const dir = await mkdtemp(join(tmpdir(), "ary-finance-e2e-"));
  const session = `finance-e2e-${process.pid}`;
  const cli = resolve("node_modules/.bin/agent-browser");
  const run = (...args: string[]) =>
    execFileSync(cli, ["--session", session, ...args], {
      encoding: "utf8",
      timeout: 45000,
    });
  const evaluate = (code: string) => JSON.parse(run("eval", code).trim());
  const wait = (condition: string) =>
    evaluate(
      `new Promise((resolve,reject)=>{const start=Date.now();const tick=()=>{if(${condition})resolve(true);else if(Date.now()-start>25000)reject(Error('Timed out: '+${JSON.stringify(condition)}));else setTimeout(tick,100)};tick()})`,
    );
  const click = (name: string) => {
    run("snapshot", "-i");
    run("find", "role", "button", "click", "--name", name, "--exact");
  };
  let server: ReturnType<typeof spawn> | undefined;
  let serverLog = "";
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
    run("open", url);
    run("snapshot", "-i");
    assert.equal(
      evaluate(
        `!!document.body.innerText.trim()&&!document.querySelector('[data-nextjs-dialog]')`,
      ),
      true,
    );
    click("Open Priority Intelligence ↗");
    wait(
      `Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Finance')`,
    );
    click("Finance");
    wait(`document.body.innerText.includes('No financial sources yet')`);
    const state = async () =>
      JSON.parse(await readFile(join(dir, ".data/demo.json"), "utf8"));
    const snapshots = async () => (await state()).finance_snapshots;
    click("Import statement");
    for (const [label, value] of [
      ["Stable account key", "isolated-e2e-cash"],
      ["Account name", "E2E operating cash"],
      ["Institution", "Isolated test institution"],
      ["Balance (blank means unknown)", "1000.29"],
      ["Source label", "E2E first statement"],
      ["Source reference", "isolated-first.pdf page 1"],
    ])
      run("find", "label", label, "fill", value);
    evaluate(
      `(()=>{const el=document.querySelector('input[name="date"]');el.value='2026-09-01T00:00';el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));return el.checkValidity()})()`,
    );
    click("Preview source");
    click("Review and import");
    wait(
      `document.querySelector('dialog[open]')&&document.querySelector('[aria-label="Financial import review"]')`,
    );
    assert.equal((await snapshots()).length, 0);
    click("Reject");
    wait(`!document.querySelector('dialog[open]')`);
    assert.equal((await snapshots()).length, 0);
    click("Review and import");
    wait(`document.querySelector('[aria-label="Financial import review"]')`);
    click("Approve once and continue");
    wait(`document.body.innerText.includes('Refresh evidence to view')`);
    const first = (await snapshots())[0];
    assert.equal(first.payload.balance_minor, 100029);
    click("Refresh evidence");
    wait(`document.querySelector('[aria-label="USD recorded totals"]')`);
    assert.equal(
      evaluate(
        `document.querySelector('[aria-label="USD recorded totals"]').textContent.includes('$1,000.29')`,
      ),
      true,
    );
    // Replay the actual successful HTTP envelope without intercepting fetch or writing the ledger directly.
    const completed = (await state()).actions.find(
      (a: { tool_name: string; status: string }) =>
        a.tool_name === "finance.import" && a.status === "succeeded",
    );
    assert.ok(completed);
    const replay = evaluate(
      `fetch('/api/actions/request',{method:'POST',headers:{'Content-Type':'application/json'},body:${JSON.stringify(JSON.stringify(completed.metadata.request_envelope))}}).then(async r=>({status:r.status,data:await r.json()}))`,
    );
    assert.equal(replay.status, 201);
    assert.equal((await snapshots()).length, 1);
    run("find", "label", "Balance (blank means unknown)", "fill", "900.29");
    run("find", "label", "Source label", "fill", "E2E later statement");
    run(
      "find",
      "label",
      "Source reference",
      "fill",
      "isolated-later.pdf page 1",
    );
    evaluate(
      `(()=>{const el=document.querySelector('input[name="date"]');el.value='2026-09-02T00:00';el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));return true})()`,
    );
    click("Preview source");
    click("Review and import");
    wait(`document.querySelector('[aria-label="Financial import review"]')`);
    click("Approve once and continue");
    wait(`!document.querySelector('dialog[open]')`);
    wait(
      `Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Refresh evidence'&&!b.disabled)`,
    );
    click("Refresh evidence");
    wait(
      `document.querySelector('[aria-label="USD recorded totals"]')?.textContent.includes('$900.29')`,
    );
    run("snapshot", "-i");
    run("find", "role", "button", "click", "--name", "E2E operating cash");
    wait(`document.querySelector('[aria-label="Financial context"]')`);
    click("Why did this change?");
    wait(`document.querySelector('[aria-label="Financial change evidence"]')`);
    const evidence = evaluate(
      `document.querySelector('[aria-label="Financial change evidence"]').textContent`,
    );
    assert.match(evidence, /isolated-first.pdf/);
    assert.match(evidence, /isolated-later.pdf/);
    assert.match(evidence, /have not been inferred/);
    const final = await state();
    assert.equal(final.finance_snapshots.length, 2);
    assert.ok(
      final.action_approvals.some(
        (a: { decision: string }) => a.decision === "rejected",
      ),
    );
    assert.ok(
      final.action_approvals.some(
        (a: { decision: string }) => a.decision === "approved",
      ),
    );
    assert.ok(
      final.actions.some(
        (a: { tool_name: string; status: string }) =>
          a.tool_name === "finance.import" && a.status === "succeeded",
      ),
    );
    assert.ok(final.outcomes.length > 0);
    run("screenshot", "/tmp/ary-finance-real-e2e.png");
    assert.equal(run("errors").trim(), "");
    console.log(
      JSON.stringify(
        {
          passed: true,
          apiMocked: false,
          storage: "disposable LocalRepository",
          productionDataTouched: false,
          checks: [
            "browser form and exact decimals",
            "real rejection writes nothing",
            "real approval persists statement",
            "duplicate import recovers one row",
            "later statement persists",
            "why navigates to both source references",
            "approval/action/outcome audit persists",
            "no browser errors",
          ],
        },
        null,
        2,
      ),
    );
  } catch (error) {
    await writeFile("/tmp/ary-finance-real-e2e-server.log", serverLog);
    try {
      run("screenshot", "/tmp/ary-finance-real-e2e-failure.png");
      console.error(run("snapshot", "-i"));
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
