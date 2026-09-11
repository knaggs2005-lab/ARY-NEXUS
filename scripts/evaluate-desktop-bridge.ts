/** Real macOS read-only app inventory through Ary's existing registry/action/audit pipeline.
 * Isolated local test repository; not live Supabase authentication or hardware-write acceptance.
 * Does not read the clipboard, toggle settings, launch/quit apps, or create native records. */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { runMacFile } from "../src/infrastructure/desktop/process";
import { LocalRepository } from "../src/infrastructure/repositories/local";
import { ActionService } from "../src/services/action-service";
import { ActionRequestService } from "../src/services/action-request-service";
import { ToolRegistry } from "../src/domain/tool-registry";
import { registerDesktopTools } from "../src/infrastructure/tools/desktop-tools";
import { MacDesktopProvider } from "../src/infrastructure/desktop/mac-desktop";

async function main() {
  assert.equal(
    process.platform,
    "darwin",
    "Run this read-only evaluator on macOS",
  );
  const literal = "$" + '(whoami); `id`; "quoted"; doShellScript("id")';
  const echoed = await runMacFile(
    "/usr/bin/osascript",
    ["-l", "JavaScript", "-", literal],
    "function run(argv) { return argv[0]; }",
  );
  assert.equal(echoed, literal, "The real JXA runner must keep input literal");
  const directory = await mkdtemp(join(tmpdir(), "ary-bridge-native-"));
  try {
    const repo = new LocalRepository(
      randomUUID(),
      join(directory, "repo.json"),
    );
    // Explicit isolated harness; production launcher/owner checks have separate HTTP tests.
    const provider = new MacDesktopProvider(repo.userId, () =>
      assert.equal(process.platform, "darwin"),
    );
    const requests = new ActionRequestService(
      repo,
      new ActionService(repo),
      registerDesktopTools(new ToolRegistry(), provider),
    );
    const input = {
      tool: "desktop.list_apps",
      input: {},
      reason: "Isolated read-only Mac scan verification",
      request_key: randomUUID(),
    };
    const start = performance.now();
    const response = await requests.request(input);
    const elapsed = performance.now() - start;
    const apps = response.result.apps as {
      id: string;
      name: string;
      path: string;
    }[];
    assert(apps.length > 0);
    assert(apps.some((a) => a.id === "com.apple.TextEdit"));
    assert(apps.some((a) => a.id === "com.apple.Music"));
    assert.deepEqual(await requests.request(input), response);
    assert.equal((await repo.list("actions")).length, 2);
    assert.equal((await repo.list("outcomes")).length, 2);
    assert.equal((await repo.list("memories")).length, 0);
    console.log(
      JSON.stringify({
        pass: true,
        native_app_count: apps.length,
        scan_ms: Math.round(elapsed),
        known_system_apps_verified: true,
        action_outcome_and_replay_verified: true,
        storage: "isolated LocalRepository",
        native_writes: false,
        real_jxa_argv_literal_verified: true,
      }),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
    console.log("Isolated fixture directory removed.");
  }
}
main().catch(() => {
  console.error(
    "Desktop Bridge read-only evaluator failed; no native writes attempted.",
  );
  process.exitCode = 1;
});
