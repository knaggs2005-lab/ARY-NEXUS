/** Isolated real Chromium + existing approval/action/outcome pipeline. No account or external site. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { chromium, type Browser } from "playwright";
import {
  PlaywrightBrowser,
  stopControlledBrowsers,
} from "../src/infrastructure/control/playwright-browser";
import { ControlFiles } from "../src/infrastructure/control/files";
import { MacAccessibility } from "../src/infrastructure/control/mac-accessibility";
import { ToolRegistry } from "../src/domain/tool-registry";
import { registerControlTools } from "../src/infrastructure/tools/control-tools";
import { LocalRepository } from "../src/infrastructure/repositories/local";
import {
  ActionService,
  ApprovalRequiredError,
} from "../src/services/action-service";
import { ActionRequestService } from "../src/services/action-request-service";
import type { ControlSnapshot } from "../src/domain/digital-control";
async function main() {
  const dir = await mkdtemp(join(tmpdir(), "ary-real-control-")),
    owner = randomUUID();
  let submits = 0,
    browser: Browser | undefined;
  const server = createServer((req, res) => {
    if (req.url === "/note.txt") {
      res.writeHead(200, {
        "content-type": "text/plain",
        "content-disposition": "attachment; filename=note.txt",
      });
      res.end("fixture download");
      return;
    }
    if (req.url === "/submit") {
      submits++;
      res.end("<title>Saved</title><h1>Fixture saved</h1><a href='/'>Back</a>");
      return;
    }
    res.setHeader("content-type", "text/html");
    res.end(
      `<title>Control fixture</title><form action="/submit" method="post"><label>Task title<input name="title" /></label><label>Priority<select><option value="normal">Normal</option><option value="high">High</option></select></label><label>Ready<input type="checkbox" /></label><label>Password<input type="password" /></label><button>Save fixture</button></form><label>Upload<input type="file" /></label><a href="/note.txt" download>Download note</a><a href="https://example.invalid/">Outside origin</a>`,
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const files = new ControlFiles(join(dir, "transfers"));
    await files.write("upload.txt", Buffer.from("fixture upload"));
    const adapter = new PlaywrightBrowser(
      owner,
      () => {},
      [origin],
      files,
      async () =>
        (browser = await chromium.launch({
          headless: true,
          channel: "chrome",
        })),
    );
    const native = new MacAccessibility(
      owner,
      () => {
        throw Error("Native adapter is outside this browser fixture");
      },
      [],
      {
        async propose() {
          throw Error("No model fixture");
        },
      },
    );
    const repo = new LocalRepository(owner, join(dir, "repo.json")),
      actions = new ActionService(repo),
      registry = new ToolRegistry();
    registerControlTools(
      registry,
      adapter,
      native,
      files,
      () => {},
      actions.permissions,
    );
    const requests = new ActionRequestService(repo, actions, registry);
    async function approved(tool: string, input: Record<string, unknown>) {
      const raw = {
        tool,
        input,
        reason: "Isolated browser acceptance",
        request_key: randomUUID(),
      };
      let id = "";
      try {
        await requests.request(raw);
      } catch (e) {
        assert.ok(e instanceof ApprovalRequiredError);
        id = e.actionId;
      }
      assert.ok(id);
      await actions.permissions.review(id, "approved", "Fixture approval");
      const response = await requests.request(raw);
      const replay = await requests.request(raw);
      assert.equal(replay.action_id, response.action_id);
      return response;
    }
    let snapshot = (await approved("browser.open", { url: origin }))
      .result as unknown as ControlSnapshot;
    assert.equal(submits, 0);
    const protectedTarget = snapshot.elements.find(
      (e) => e.label === "Password",
    )!;
    assert.equal(protectedTarget.protected, true);
    assert.deepEqual(protectedTarget.actions, []);
    async function interact(
      label: string,
      verb: string,
      extra: Record<string, unknown> = {},
    ) {
      const element = snapshot.elements.find((e) => e.label === label);
      assert.ok(element, `Missing ${label}`);
      const before = snapshot;
      const result = await approved("browser.act", {
        snapshot_id: snapshot.id,
        element_id: element.id,
        verb,
        ...extra,
      });
      const data = result.result as unknown as { snapshot: ControlSnapshot };
      snapshot = data.snapshot;
      await assert.rejects(
        adapter.act({
          snapshot_id: before.id,
          element_id: element.id,
          verb: "click",
        }),
        /expired|target/,
      );
      return result;
    }
    await interact("Task title", "fill", {
      value: "Finish Wag Trails fixture",
    });
    assert.equal(
      snapshot.elements.find((e) => e.label === "Task title")?.value,
      "Finish Wag Trails fixture",
    );
    await interact("Priority", "select", { value: "high" });
    await interact("Ready", "check", { checked: true });
    await interact("Upload", "upload", { file_id: "upload.txt" });
    await interact("Download note", "download");
    assert.equal((await files.list()).length, 2);
    // Actual DOM replacement and same-label value change must invalidate a pinned target.
    const page = browser!.contexts()[0].pages()[0],
      stale = snapshot.elements.find((e) => e.label === "Task title")!;
    await page
      .getByLabel("Task title")
      .fill("Changed outside approved request");
    await assert.rejects(
      adapter.act({
        snapshot_id: snapshot.id,
        element_id: stale.id,
        verb: "fill",
        value: "unsafe stale value",
      }),
      /changed since/,
    );
    snapshot = await adapter.inspect(snapshot.target_id);
    await interact("Save fixture", "click");
    assert.equal(submits, 1);
    assert.ok(snapshot.title.includes("Saved"));
    const stranger = new PlaywrightBrowser(
      randomUUID(),
      () => {},
      [origin],
      files,
    );
    await assert.rejects(stranger.inspect(snapshot.target_id), /unavailable/);
    await assert.rejects(adapter.open("https://example.invalid"), /outside/);
    // Stop goes through the existing durable owner control; closes an idle browser too.
    await actions.permissions.ownerAction(
      "permissions.emergency_stop",
      { active: true, reason: "Fixture stop" },
      () => actions.permissions.setEmergencyStop(true, "Fixture stop", null),
    );
    assert.equal(browser!.isConnected(), false);
    await assert.rejects(adapter.inspect(snapshot.target_id), /unavailable/);
    const events = await repo.readEvents({ limit: 100 });
    assert.ok(events.events.some((e) => e.type === "browser.executing"));
    assert.ok(events.events.some((e) => e.type === "browser.result"));
    assert.ok(
      (await repo.list("outcomes")).some((o) => o.status === "success"),
    );
    const report = {
      status: "passed",
      scope:
        "Isolated local Chromium, real form/file effects and existing permissions/actions/outcomes",
      checks: [
        "explicit approvals",
        "durable same-key replay",
        "fill",
        "select",
        "check",
        "upload",
        "download",
        "password protection",
        "stale DOM rejection",
        "form submission exactly once",
        "cross-owner isolation",
        "origin scope",
        "idle-browser emergency stop",
        "persisted browser events/outcomes",
      ],
      external_effects: 0,
    };
    await writeFile(
      "/tmp/ary-digital-control-acceptance.json",
      JSON.stringify(report, null, 2),
    );
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await stopControlledBrowsers(owner);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
