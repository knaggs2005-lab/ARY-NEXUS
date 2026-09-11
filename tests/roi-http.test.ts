import { it, expect, vi, beforeEach } from "vitest";
import { context } from "../src/server/context";
import { handle } from "../src/server/http";
import { AppError } from "../src/domain/validation";
vi.mock("../src/server/context", () => ({
  context: vi.fn(),
  isDemo: () => false,
}));
const report = vi.fn(),
  recordCost = vi.fn(),
  recordOutcome = vi.fn(),
  run = vi.fn();
beforeEach(() => {
  vi.resetAllMocks();
  run.mockImplementation(async (_tool, _conversation, operation) =>
    operation(),
  );
  vi.mocked(context).mockResolvedValue({
    roi: { report, recordCost, recordOutcome },
    actions: { run },
  } as unknown as Awaited<ReturnType<typeof context>>);
});
it("retains roi.read gate for the extended economics report", async () => {
  report.mockResolvedValue({ month: "2026-09", trends: [] });
  const response = await handle(
    new Request("http://localhost/api/roi?month=2026-09"),
    ["roi"],
  );
  expect(response.status).toBe(200);
  expect(run.mock.calls[0][0]).toBe("roi.read");
  expect(report).toHaveBeenCalledWith("2026-09");
});
it("denial prevents economics reads", async () => {
  run.mockRejectedValue(new AppError("Not permitted", 403));
  const response = await handle(new Request("http://localhost/api/roi"), [
    "roi",
  ]);
  expect(response.status).toBe(403);
  expect(report).not.toHaveBeenCalled();
});
it("new cost fields retain the existing record permission and action pipeline", async () => {
  const payload = {
    action_id: "fixture",
    tool_cost_usd: 3,
    additional_compute_cost_usd: 2,
  };
  recordCost.mockResolvedValue({ id: "new" });
  const response = await handle(
    new Request("http://localhost/api/roi/costs", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
    ["roi", "costs"],
  );
  expect(response.status).toBe(201);
  expect(run.mock.calls[0][0]).toBe("roi.record");
  expect(recordCost).toHaveBeenCalledWith(payload);
});
it("requires authentication for economics", async () => {
  vi.mocked(context).mockRejectedValue(new AppError("Sign in", 401));
  expect(
    (await handle(new Request("http://localhost/api/roi"), ["roi"])).status,
  ).toBe(401);
  expect(report).not.toHaveBeenCalled();
});
