import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { LocalRepository } from "../src/infrastructure/repositories/local";
import { ActionService } from "../src/services/action-service";
import { PermissionService } from "../src/services/permission-service";
import { context } from "../src/server/context";
import { handle } from "../src/server/http";
import { AppError } from "../src/domain/validation";
vi.mock("../src/server/context", () => ({
  context: vi.fn(),
  isDemo: () => false,
}));
let directory: string, repo: LocalRepository;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "ary-priority-http-"));
  repo = new LocalRepository(randomUUID(), join(directory, "db.json"));
  vi.mocked(context).mockImplementation(
    async () =>
      ({
        repository: repo,
        actions: new ActionService(repo),
      }) as unknown as Awaited<ReturnType<typeof context>>,
  );
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(directory, { recursive: true, force: true });
});
const get = () =>
  handle(new Request("http://localhost/api/priorities"), ["priorities"]);
it("reads existing work through permissions without modifying the work", async () => {
  const task = await repo.insert("tasks", {
    title: "Priority HTTP evidence",
    description: "",
    status: "pending",
    priority: 3,
    due_at: null,
    entity_id: null,
    goal_id: null,
    metadata: {},
  });
  const response = await get();
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const report = await response.json();
  expect(report.items[0].record_id).toBe(task.id);
  expect(await repo.get("tasks", task.id)).toEqual(task);
});
it.each(["activity.read", "entity.read", "roi.read"])(
  "denied %s prevents priority evidence access",
  async (tool) => {
    await new PermissionService(repo).savePolicy({
      tool,
      level: 0,
      reason: "Private evidence",
    });
    const read = vi.spyOn(repo, "list");
    const response = await get();
    expect(response.status).toBe(403);
    expect(
      read.mock.calls.some(([table]) =>
        ["tasks", "goals", "entities", "roi_outcome_entries"].includes(table),
      ),
    ).toBe(false);
  },
);
it("rejects unauthenticated access", async () => {
  vi.mocked(context).mockRejectedValueOnce(
    new AppError("Sign in to continue", 401),
  );
  expect((await get()).status).toBe(401);
});
