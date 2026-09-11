import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { Script } from "node:vm";
import {
  desktopSchemas,
  type DesktopVerb,
  type InstalledApp,
} from "../src/domain/desktop";
import {
  desktopRequestAuthorized,
  assertDesktopAccess,
} from "../src/infrastructure/desktop/security";
import { MacDesktopProvider } from "../src/infrastructure/desktop/mac-desktop";
import {
  macPrivacyError,
  type MacRunner,
} from "../src/infrastructure/desktop/process";
import { macScripts } from "../src/infrastructure/desktop/scripts";
import {
  scanInstalledApps,
  resolveInstalledApp,
} from "../src/infrastructure/desktop/apps";
import { EncryptedCalendarVault } from "../src/infrastructure/calendar/vault";
import { registerDesktopTools } from "../src/infrastructure/tools/desktop-tools";
import { ToolRegistry } from "../src/domain/tool-registry";
import {
  ActionService,
  ApprovalRequiredError,
} from "../src/services/action-service";
import { ActionRequestService } from "../src/services/action-request-service";
import { LocalRepository } from "../src/infrastructure/repositories/local";
import { AppError } from "../src/domain/validation";
const require = createRequire(import.meta.url);
const { desktopSessionHeaders } = require("../desktop/security.cjs");
let directory: string,
  repo: LocalRepository,
  actions: ActionService,
  requests: ActionRequestService,
  provider: MacDesktopProvider;
let run: ReturnType<typeof vi.fn<MacRunner>>;
let available = true;
const installed: InstalledApp[] = [
  {
    id: "com.apple.TextEdit",
    name: "TextEdit",
    path: "/System/Applications/TextEdit.app",
  },
  {
    id: "com.apple.Music",
    name: "Music",
    path: "/System/Applications/Music.app",
  },
];
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "ary-bridge-"));
  repo = new LocalRepository(randomUUID(), join(directory, "data.json"));
  actions = new ActionService(repo);
  available = true;
  run = vi.fn<MacRunner>(async (file, args, stdin) =>
    file === "/usr/bin/shortcuts" && args[0] === "list"
      ? "Ary Focus On\nAry Focus Off"
      : stdin === macScripts.create_note
        ? "x-coredata://note/123"
        : stdin === macScripts.create_reminder
          ? "x-apple-reminder://123"
          : "accepted",
  );
  provider = new MacDesktopProvider(
    repo.userId,
    () => {
      if (!available) throw new AppError("Desktop disabled", 403);
    },
    run,
    async () => installed,
    new EncryptedCalendarVault(join(directory, "vault"), "a".repeat(64)),
  );
  requests = new ActionRequestService(
    repo,
    actions,
    registerDesktopTools(new ToolRegistry(), provider),
  );
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});
const request = (verb: DesktopVerb, fields: Record<string, unknown> = {}) => ({
  tool: `desktop.${verb}`,
  input: { operation_id: randomUUID(), ...fields },
  request_key: randomUUID(),
  reason: "Isolated bridge verification",
});
async function approve(raw: unknown) {
  try {
    await requests.request(raw);
  } catch (e) {
    expect(e).toBeInstanceOf(ApprovalRequiredError);
    await actions.permissions.review(
      (e as ApprovalRequiredError).actionId,
      "approved",
      "Approve isolated test",
    );
    return;
  }
  throw Error("Approval was bypassed");
}

