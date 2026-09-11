import { afterEach, expect, it, vi } from "vitest";
import { handle } from "../src/server/http";
afterEach(() => vi.unstubAllEnvs());
it("requires authentication and same-origin writes for action requests", async () => {
  vi.stubEnv("ARY_STORAGE", "supabase");
  for (const [origin, status] of [
    ["http://localhost", 401],
    ["https://attacker.example", 403],
  ] as const) {
    const result = await handle(
      new Request("http://localhost/api/actions/request", {
        method: "POST",
        headers: { origin },
        body: JSON.stringify({ tool: "mock.observe", input: {} }),
      }),
      ["actions", "request"],
    );
    expect(result.status).toBe(status);
  }
});
it("accepts the actual same-origin Host when Next normalizes its internal URL", async () => {
  vi.stubEnv("ARY_STORAGE", "supabase");
  const request = new Request("http://localhost:3000/api/chat", {
    method: "POST",
    headers: { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" },
    body: "{}",
  });
  const result = await handle(request, ["chat"]);
  expect(result.status).toBe(401);
  expect(await result.json()).toEqual({ error: "Sign in to continue" });
});
it("rejects cross-origin browser writes before running services", async () => {
  const result = await handle(
    new Request("http://localhost:3000/api/chat", {
      method: "POST",
      headers: { host: "localhost:3000", origin: "https://attacker.example" },
      body: "{}",
    }),
    ["chat"],
  );
  expect(result.status).toBe(403);
});
it("refuses demo identity in production", async () => {
  vi.stubEnv("ARY_STORAGE", "demo");
  vi.stubEnv("NODE_ENV", "production");
  const result = await handle(
    new Request("http://localhost:3000/api/dashboard"),
    ["dashboard"],
  );
  expect(result.status).toBe(503);
});
it("hides reflection APIs in production before accessing user data", async () => {
  vi.stubEnv("NODE_ENV", "production");
  expect(
    (
      await handle(new Request("http://localhost:3000/api/reflection"), [
        "reflection",
      ])
    ).status,
  ).toBe(404);
});
it("hides the synthetic graph fixture in production and authenticates graph queries", async () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("ARY_STORAGE", "supabase");
  expect(
    (
      await handle(new Request("http://localhost/api/brain-graph/sample"), [
        "brain-graph",
        "sample",
      ])
    ).status,
  ).toBe(404);
  expect(
    (
      await handle(new Request("http://localhost/api/brain-graph"), [
        "brain-graph",
      ])
    ).status,
  ).toBe(401);
});

it("exposes only desktop identity and live-update capability before authentication", async () => {
  for (const environment of ["development", "production"]) {
    vi.stubEnv("NODE_ENV", environment);
    const response = await handle(
      new Request("http://localhost:3000/api/desktop/health"),
      ["desktop", "health"],
    );
    expect(await response.json()).toEqual({
      application: "ary-nexus",
      protocol: 1,
      liveUpdates: environment === "development",
    });
  }
});
