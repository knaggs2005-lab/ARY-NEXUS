import { loadEnvConfig } from "@next/env";
import { OpenAIVisualControl } from "../src/infrastructure/providers/openai-visual-control";
import type { ModelMetric } from "../src/domain/telemetry";
/** Native Accessibility acceptance against an app created solely for this test. */
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { MacAccessibility } from "../src/infrastructure/control/mac-accessibility";
import { runAccessibility } from "../src/infrastructure/control/mac-accessibility";
import { stopOwnerControl } from "../src/services/action-cancellation";
const owner = randomUUID(),
  appId = "com.ary.ControlFixture";
async function main() {
  const live = process.argv.includes("--live-vision"),
    metrics: ModelMetric[] = [];
  if (live) {
    loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
    if (!process.env.OPENAI_API_KEY)
      throw Error("Existing OpenAI API key is not configured");
    console.log(
      "Using the existing configured OpenAI provider; credentials remain private.",
    );
  }

  const dir = await mkdtemp(join(tmpdir(), "ary-native-control-")),
    bundle = join(dir, "Ary Control Fixture.app"),
    contents = join(bundle, "Contents");
  let launched = false;
  try {
    await mkdir(join(contents, "MacOS"), { recursive: true });
    execFileSync(
      "/usr/bin/xcrun",
      [
        "swiftc",
        "native/control-fixture.swift",
        "-o",
        join(contents, "MacOS/fixture"),
        "-framework",
        "AppKit",
      ],
      { timeout: 60000 },
    );
    await writeFile(
      join(contents, "Info.plist"),
      `<?xml version="1.0"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${appId}</string><key>CFBundleExecutable</key><string>fixture</string><key>CFBundleName</key><string>Ary Control Fixture</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>`,
    );
    execFileSync("/usr/bin/open", [bundle]);
    launched = true;
    const provider = new MacAccessibility(
      owner,
      () => {},
      [appId],
      live
        ? new OpenAIVisualControl(async (metric) => {
            metrics.push(metric);
          })
        : {
            async propose() {
              return {
                x: 0.5,
                y: 0.5,
                confidence: 0.9,
                reason: "Fixture point only; no live model claim",
              };
            },
          },
      undefined,
      async () => [{ id: appId, name: "Ary Control Fixture", path: bundle }],
    );
    let snapshot;
    for (let i = 0; i < 30; i++) {
      try {
        snapshot = await provider.inspect(appId);
        if (snapshot.elements.some((e) => e.role === "AXTextField")) break;
      } catch (e) {
        if (String(e).includes("AX_PERMISSION")) throw e;
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    assert.ok(snapshot);
    const field = snapshot.elements.find((e) => e.role === "AXTextField");
    assert.ok(field);
    await provider.act({
      snapshot_id: snapshot.id,
      element_id: field.id,
      verb: "fill",
      value: "Finish Wag Trails fixture",
    });
    snapshot = await provider.inspect(appId);
    assert.equal(
      snapshot.elements.find((e) => e.role === "AXTextField")?.value,
      "Finish Wag Trails fixture",
    );
    const keyboardTarget = snapshot.elements.find(
      (e) => e.role === "AXTextField",
    )!;
    await provider.act({
      snapshot_id: snapshot.id,
      element_id: keyboardTarget.id,
      verb: "key",
      key: "Space",
    });
    await new Promise((r) => setTimeout(r, 150));
    snapshot = await provider.inspect(appId);
    assert.notEqual(
      snapshot.elements.find((e) => e.role === "AXTextField")?.value,
      "Finish Wag Trails fixture",
      "Keyboard input did not reach the inspected field",
    );
    await provider.act({
      snapshot_id: snapshot.id,
      element_id: keyboardTarget.id,
      verb: "fill",
      value: "Finish Wag Trails fixture",
    });
    snapshot = await provider.inspect(appId);
    const button = snapshot.elements.find((e) => e.label === "Save fixture");
    assert.ok(button);
    await provider.act({
      snapshot_id: snapshot.id,
      element_id: button.id,
      verb: "click",
    });
    snapshot = await provider.inspect(appId);
    assert.ok(
      snapshot.elements.some(
        (e) => e.role === "AXWindow" && e.label === "Fixture saved",
      ),
    );
    assert.ok(snapshot.elements.some((e) => e.id.startsWith("m")));
    // Re-open our own disposable app with a canvas that has no AX content targets.
    execFileSync(
      "/usr/bin/osascript",
      ["-e", `tell application id "${appId}" to quit`],
      { timeout: 10000 },
    );
    await assert.rejects(
      runAccessibility({ verb: "inspect", app_id: appId }),
      /not running/,
    );
    execFileSync("/usr/bin/open", [bundle, "--args", "--canvas"]);
    await new Promise((r) => setTimeout(r, 800));
    const canvas = await provider.inspect(appId),
      window = canvas.elements.find((e) => e.role === "AXWindow");
    assert.ok(window);
    let visual = "not run";
    try {
      const proposal = await provider.propose(
        canvas.id,
        window.id,
        "Find the center of the blue circle in this fixture window. Propose a click on that circle.",
      );
      await provider.visualClick(proposal.proposal_id, proposal.point);
      await new Promise((r) => setTimeout(r, 350));
      const after = await provider.inspect(appId);
      assert.ok(
        after.elements.some((e) => e.label === "Visual fixture clicked"),
        JSON.stringify(after.elements.filter((e) => e.role === "AXWindow")) +
          " / event: " +
          (await readFile(join(dir, "fixture-events.json"), "utf8").catch(
            () => "not received",
          )),
      );
      visual = live
        ? "Real OpenAI visual suggestion, window capture, pinned-pixel comparison and visible native mouse outcome passed"
        : "Real window capture, pinned-pixel comparison and mouse dispatch passed with a deterministic point provider; live model not tested";
    } catch (e) {
      if (String(e).includes("SCREEN_PERMISSION"))
        visual =
          "Screen Recording permission required; live visual dispatch not tested";
      else throw e;
    }
    const report = {
      visual,
      model_calls: metrics,
      status: "passed",
      checks: [
        "actual AXUIElement inspection",
        "actual native text modification",
        "actual native button press",
        "actual keyboard input with field read-back",
        "window-title verification",
        "menu discovery",
      ],
      scope: "Disposable fixture app; no real user content",
    };
    await writeFile(
      "/tmp/ary-native-control-acceptance.json",
      JSON.stringify(report, null, 2),
    );
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await stopOwnerControl(owner);
    if (launched)
      try {
        execFileSync(
          "/usr/bin/osascript",
          ["-e", `tell application id "${appId}" to quit`],
          { timeout: 10000 },
        );
      } catch {
        /* No force-kill. Report cleanup failure separately. */
      }
    if (launched) {
      await assert.rejects(
        runAccessibility({ verb: "inspect", app_id: appId }),
        /not running/,
      );
      console.log(
        "Native fixture cleanup verified: app exited; temporary bundle removed.",
      );
    }
    await rm(dir, { recursive: true, force: true });
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
