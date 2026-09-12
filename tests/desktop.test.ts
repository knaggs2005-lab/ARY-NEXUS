import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
const require = createRequire(import.meta.url);
const {
  isAryUrl,
  isExternalWebUrl,
  allowPermission,
  requestMediaAccess,
} = require("../desktop/security.cjs");
const { createServerManager } = require("../desktop/server-manager.cjs");
const config = {
  projectRoot: process.cwd(),
  nodeExecutable: process.execPath,
  logPath: "/tmp/ary-desktop-test.log",
};
describe("Desktop trust and server ownership", () => {
  it("restricts navigation to the exact local Ary origin", () => {
    expect(isAryUrl("http://127.0.0.1:3000/api/config")).toBe(true);
    for (const url of [
      "http://127.0.0.1:3001",
      "http://127.0.0.1.evil:3000",
      "file:///etc/passwd",
      "javascript:alert(1)",
      "https://example.com",
    ])
      expect(isAryUrl(url)).toBe(false);
    expect(isExternalWebUrl("https://example.com")).toBe(true);
    expect(isExternalWebUrl("file:///etc/passwd")).toBe(false);
  });
  it("allows camera and microphone only from Ary, rejecting unknown media", () => {
    expect(
      allowPermission("media", "http://127.0.0.1:3000", {
        mediaTypes: ["audio"],
      }),
    ).toBe(true);
    expect(
      allowPermission("media", "http://127.0.0.1:3000", {
        mediaTypes: ["video"],
      }),
    ).toBe(true);
    expect(
      allowPermission("media", "http://127.0.0.1:3000", { mediaType: "video" }),
    ).toBe(true);
    expect(
      allowPermission("media", "http://127.0.0.1:3000", {
        mediaTypes: ["audio", "video"],
      }),
    ).toBe(true);
    for (const [permission, origin, details] of [
      ["media", "https://example.com", { mediaTypes: ["audio"] }],
      ["media", "http://127.0.0.1:3000", { mediaTypes: ["unknown"] }],
      ["media", "http://127.0.0.1:3000", {}],
      ["geolocation", "http://127.0.0.1:3000", {}],
    ])
      expect(allowPermission(permission, origin, details)).toBe(false);
  });
  it("reuses an existing dev server and never kills it when quitting", async () => {
    const spawn = vi.fn(),
      kill = vi.fn();
    const manager = createServerManager(config, {
      probe: async () => "ary",
      spawn,
      kill,
    });
    expect(await manager.ensure()).toMatchObject({ owned: false });
    await manager.stop();
    expect(spawn).not.toHaveBeenCalled();
    expect(kill).not.toHaveBeenCalled();
  });
  it("refuses unrelated and production servers without spawning or terminating anything", async () => {
    for (const state of ["other", "production"]) {
      const spawn = vi.fn(),
        kill = vi.fn();
      const manager = createServerManager(config, {
        probe: async () => state,
        spawn,
        kill,
      });
      await expect(manager.ensure()).rejects.toThrow(
        state === "other" ? "Port 3000" : "production mode",
      );
      await manager.stop();
      expect(spawn).not.toHaveBeenCalled();
      expect(kill).not.toHaveBeenCalled();
    }
  });
  it("starts a loopback-only server without shell interpolation and shuts down only its own process group", async () => {
    const child = Object.assign(new EventEmitter(), {
      pid: 12345,
      exitCode: null as number | null,
      signalCode: null as string | null,
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
    });
    let probes = 0;
    const spawn = vi.fn(
      (
        _executable: string,
        _args: string[],
        _options: { cwd: string; detached: boolean; shell?: boolean },
      ) => child,
    );
    const kill = vi.fn(() => {
      child.signalCode = "SIGTERM";
      child.emit("exit", null);
    });
    const manager = createServerManager(config, {
      probe: async () => (probes++ ? "ary" : "absent"),
      spawn,
      kill,
      wait: async () => {},
    });
    expect(await manager.ensure()).toMatchObject({ owned: true });
    expect(spawn.mock.calls[0][1]).toEqual([
      expect.stringContaining("next/dist/bin/next"),
      "dev",
      "--webpack",
      "--hostname",
      "127.0.0.1",
      "--port",
      "3000",
    ]);
    expect(spawn.mock.calls[0][2]).toMatchObject({
      cwd: process.cwd(),
      detached: true,
      env: expect.objectContaining({ WS_NO_BUFFER_UTIL: "1" }),
    });
    expect(spawn.mock.calls[0][2].shell).toBeUndefined();
    await manager.stop();
    expect(kill).toHaveBeenCalledExactlyOnceWith(-12345, "SIGTERM");
  });
});

it("asks macOS for the requested device rather than always asking for microphone", async () => {
  const ask = vi.fn(async () => true);
  expect(await requestMediaAccess({ mediaTypes: ["video"] }, ask)).toBe(true);
  expect(ask).toHaveBeenCalledExactlyOnceWith("camera");
  ask.mockClear();
  expect(
    await requestMediaAccess({ mediaTypes: ["audio", "video", "audio"] }, ask),
  ).toBe(true);
  expect(ask.mock.calls).toEqual([["microphone"], ["camera"]]);
});
it("denied and unknown capture requests fail closed", async () => {
  const ask = vi.fn(async () => false);
  expect(await requestMediaAccess({ mediaTypes: ["video"] }, ask)).toBe(false);
  ask.mockClear();
  expect(await requestMediaAccess({ mediaTypes: ["unknown"] }, ask)).toBe(
    false,
  );
  expect(ask).not.toHaveBeenCalled();
});
