/** Real Creative UI/action/approval acceptance with a test-only Premiere port. No Adobe project edits. */
import { encodeWav } from "../src/infrastructure/premiere/media-analysis";
import { execFileSync, spawn } from "node:child_process";
import {
  cp,
  mkdir,
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
  const dir = await mkdtemp(join(tmpdir(), "ary-premiere-e2e-"));
  const session = `premiere-e2e-${process.pid}`;
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
    const contextPath = join(dir, "src/server/context.ts");
    await writeFile(
      join(dir, "src/infrastructure/premiere/fixture.ts"),
      `
import { appendFile } from "node:fs/promises";
let revision=1; const items=[{id:"root",name:"Root",parent_id:null,kind:"bin"},{id:"source",name:"Interview source",parent_id:"root",kind:"media",media_path:process.env.FIXTURE_MEDIA_PATH,offline:false}];
export class FixturePremiere {
 assertAvailable(){}
 async inspect(){return {revision:"fixture-"+revision,project_id:"project-1",project_name:"Disposable interview",project_path:"/fixture.prproj",sequence_id:"sequence-1",sequences:[{id:"sequence-1",name:"Review"}],items:[...items],clips:[{id:"video:0:0",name:"Interview instance",start:"0",end:"762048000000",source_id:"source",source_in:"0",source_out:"762048000000",track_kind:"video",track_index:0,disabled:false}],complete:true};}
 async execute(verb,input){if(input.expected_revision!=="fixture-"+revision)throw Error("Premiere changed since review");revision++;if(verb==="create_bin")items.push({id:"bin-"+revision,name:input.args.name,parent_id:"root",kind:"bin"});await appendFile(".data/premiere-fixture-edits.log",verb+"\\n");return {provider:"fixture-uxp",verb,...(verb==="create_bin"?{bin_id:"bin-"+revision}:{markers:input.args.markers}),after_revision:"fixture-"+revision,simulated:true};}
}`,
    );
    const source = await readFile(contextPath, "utf8");
    await writeFile(
      contextPath,
      'import {FixturePremiere} from "../infrastructure/premiere/fixture";\n' +
        source.replace(
          /new UxpPremiereProvider\([\s\S]*?\n\s+\),/,
          "new FixturePremiere(),",
        ),
    );
    assert.ok(
      !(await readFile(contextPath, "utf8")).includes(
        "new UxpPremiereProvider(",
      ),
      "Fixture injection must replace the real adapter",
    );
    await mkdir(join(dir, ".data"), { recursive: true });
    await writeFile(
      join(dir, ".data", "interview.wav"),
      encodeWav(new Float32Array(48000), 16000),
    );
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
          FIXTURE_MEDIA_PATH: join(dir, ".data", "interview.wav"),
          ARY_PREMIERE_ALLOWED_ROOTS: JSON.stringify([join(dir, ".data")]),
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
    console.log(
      "Warming the isolated Next.js server before browser navigation.",
    );
    const warmed = await fetch(url, { signal: AbortSignal.timeout(60000) });
    assert.equal(warmed.status, 200);
    await warmed.text();
    await (await fetch(url + "/api/dashboard")).text();
    run("open", url);
    wait(`document.querySelector('[aria-label="Open Ary command palette"]')`);
    run("press", "Meta+k");
    run("find", "label", "Search Ary commands", "fill", "Creative");
    run("press", "Enter");
    wait(`document.querySelector('[aria-label="Ary Creative Premiere"]')`);
    run(
      "find",
      "label",
      "Transcript package JSON",
      "fill",
      JSON.stringify({
        brief: "Surprising interview lesson",
        destination: "Reviewed interview",
        target_seconds: 30,
        clips: [
          {
            id: "source-1",
            name: "Interview",
            source_ref: "fixture://interview/transcript-v1",
            duration: 30,
            fps: 30,
            segments: [
              {
                id: "cue-1",
                start: 2,
                end: 12,
                text: "The surprising lesson changed our entire interview process and saved 20 hours.",
                confidence: 0.9,
              },
            ],
          },
        ],
      }),
    );
    click("Analyze edit plan");
    wait(`document.body.innerText.includes('Edit plan · Reviewed interview')`);
    const analyzed = JSON.parse(
      await readFile(join(dir, ".data/demo.json"), "utf8"),
    );
    const analysis = analyzed.actions.find(
      (a: Action) => a.tool_name === "edit.plan" && a.status === "succeeded",
    );
    assert.ok(analysis);
    assert.equal(analysis.output.result.version, "edit-rules-v1");
    assert.equal(
      analysis.output.result.recommendations[0].evidence.source_ref,
      "fixture://interview/transcript-v1",
    );
    assert.ok(
      !analyzed.actions.some((a: Action) =>
        a.tool_name.startsWith("premiere."),
      ),
    );
    assert.ok(
      !analyzed.memories.some((m: { content: string }) =>
        m.content.includes("20 hours"),
      ),
    );
    click("Inspect Premiere");
    wait(`document.body.innerText.includes('Disposable interview')`);
    run(
      "find",
      "label",
      "Exact action inputs",
      "fill",
      JSON.stringify({ name: "Interview Selects", parent_id: "root" }),
    );
    click("Prepare action plan");
    wait(`document.body.innerText.includes('Review the exact operation')`);
    click("Request approval and execute");
    wait(`document.querySelector('dialog[open]')`);
    click("Reject");
    wait(`!document.querySelector('dialog[open]')`);
    let edits = "";
    try {
      edits = await readFile(
        join(dir, ".data/premiere-fixture-edits.log"),
        "utf8",
      );
    } catch {}
    assert.equal(edits, "");
    click("Prepare action plan");
    wait(`document.body.innerText.includes('Review the exact operation')`);
    click("Request approval and execute");
    wait(`document.querySelector('dialog[open]')`);
    click("Approve once and continue");
    wait(`document.body.innerText.includes('Premiere receipt')`);
    run("screenshot", "/tmp/ary-premiere-e2e.png", "--full");
    edits = await readFile(
      join(dir, ".data/premiere-fixture-edits.log"),
      "utf8",
    );
    assert.equal(edits.trim(), "create_bin");
    const final = JSON.parse(
      await readFile(join(dir, ".data/demo.json"), "utf8"),
    );
    const executed = final.actions.find(
      (a: Action) =>
        a.tool_name === "premiere.create_bin" && a.status === "succeeded",
    );
    assert.ok(executed);
    assert.equal(executed.output.result.bin_id, "bin-2");
    assert.ok(final.outcomes.some((o: Outcome) => o.action_id === executed.id));
    assert.ok(
      final.action_approvals.some(
        (a: ActionApproval) => a.decision === "approved" && a.consumed_at,
      ),
    );
    assert.ok(
      final.action_approvals.some(
        (a: ActionApproval) => a.decision === "rejected",
      ),
    );
    click("Inspect Premiere");
    wait(`document.body.innerText.includes('fixture-2')`);
    evaluate(
      `document.querySelectorAll('summary').forEach(s=>{if(s.textContent==='Prepare one marker for Premiere review')s.click()});true`,
    );
    const marker = analysis.output.result.recommendations.find(
      (r: { kind: string }) => r.kind === "marker",
    );
    run("select", '[aria-label="Ary Edit Intelligence"] select', marker.id);
    run(
      "find",
      "label",
      "Destination Premiere project ID",
      "fill",
      "project-1",
    );
    run(
      "find",
      "label",
      "Destination Premiere sequence ID",
      "fill",
      "sequence-1",
    );
    run("find", "label", "Verified sequence seconds", "fill", "12");
    run(
      "find",
      "label",
      "Source-to-sequence mapping evidence",
      "fill",
      "Fixture source checked at sequence twelve seconds",
    );
    click("Prepare marker review");
    wait(`document.body.innerText.includes('Premiere create markers')`);
    click("Request approval and execute");
    wait(`document.querySelector('dialog[open]')`);
    click("Approve once and continue");
    wait(
      `Array.from(document.querySelectorAll("pre")).some(p=>p.textContent.includes('"verb": "create_markers"'))`,
    );
    const marked = JSON.parse(
      await readFile(join(dir, ".data/demo.json"), "utf8"),
    );
    const markerAction = marked.actions.find(
      (a: Action) =>
        a.tool_name === "premiere.create_markers" && a.status === "succeeded",
    );
    assert.ok(markerAction);
    assert.equal(
      markerAction.input.action_request.source_action_id,
      analysis.id,
    );
    assert.ok(
      markerAction.input.args.markers[0].comments.includes(analysis.id),
    );
    assert.equal(
      (
        await readFile(join(dir, ".data/premiere-fixture-edits.log"), "utf8")
      ).trim(),
      "create_bin\ncreate_markers",
    );
    run("screenshot", "/tmp/ary-edit-intelligence-e2e.png", "--full");
    click("Inspect Premiere");
    wait(`document.body.innerText.includes('fixture-3')`);
    run("find", "label", "Find clips", "fill", "Interview");
    wait(`document.body.innerText.includes('Interview instance')`);
    run(
      "select",
      '[aria-label="Premiere workspace intelligence"] select',
      "source",
    );
    run("find", "label", "Excerpt duration (seconds)", "fill", "3");
    click("Prepare media analysis");
    wait(
      `document.body.innerText.includes('Local acoustic measurements only')`,
    );
    click("Request approval and execute");
    wait(`document.querySelector('dialog[open]')`);
    click("Approve once and continue");
    wait(`document.querySelector('[aria-label="Premiere analysis findings"]')`);
    assert.ok(
      evaluate(
        `document.querySelector('[aria-label="Premiere analysis findings"]').innerText.includes('silence')`,
      ),
    );
    wait(`document.querySelector('[aria-label="Premiere activity timeline"]')`);
    evaluate(
      `document.querySelector('[aria-label="Premiere analysis findings"]').scrollIntoView({block:"start"}); true`,
    );
    run("screenshot", "/tmp/ary-premiere-deep.png", "--full");
    run("set", "media", "reduced-motion", "reduce");
    run("screenshot", "/tmp/ary-premiere-deep-reduced.png", "--full");
    const checked = JSON.parse(
      await readFile(join(dir, ".data/demo.json"), "utf8"),
    );
    const mediaAction = checked.actions.find(
      (a: Action) =>
        a.tool_name === "premiere.analyze_media" && a.status === "succeeded",
    );
    assert.ok(mediaAction?.output.result.source.excerpt_sha256);
    assert.ok(
      checked.outcomes.some((o: Outcome) => o.action_id === mediaAction.id),
    );
    assert.ok(!run("errors").trim());
    console.log(
      JSON.stringify(
        {
          passed: true,
          storage: "disposable LocalRepository",
          provider: "test-only Premiere port; no Adobe edits",
          checks: [
            "Creative navigation",
            "timed transcript ingestion and advisory plan UI",
            "persisted source quotes and hash",
            "analysis creates no Premiere action or permanent memory",
            "live port inspection",
            "specific action plan",
            "rejection does not execute",
            "exact approved execution",
            "result/outcome/audit linkage",
            "refreshed state",
            "reviewed source-to-sequence mapping",
            "marker approval and source-action provenance",
            "clip search and native timeline/source ranges",
            "pinned media analysis approval",
            "real WAV silence receipt and outcome",
            "Premiere activity and reduced motion",
            "no browser errors",
          ],
        },
        null,
        2,
      ),
    );
  } catch (error) {
    await writeFile("/tmp/ary-premiere-e2e-server.log", serverLog);
    try {
      run("screenshot", "/tmp/ary-premiere-e2e-failure.png");
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
    console.log(
      "Disposable source, repository fixtures, server, and browser session cleaned up.",
    );
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
