import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { LocalRepository } from "../src/infrastructure/repositories/local";
import { ActionService } from "../src/services/action-service";
import { context } from "../src/server/context";
import { actionContext } from "../src/server/action-context";
import { handle } from "../src/server/http";
import { EntityService } from "../src/services/entity-service";
import { projectSnapshot } from "../src/domain/project-actions";
vi.mock("../src/server/context", () => ({
  context: vi.fn(),
  isDemo: () => false,
}));
let directory: string, repo: LocalRepository;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "ary-project-http-"));
  repo = new LocalRepository(randomUUID(), join(directory, "data.json"));
  vi.mocked(context).mockImplementation(
    async (request) =>
      ({
        repository: repo,
        actions: new ActionService(repo, await actionContext(request, repo)),
      }) as unknown as Awaited<ReturnType<typeof context>>,
  );
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});
async function post(path: string, body: unknown) {
  return handle(
    new Request(`http://localhost/api/${path}`, {
      method: "POST",
      headers: {
        origin: "http://localhost",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    }),
    path.split("/"),
  );
}
it("end-to-end HTTP proposal → approval → real project write → graph → audit → replay", async () => {
  const entities = new EntityService(repo);
  const project = await entities.createEntity({
    name: "Wag Trails",
    entity_type: "project",
  });
  const company = await entities.createEntity({
    name: "Clevaryn",
    entity_type: "company",
  });
  const blocker = await entities.createEntity({
    name: "Tracking bug",
    entity_type: "task",
  });
  await entities.linkEntities({
    source_entity_id: project.id,
    target_entity_id: company.id,
    relationship_type: "part_of",
  });
  const request = {
    tool: "update_project_status",
    product_entity_id: project.id,
    input: {
      project_id: project.id,
      expected_updated_at: project.updated_at,
      before: projectSnapshot(project, [], []),
      changes: {
        status: "blocked",
        health: "at_risk",
        blocker_entity_ids: [blocker.id],
      },
    },
    reason: "Owner review of the tracking issue",
    request_key: randomUUID(),
  };
  const first = await post("actions/request", request);
  expect(first.status).toBe(409);
  const prompt = await first.json();
  expect(prompt.code).toBe("approval_required");
  expect(await repo.get("entities", project.id)).toEqual(project);
  const review = await post(`permissions/attempts/${prompt.action_id}/review`, {
    decision: "approved",
    reason: "Approve exact project change",
  });
  expect(review.status).toBe(201);
  const executed = await post("actions/request", request);
  expect(executed.status).toBe(201);
  const result = await executed.json();
  expect(result.result.simulated).toBe(false);
  expect((await repo.get("entities", project.id))?.metadata.status).toBe(
    "blocked",
  );
  const replay = await post("actions/request", request);
  expect(replay.status).toBe(201);
  expect(await replay.json()).toEqual(result);
  expect(
    await repo.list("relationships", { relationship_type: "blocks" }),
  ).toHaveLength(1);
  const history = await handle(
    new Request("http://localhost/api/actions/history"),
    ["actions", "history"],
  );
  expect(history.status).toBe(200);
  const attempts = (await repo.list("actions")).filter(
    (a) => a.tool_name === "update_project_status",
  );
  expect(attempts.some((a) => a.status === "approval_required")).toBe(true);
  expect(attempts.some((a) => a.metadata.replay_of === result.action_id)).toBe(
    true,
  );
  const graph = await repo.queryGraph({
    root: project.id,
    depth: 1,
    q: "",
    types: [],
    relationships: "current",
    limit: 80,
    edge_limit: 400,
  });
  expect(graph.nodes.find((n) => n.id === project.id)?.activeBlockerCount).toBe(
    1,
  );
});
