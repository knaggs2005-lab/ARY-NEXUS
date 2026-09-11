import { beforeEach, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { context } from "../src/server/context";
import { handle } from "../src/server/http";
import { AppError } from "../src/domain/validation";
vi.mock("../src/server/context", () => ({
  context: vi.fn(),
  isDemo: () => false,
}));
const run = vi.fn(),
  history = vi.fn();
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(context).mockResolvedValue({
    board: { run, history },
  } as unknown as Awaited<ReturnType<typeof context>>);
});
const post = (data: unknown = { request_key: randomUUID() }) =>
  handle(
    new Request("http://localhost/api/board/meetings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
    ["board", "meetings"],
  );
it("streams actual stage events and final confirmation", async () => {
  run.mockImplementation(async (_, emit) => {
    emit({ type: "stage", stage: "Specialist review" });
    emit({ type: "complete", report: { id: "fixture" } });
  });
  const r = await post();
  expect(r.headers.get("content-type")).toBe("application/x-ndjson");
  expect(r.headers.get("cache-control")).toBe("no-store");
  const lines = (await r.text())
    .trim()
    .split("\n")
    .map((v) => JSON.parse(v));
  expect(lines.map((l) => l.type)).toEqual(["stage", "complete"]);
  expect(run.mock.calls[0][2]).toBeInstanceOf(AbortSignal);
});
it("does not disguise pipeline denial as success", async () => {
  run.mockRejectedValue(new AppError("Board is not permitted", 403));
  const r = await post();
  expect(JSON.parse((await r.text()).trim())).toEqual({
    type: "error",
    error: "Board is not permitted",
  });
});
it("validates request fields before invoking the meeting", async () => {
  expect((await post({ request_key: "invalid", execute: true })).status).toBe(
    400,
  );
  expect(run).not.toHaveBeenCalled();
});
it("requires authentication", async () => {
  vi.mocked(context).mockRejectedValue(new AppError("Sign in", 401));
  expect((await post()).status).toBe(401);
  expect(run).not.toHaveBeenCalled();
});
it("uses existing conversation access for history", async () => {
  history.mockResolvedValue([{ id: "saved" }]);
  const r = await handle(new Request("http://localhost/api/board/meetings"), [
    "board",
    "meetings",
  ]);
  expect(await r.json()).toEqual([{ id: "saved" }]);
});
it("blocks cross-origin writes", async () => {
  const r = await handle(
    new Request("http://localhost/api/board/meetings", {
      method: "POST",
      headers: { Origin: "https://other.invalid" },
      body: "{}",
    }),
    ["board", "meetings"],
  );
  expect(r.status).toBe(403);
  expect(run).not.toHaveBeenCalled();
});
