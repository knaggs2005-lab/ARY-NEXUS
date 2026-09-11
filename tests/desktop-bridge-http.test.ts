import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { context } from "../src/server/context";
import { actionContext } from "../src/server/action-context";
import { handle } from "../src/server/http";
import { ActionService } from "../src/services/action-service";
import { createActionToolRegistry } from "../src/services/action-request-service";
import { LocalRepository } from "../src/infrastructure/repositories/local";
import { MacDesktopProvider } from "../src/infrastructure/desktop/mac-desktop";
import { assertDesktopAccess } from "../src/infrastructure/desktop/security";
import { EncryptedCalendarVault } from "../src/infrastructure/calendar/vault";
vi.mock("../src/server/context", () => ({
  context: vi.fn(),
  isDemo: () => false,
}));
let dir: string, repo: LocalRepository;
const run = vi.fn(async () => "25");
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ary-bridge-http-"));
  repo = new LocalRepository(randomUUID(), join(dir, "repo.json"));
  vi.stubEnv("ARY_STORAGE", "supabase");
  vi.stubEnv("ARY_DESKTOP_BRIDGE_ENABLED", "true");
  vi.stubEnv("ARY_DESKTOP_USER_ID", repo.userId);
  vi.stubEnv("ARY_DESKTOP_SESSION_TOKEN", "a".repeat(64));
  run.mockClear();
  vi.mocked(context).mockImplementation(async (request) => {
    const scope = await actionContext(request, repo);
    const actions = new ActionService(repo, scope);
    return {
      repository: repo,
      actions,
      actionTools: createActionToolRegistry(
        repo,
        undefined,
        actions,
        new MacDesktopProvider(
          repo.userId,
          () =>
            assertDesktopAccess(repo.userId, scope.desktopAuthorized === true),
          run,
          async () => [],
          new EncryptedCalendarVault(join(dir, "vault"), "a".repeat(64)),
        ),
      ),
    } as unknown as Awaited<ReturnType<typeof context>>;
  });
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});
function req(
  body: unknown,
  extra: Record<string, string> = {},
  path = "actions/request",
) {
  return new Request(`http://localhost:3000/api/${path}`, {
    method: "POST",
    headers: {
      host: "127.0.0.1:3000",
      origin: "http://127.0.0.1:3000",
      "content-type": "application/json",
      "x-ary-desktop-session": "a".repeat(64),
      ...extra,
    },
    body: JSON.stringify(body),
  });
}
it.runIf(process.platform === "darwin")(
  "runs the existing HTTP request → approval → execution → audit/history → replay path",
  async () => {
    const raw = {
      tool: "desktop.volume",
      input: { operation_id: randomUUID(), level: 25 },
      request_key: randomUUID(),
      reason: "Isolated HTTP acceptance",
    };
    const pending = await handle(req(raw), ["actions", "request"]);
    expect(pending.status).toBe(409);
    const data = await pending.json();
    expect(data.code).toBe("approval_required");
    expect(run).not.toHaveBeenCalled();
    const review = await handle(
      req(
        { decision: "approved", reason: "Approve exact fixture" },
        {},
        `permissions/attempts/${data.action_id}/review`,
      ),
      ["permissions", "attempts", data.action_id, "review"],
    );
    // The review route takes an action ID and uses the existing owner-only control plane.
    expect(review.status).toBe(201);
    const response = await handle(req(raw), ["actions", "request"]);
    expect(response.status).toBe(201);
    const result = await response.json();
    expect(result.result.verb).toBe("volume");
    expect(run).toHaveBeenCalledTimes(1);
    const again = await handle(req(raw), ["actions", "request"]);
    expect(again.status).toBe(201);
    expect(await again.json()).toEqual(result);
    expect(run).toHaveBeenCalledTimes(1);
    const history = await handle(
      new Request("http://localhost:3000/api/actions/history"),
      ["actions", "history"],
    );
    expect(history.status).toBe(200);
    const rows = (await history.json()).items;
    expect(
      rows.some(
        (a: { tool_name: string; status: string }) =>
          a.tool_name === "desktop.volume" && a.status === "succeeded",
      ),
    ).toBe(true);
  },
);
it("blocks cross-origin, missing session proof, missing Origin and disabled-host actions before native dispatch", async () => {
  const raw = {
    tool: "desktop.list_apps",
    input: {},
    request_key: randomUUID(),
  };
  for (const extra of [
    { origin: "https://evil.test" },
    { origin: "" },
    { "x-ary-desktop-session": "" },
    { "x-ary-desktop-session": "b".repeat(64) },
  ]) {
    const response = await handle(
      req(raw, extra as unknown as Record<string, string>),
      ["actions", "request"],
    );
    expect(response.status).toBe(403);
  }
  vi.stubEnv("ARY_DESKTOP_BRIDGE_ENABLED", "false");
  expect((await handle(req(raw), ["actions", "request"])).status).toBe(403);
  expect(run).not.toHaveBeenCalled();
});