it("requires exact loopback origin, owning launcher proof and POST without forwarded remote addresses", () => {
  vi.stubEnv("ARY_DESKTOP_SESSION_TOKEN", "a".repeat(64));
  const headers = {
    host: "127.0.0.1:3000",
    origin: "http://127.0.0.1:3000",
    "x-ary-desktop-session": "a".repeat(64),
  };
  const check = (
    h: Record<string, string>,
    url = "http://127.0.0.1:3000/api/actions/request",
    method = "POST",
  ) => desktopRequestAuthorized(new Request(url, { method, headers: h }));
  expect(check(headers)).toBe(true);
  expect(check({ ...headers, "x-forwarded-for": "127.0.0.1" })).toBe(true);
  for (const field of Object.keys(headers)) {
    const copy = { ...headers };
    delete copy[field as keyof typeof copy];
    expect(check(copy)).toBe(false);
  }
  for (const extra of [
    { origin: "null" },
    { origin: "https://evil.test" },
    { host: "evil.test" },
    { "x-ary-desktop-session": "b".repeat(64) },
    { "x-ary-desktop-session": "x".repeat(64) },
    { "x-forwarded-for": "203.0.113.1" },
    { forwarded: "for=127.0.0.1" },
  ])
    expect(
      check({ ...headers, ...extra } as unknown as Record<string, string>),
    ).toBe(false);
  expect(check(headers, "https://remote.example/api/actions/request")).toBe(
    false,
  );
  expect(check(headers, undefined, "GET")).toBe(false);
});
it("injects session proof only for the owning webContents and same-origin API POST, stripping spoofed proof elsewhere", () => {
  const d = {
    url: "http://127.0.0.1:3000/api/actions/request",
    method: "POST",
    webContentsId: 3,
    requestHeaders: {
      Origin: "http://127.0.0.1:3000",
      "x-ary-desktop-session": "spoof",
    },
  };
  expect(
    desktopSessionHeaders(d, 3, "a".repeat(64))["X-Ary-Desktop-Session"],
  ).toBe("a".repeat(64));
  for (const changes of [
    { url: "https://evil.test" },
    { method: "GET" },
    { webContentsId: 4 },
    { requestHeaders: { Origin: "https://evil.test" } },
    { url: "http://127.0.0.1:3000/not-api" },
  ])
    expect(
      JSON.stringify(
        desktopSessionHeaders({ ...d, ...changes }, 3, "a".repeat(64)),
      ),
    ).not.toContain("a".repeat(64));
  expect(desktopSessionHeaders(d, 3, null)).toEqual({
    Origin: d.requestHeaders.Origin,
  });
});
it("is disabled by default, requires a pinned authenticated owner and fails closed for non-desktop requests", () => {
  vi.stubEnv("ARY_DESKTOP_BRIDGE_ENABLED", "false");
  expect(() => assertDesktopAccess(repo.userId, true)).toThrow();
  vi.stubEnv("ARY_DESKTOP_BRIDGE_ENABLED", "true");
  vi.stubEnv("ARY_STORAGE", "supabase");
  vi.stubEnv("ARY_DESKTOP_USER_ID", repo.userId);
  if (process.platform === "darwin")
    expect(() => assertDesktopAccess(repo.userId, true)).not.toThrow();
  expect(() => assertDesktopAccess(randomUUID(), true)).toThrow();
  expect(() => assertDesktopAccess(repo.userId, false)).toThrow();
  vi.stubEnv("ARY_STORAGE", "demo");
  expect(() => assertDesktopAccess(repo.userId, true)).toThrow();
});
it("scans current bundle identifiers and rejects unknown, duplicate and injected application names", async () => {
  const app = join(directory, "Apps/Test.app/Contents");
  await mkdir(app, { recursive: true });
  await writeFile(join(app, "Info.plist"), "fixture");
  const plutil = vi.fn<MacRunner>(async () =>
    JSON.stringify({
      CFBundleIdentifier: "org.example.Test",
      CFBundleName: "Test",
    }),
  );
  const scanned = await scanInstalledApps(plutil, [join(directory, "Apps")]);
  expect(scanned[0].id).toBe("org.example.Test");
  expect(plutil.mock.calls[0][0]).toBe("/usr/bin/plutil");
  expect(() => resolveInstalledApp(installed, "com.missing.App")).toThrow(
    "not installed",
  );
  expect(() =>
    resolveInstalledApp([...installed, installed[0]], installed[0].id),
  ).toThrow("Ambiguous");
  for (const text of [
    "TextEdit; touch /tmp/owned",
    "$(whoami)",
    "`id`",
    "../TextEdit.app",
    "-a Terminal",
    "com.apple.TextEdit\nopen Calculator",
    'com.apple.TextEdit\"; doShellScript("id")',
  ])
    expect(() => resolveInstalledApp(installed, text)).toThrow(
      "Invalid application",
    );
});
it.each([
  "shutdown",
  "restart",
  "delete_file",
  "kill",
  "exec",
  "__proto__",
  "constructor",
  "media; id",
])(
  "rejects unregistered action %s and logs the failed attempt",
  async (verb) => {
    await expect(
      requests.request({
        tool: `desktop.${verb}`,
        input: {},
        request_key: randomUUID(),
      }),
    ).rejects.toThrow();
    expect(run).not.toHaveBeenCalled();
    expect(await repo.list("actions")).toHaveLength(1);
    expect(await repo.list("outcomes")).toHaveLength(1);
  },
);
it.each([
  "TextEdit; touch /tmp/owned",
  "$(id)",
  "com.apple.TextEdit\nwhoami",
  'com.apple.TextEdit\"; quit()',
])("rejects app injection before approval: %s", async (app_id) => {
  await expect(
    requests.request(request("launch_app", { app_id })),
  ).rejects.toThrow("Invalid tool input");
  expect(run).not.toHaveBeenCalled();
  expect((await repo.list("actions"))[0].status).toBe("failed");
});
it("rejects injected commands, extra fields, non-web URLs, invalid volume and missing execution keys", async () => {
  for (const [verb, fields] of [
    ["media", { player: "music", command: "pause; id" }],
    ["open_website", { url: "file:///etc/passwd" }],
    ["open_website", { url: "javascript:alert(1)" }],
    ["open_website", { url: "https://user:pass@example.com" }],
    ["volume", { level: 101 }],
    ["lock_screen", { shell: "id" }],
  ] as const)
    await expect(requests.request(request(verb, fields))).rejects.toThrow(
      "Invalid tool input",
    );
  await expect(
    requests.request({ tool: "desktop.list_apps", input: {} }),
  ).rejects.toThrow("request key");
  expect(run).not.toHaveBeenCalled();
});
it.each([0, 1, 2, 3])(
  "blocks changes at permission level %i",
  async (level) => {
    await actions.permissions.savePolicy({
      tool: "desktop.volume",
      level,
      reason: "Isolated policy",
    });
    await expect(
      requests.request(request("volume", { level: 25 })),
    ).rejects.toMatchObject({ status: 403 });
    expect(run).not.toHaveBeenCalled();
    expect((await repo.list("outcomes"))[0].status).toBe("failure");
  },
);
it.each([4, 5])(
  "requires exact approval even at level %i and rejects edited input",
  async (level) => {
    await actions.permissions.savePolicy({
      tool: "desktop.volume",
      level,
      reason: "Isolated policy",
    });
    const raw = request("volume", { level: 25 });
    await approve(raw);
    expect(run).not.toHaveBeenCalled();
    await expect(
      requests.request({ ...raw, input: { ...raw.input, level: 26 } }),
    ).rejects.toBeInstanceOf(ApprovalRequiredError);
    expect(run).not.toHaveBeenCalled();
    await requests.request(raw);
    expect(run).toHaveBeenCalledTimes(1);
  },
);
it("does not execute a rejected approval or a policy revoked after approval", async () => {
  const raw = request("volume", { level: 25 });
  let id = "";
  try {
    await requests.request(raw);
  } catch (e) {
    id = (e as ApprovalRequiredError).actionId;
  }
  await actions.permissions.review(id, "rejected", "Do not change volume");
  await expect(requests.request(raw)).rejects.toBeInstanceOf(
    ApprovalRequiredError,
  );
  expect(run).not.toHaveBeenCalled();
  await approve(raw);
  await actions.permissions.savePolicy({
    tool: "desktop.volume",
    level: 0,
    reason: "Revoked",
  });
  await expect(requests.request(raw)).rejects.toMatchObject({ status: 403 });
  expect(run).not.toHaveBeenCalled();
});
it("audits successful execution, approval, outcome and exact replay without changing any knowledge", async () => {
  const raw = request("launch_app", { app_id: installed[0].id });
  await approve(raw);
  const first = await requests.request(raw);
  expect(first.result.dispatched).toBe(true);
  expect(await requests.request(raw)).toEqual(first);
  expect(run).toHaveBeenCalledTimes(1);
  expect(run.mock.calls[0]).toEqual(["/usr/bin/open", [installed[0].path]]);
  const log = await repo.list("actions");
  expect(log.map((a) => a.status)).toEqual([
    "approval_required",
    "succeeded",
    "succeeded",
  ]);
  expect(log[1].metadata.approval_id).toBeTruthy();
  expect(log[1].metadata.simulated).toBe(false);
  expect(log[1].metadata.external).toBe(true);
  expect((await repo.list("outcomes")).map((o) => o.status)).toEqual([
    "pending",
    "success",
    "success",
  ]);
  for (const table of ["memories", "entities", "tasks"] as const)
    expect(await repo.list(table)).toHaveLength(0);
  await expect(requests.remember(first.action_id)).rejects.toThrow(
    "not copied",
  );
});
it("recovers a durable receipt on a newly reviewed retry after the action/outcome database commit failed", async () => {
  const raw = request("create_note", {
    title: "Fixture",
    body: "Fixture only",
  });
  await approve(raw);
  const original = repo.batch.bind(repo);
  const failure = vi
    .spyOn(repo, "batch")
    .mockRejectedValueOnce(new Error("transient database failure"));
  await expect(requests.request(raw)).rejects.toThrow("transient");
  failure.mockImplementation(original);
  expect(run).toHaveBeenCalledTimes(1);
  const retry = { ...raw, request_key: randomUUID() };
  await approve(retry);
  const result = await requests.request(retry);
  expect(result.result.record_id).toBe("x-coredata://note/123");
  expect(run).toHaveBeenCalledTimes(1);
  expect((await repo.list("actions")).some((a) => a.status === "failed")).toBe(
    true,
  );
});
it("does not repeat an uncertain native failure, even with a new action key", async () => {
  const raw = request("create_reminder", {
    title: "Fixture",
    notes: "Fixture only",
  });
  run.mockRejectedValueOnce(new AppError("Native timeout", 502));
  await approve(raw);
  await expect(requests.request(raw)).rejects.toThrow("Native timeout");
  const retry = { ...raw, request_key: randomUUID() };
  await approve(retry);
  await expect(requests.request(retry)).rejects.toThrow("uncertain");
  expect(run).toHaveBeenCalledTimes(1);
});
it("rejects reuse of an operation ID with different native inputs", async () => {
  const raw = request("volume", { level: 25 });
  await approve(raw);
  await requests.request(raw);
  const different = {
    ...raw,
    input: { ...raw.input, level: 40 },
    request_key: randomUUID(),
  };
  await approve(different);
  await expect(requests.request(different)).rejects.toThrow("different inputs");
  expect(run).toHaveBeenCalledTimes(1);
});
it("rechecks the enable gate before replay and execution", async () => {
  const raw = request("volume", { level: 25 });
  await approve(raw);
  available = false;
  await expect(requests.request(raw)).rejects.toThrow("disabled");
  expect(run).not.toHaveBeenCalled();
  available = true;
  await requests.request(raw);
  available = false;
  await expect(requests.request(raw)).rejects.toThrow("disabled");
  expect(run).toHaveBeenCalledTimes(1);
});
it("supports each fixed verb and passes user content as argv, never script source", async () => {
  const literal =
    '\"; doShellScript("touch /tmp/owned"); $(id) `id` <script>bad</script>\nsecond line';
  const fields: Record<DesktopVerb, Record<string, unknown>> = {
    list_apps: {},
    launch_app: { app_id: installed[0].id },
    open_website: { url: "https://example.com/?q=%24%28id%29" },
    media: { player: "music", command: "next" },
    volume: { level: 30 },
    clipboard_read: {},
    clipboard_write: { text: literal },
    hide_others: { app_id: installed[0].id },
    quit_app: { app_id: installed[0].id },
    lock_screen: {},
    sleep_display: {},
    do_not_disturb: { enabled: true },
    create_note: { title: "Fixture", body: literal },
    create_reminder: {
      title: "Fixture",
      notes: literal,
      due_at: "2026-09-10T12:00:00-07:00",
    },
  };
  for (const verb of Object.keys(fields) as DesktopVerb[]) {
    const raw = request(verb, fields[verb]);
    if (["list_apps", "clipboard_read"].includes(verb))
      delete (raw.input as Record<string, unknown>).operation_id;
    if (verb !== "list_apps") await approve(raw);
    await requests.request(raw);
  }
  for (const [file, args, stdin] of run.mock.calls) {
    expect([
      "/usr/bin/open",
      "/usr/bin/osascript",
      "/usr/bin/shortcuts",
      "/usr/bin/pmset",
    ]).toContain(file);
    expect(file).not.toMatch(/sh$/);
    if (stdin) {
      expect(Object.values(macScripts)).toContain(stdin);
      expect(stdin).not.toContain(literal);
      expect(args.slice(0, 3)).toEqual(["-l", "JavaScript", "-"]);
    }
  }
  expect(run.mock.calls.some(([, args]) => args.includes(literal))).toBe(true);
});
it("does not dispatch missing Focus shortcuts and translates privacy/cancel/timeout failures without leaking stderr", async () => {
  run.mockResolvedValue("unrelated shortcut");
  const raw = request("do_not_disturb", { enabled: true });
  await approve(raw);
  await expect(requests.request(raw)).rejects.toThrow("Ary Focus On");
  expect(run.mock.calls.every(([, args]) => args[0] === "list")).toBe(true);
  expect(macPrivacyError("private text -1743").message).toContain(
    "Privacy & Security",
  );
  expect(macPrivacyError("private text -1743").message).not.toContain(
    "private text",
  );
  expect(macPrivacyError("user cancelled (-128)").status).toBe(409);
  expect(macPrivacyError("", { killed: true }).message).toContain("uncertain");
});
it("contains valid fixed JavaScript programs and no command-string execution primitives", () => {
  for (const script of Object.values(macScripts)) {
    expect(() => new Script(script)).not.toThrow();
    expect(script).not.toMatch(/doShellScript|eval\(|Function\(/);
  }
  expect(Object.keys(desktopSchemas)).not.toEqual(
    expect.arrayContaining(["shutdown", "restart", "delete_file", "kill"]),
  );
});

it("creates Notes HTML as escaped data and retains line breaks, without evaluating input", () => {
  let properties: { name: string; body: string } | undefined;
  const pushed: unknown[] = [];
  const app = {
    defaultAccount: {
      defaultFolder: () => ({
        notes: { push: (v: unknown) => pushed.push(v) },
      }),
    },
    Note: (value: { name: string; body: string }) => {
      properties = value;
      return { id: () => "fixture-note-id" };
    },
  };
  const context = {
    Application: () => app,
    input: ["Title", '<script>throw Error("injected")</script>\nsecond line'],
  };
  expect(
    new Script(macScripts.create_note + "; run(input)").runInNewContext(
      context,
    ),
  ).toBe("fixture-note-id");
  expect(properties!.body).toContain("&lt;script&gt;");
  expect(properties!.body).toContain("<br>second line");
  expect(pushed).toHaveLength(1);
});
it("keeps an uncertain guard when receipt persistence fails after native success", async () => {
  const vault = new EncryptedCalendarVault(
    join(directory, "receipt-failure"),
    "a".repeat(64),
  );
  const write = vault.write.bind(vault);
  let count = 0;
  vi.spyOn(vault, "write").mockImplementation(async (key, value) => {
    if (++count === 2) throw Error("receipt unavailable");
    return write(key, value);
  });
  const native = new MacDesktopProvider(
    repo.userId,
    () => {},
    run,
    async () => installed,
    vault,
  );
  const raw = { operation_id: randomUUID(), title: "Fixture", body: "Fixture" };
  await expect(native.execute("create_note", raw)).rejects.toThrow(
    "outcome is uncertain",
  );
  await expect(native.execute("create_note", raw)).rejects.toThrow("uncertain");
  expect(run).toHaveBeenCalledTimes(1);
});
