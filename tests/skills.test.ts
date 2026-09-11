import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { missionFixture } from "../scripts/lib/mission-fixture";
import { SkillService } from "../src/services/skill-service";
import { registerSkillTools } from "../src/infrastructure/tools/skill-tools";
import { ApprovalRequiredError } from "../src/services/action-service";
import {
  skillExamples,
  skillDefinition,
  bindSkillInputs,
  type SkillDefinition,
  type SkillRecord,
} from "../src/domain/skills";
import { OrchestrationConversationService } from "../src/services/orchestration-conversation-service";
import type { ExecutionPlan } from "../src/domain/orchestration";
let project: string,
  dir: string,
  f: ReturnType<typeof missionFixture>,
  service: SkillService;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ary-skills-"));
  f = missionFixture(join(dir, "data.json"), randomUUID());
  service = new SkillService(f.repo, f.tools, f.coordinator);
  registerSkillTools(f.tools, service);
  project = (
    await f.entities.createEntity({ name: "Clevaryn", entity_type: "company" })
  ).id;
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});
const request = (
  tool: string,
  input: Record<string, unknown>,
  key = randomUUID(),
) =>
  f.coordinator.requests.request({
    tool,
    input,
    request_key: key,
    reason: "Isolated Skills acceptance",
  });
function definition(): SkillDefinition {
  return {
    ...skillExamples()[0],
    title: "Onboarding task",
    inputs: [],
    outputs: [
      {
        name: "task",
        step: "create",
        path: ["result", "task_id"],
        description: "Created task ID",
      },
    ],
    permissions: ["create_task", "task.inspect"],
    steps: [
      {
        id: "create",
        title: "Create onboarding checklist",
        tool: "create_task",
        input: {
          title: "Prepare client onboarding",
          priority: 3,
          project_id: project,
        },
        depends_on: [],
        critical: true,
        missing: [],
        source_action_from: null,
        repeat: 1,
        verification: {
          tool: "task.inspect",
          input: { task_id: { $from: "create", path: ["result", "task_id"] } },
          path: ["status"],
          equals: "pending",
          description: "Task exists and is pending",
        },
      },
    ],
  };
}
async function save(d = definition()) {
  const r = await request("skill.save", { definition: d });
  return (r.result as { skill: SkillRecord }).skill;
}
async function approve(
  s: SkillRecord,
  decision: "approved" | "rejected" = "approved",
) {
  const v = s.versions.at(-1)!;
  const input = { id: s.id, version: v.version, hash: v.hash };
  const key = randomUUID();
  const e = await request("skill.approve", input, key).catch((e) => e);
  expect(e).toBeInstanceOf(ApprovalRequiredError);
  await f.actions.permissions.review(
    e.actionId,
    decision,
    "Exact isolated version review",
  );
  if (decision === "rejected") return request("skill.approve", input, key);
  return (await request("skill.approve", input, key)).result as {
    skill: SkillRecord;
  };
}
it("stores immutable draft revisions and stale writes fail", async () => {
  const s = await save();
  const r = await request("skill.save", {
    id: s.id,
    revision: s.revision,
    definition: { ...definition(), title: "Changed title" },
  });
  const next = (r.result as { skill: SkillRecord }).skill;
  expect(next.id).toBe(s.id);
  expect(next.versions[0]).toEqual(s.versions[0]);
  expect(next.versions[1].approved_at).toBeNull();
  await expect(
    request("skill.save", {
      id: s.id,
      revision: s.revision,
      definition: definition(),
    }),
  ).rejects.toThrow("changed");
});
it("draft versions cannot launch", async () => {
  const s = await save();
  await expect(
    request("skill.launch", { id: s.id, version: 1, inputs: {} }),
  ).rejects.toThrow("review");
  expect(await f.repo.list("tasks")).toHaveLength(0);
});
it("rejection grants no workflow authority", async () => {
  const s = await save();
  await expect(approve(s, "rejected")).rejects.toThrow();
  expect((await service.version(s.id, 1, false)).approved_at).toBeNull();
});
it("even level five cannot silently approve a version", async () => {
  await f.actions.permissions.savePolicy({
    tool: "skill.approve",
    level: 5,
    reason: "Test ceiling",
  });
  const s = await save();
  await expect(
    request("skill.approve", {
      id: s.id,
      version: 1,
      hash: s.versions[0].hash,
    }),
  ).rejects.toBeInstanceOf(ApprovalRequiredError);
});
it("reviewed launch uses the existing mission and task approval, audit and outcome", async () => {
  const s = await save();
  await approve(s);
  const key = randomUUID();
  const launched = await request(
    "skill.launch",
    { id: s.id, version: 1, inputs: {} },
    key,
  );
  const replay = await request(
    "skill.launch",
    { id: s.id, version: 1, inputs: {} },
    key,
  );
  expect(replay).toEqual(launched);
  let p = await f.engine.inspect(String(launched.result.mission_id));
  expect(p.mission?.state).toBe("DRAFT");
  expect(await f.repo.list("tasks")).toHaveLength(0);
  p = await f.engine.control(p.id, "plan", p.revision);
  p = await f.engine.tick(p.id);
  p = await f.engine.control(p.id, "start", p.revision);
  p = await f.engine.tick(p.id);
  expect(p.mission?.state).toBe("APPROVAL_REQUIRED");
  const id = Object.values(p.states)[0].approval_action_id!;
  await f.actions.permissions.review(
    id,
    "approved",
    "Create the reviewed onboarding task",
  );
  p = await f.engine.control(p.id, "resume", p.revision);
  for (let i = 0; i < 8 && p.mission?.state !== "COMPLETED"; i++)
    p = await f.engine.tick(p.id);
  expect(p.mission?.state).toBe("COMPLETED");
  expect(await f.repo.list("tasks")).toHaveLength(1);
  expect(
    (await f.repo.list("actions")).some(
      (a) => a.tool_name === "create_task" && a.status === "succeeded",
    ),
  ).toBe(true);
  expect((await f.repo.list("outcomes")).length).toBeGreaterThan(0);
});
it("current permissions still deny an approved skill's task", async () => {
  const s = await save();
  await approve(s);
  await f.actions.permissions.savePolicy({
    tool: "create_task",
    level: 0,
    reason: "Owner disabled task creation",
  });
  const r = await request("skill.launch", { id: s.id, version: 1, inputs: {} });
  let p = await f.engine.inspect(String(r.result.mission_id));
  p = await f.engine.control(p.id, "plan", p.revision);
  p = await f.engine.tick(p.id);
  p = await f.engine.control(p.id, "start", p.revision);
  p = await f.engine.tick(p.id);
  expect(p.mission?.state).toBe("FAILED");
  expect(await f.repo.list("tasks")).toHaveLength(0);
});
it.each([
  "permissions.policy",
  "skill.approve",
  "automation.enable",
  "mission.control",
  "agent.create",
])("rejects control-plane capability %s", async (tool) => {
  const d = definition();
  d.steps[0].tool = tool;
  d.permissions = [tool, "task.inspect"];
  await expect(save(d)).rejects.toThrow();
});
it("rejects undeclared and surplus tool permissions", async () => {
  await expect(save({ ...definition(), permissions: [] })).rejects.toThrow(
    "scope",
  );
  await expect(
    save({
      ...definition(),
      permissions: [...definition().permissions, "gmail.send"],
    }),
  ).rejects.toThrow("unused");
});
it("rejects generated policy fields and unknown input names", async () => {
  expect(
    skillDefinition.safeParse({ ...definition(), permission_level: 5 }).success,
  ).toBe(false);
  const s = await save();
  await approve(s);
  await expect(service.instantiate(s.id, 1, { admin: true })).rejects.toThrow(
    "input",
  );
});
it("expands bounded loops, output bindings and verification references", async () => {
  const d = definition();
  d.steps[0].repeat = 3;
  const s = await save(d);
  expect(s.versions[0].compiled.steps).toHaveLength(3);
  expect(s.versions[0].compiled.steps[1].depends_on).toContain("step0");
  expect(s.versions[0].compiled.steps[2].verification?.input.task_id).toEqual({
    $from: "step2",
    path: ["result", "task_id"],
  });
  expect(s.versions[0].output_bindings[0].step).toBe("step2");
});
it("rejects unbounded loops and cyclic dependencies", async () => {
  const d = definition();
  expect(
    skillDefinition.safeParse({ ...d, steps: [{ ...d.steps[0], repeat: 99 }] })
      .success,
  ).toBe(false);
  await expect(
    save({ ...d, steps: [{ ...d.steps[0], depends_on: ["create"] }] }),
  ).rejects.toThrow();
});
it("supports decision predicates without expressions", async () => {
  const d = definition();
  d.steps.push({
    ...d.steps[0],
    id: "follow",
    depends_on: ["create"],
    when: { step: "create", path: ["result", "status"], equals: "pending" },
  });
  const s = await save(d);
  expect(s.versions[0].compiled.steps[1].when?.step).toBe("step0");
});
it("pins approved subskills and never resolves their latest version", async () => {
  const child = await save();
  await approve(child);
  const parent = await save({
    ...definition(),
    subskills: [{ skill_id: child.id, version: 1 }],
  });
  const compiled = parent.versions[0].compiled;
  expect(compiled.steps).toHaveLength(2);
  const old = await service.get(child.id);
  await request("skill.save", {
    id: child.id,
    revision: old.skill.revision,
    definition: { ...definition(), title: "New child version" },
  });
  expect((await service.version(parent.id, 1, false)).compiled).toEqual(
    compiled,
  );
});
it("rejects unapproved and cross-owner subskills", async () => {
  const child = await save();
  await expect(
    save({ ...definition(), subskills: [{ skill_id: child.id, version: 1 }] }),
  ).rejects.toThrow("review");
  const other = missionFixture(join(dir, "data.json"), randomUUID());
  const scoped = new SkillService(other.repo, other.tools, other.coordinator);
  await expect(scoped.get(child.id)).rejects.toThrow();
});
it("enforces typed inputs and refuses prototype injection", async () => {
  const s = await save({
    ...definition(),
    inputs: [
      {
        name: "title",
        description: "Task title",
        required: true,
        type: "string",
      },
    ],
    steps: [
      {
        ...definition().steps[0],
        input: { title: { $input: "title" }, project_id: project },
      },
    ],
  });
  await approve(s);
  await expect(service.instantiate(s.id, 1, { title: 5 })).rejects.toThrow();
  expect(
    (await service.instantiate(s.id, 1, { title: "A real title" })).spec
      .steps[0].input.title,
  ).toBe("A real title");
  expect(() =>
    bindSkillInputs(JSON.parse('{"__proto__":{"polluted":true}}'), {}),
  ).toThrow("Unsafe");
  expect({}).not.toHaveProperty("polluted");
});
it("atomic save rollback leaves no artifact and can retry", async () => {
  const original = f.repo.batch.bind(f.repo);
  const spy = vi.spyOn(f.repo, "batch").mockImplementation(async (m) => {
    if (
      m.some(
        (x) =>
          x.kind === "insert" &&
          x.table === "messages" &&
          "data" in x &&
          "metadata" in x.data &&
          (x.data.metadata as Record<string, unknown>)?.nexus_skill_v1,
      )
    )
      throw new Error("Transient fixture database failure");
    return original(m);
  });
  await expect(save()).rejects.toThrow();
  expect(await service.list()).toHaveLength(0);
  spy.mockRestore();
  expect((await save()).versions).toHaveLength(1);
});
it("automations are disabled until reviewed and deduplicate interval delivery after restart", async () => {
  const s = await save();
  await approve(s);
  const r = await request("automation.save", {
    title: "Morning onboarding",
    target: { kind: "skill", id: s.id, version: 1, inputs: {} },
    trigger: {
      kind: "interval",
      minutes: 1440,
      starts_at: new Date(Date.now() - 60000).toISOString(),
    },
  });
  const a = r.result.automation as { id: string; revision: number };
  await expect(service.fire(a.id, "scheduled")).rejects.toThrow("disabled");
  const i = { id: a.id, revision: a.revision, enabled: true };
  const key = randomUUID();
  const e = await request("automation.enable", i, key).catch((e) => e);
  expect(e).toBeInstanceOf(ApprovalRequiredError);
  await f.actions.permissions.review(
    e.actionId,
    "approved",
    "Approve pinned draft trigger",
  );
  await request("automation.enable", i, key);
  const one = await service.fire(a.id, "scheduled");
  const restarted = new SkillService(f.repo, f.tools, f.coordinator);
  expect(await restarted.fire(a.id, "scheduled")).toEqual(one);
  expect((await f.engine.inspect(String(one.mission_id))).mission?.state).toBe(
    "DRAFT",
  );
  expect(await f.repo.list("tasks")).toHaveLength(0);
});
it("all six examples are valid advisory workflows", async () => {
  const examples = skillExamples();
  expect(examples).toHaveLength(6);
  for (const d of examples) {
    const s = await save(d);
    await approve(s);
    await expect(
      service.instantiate(
        s.id,
        1,
        d.inputs.length ? { brief: d.instructions } : {},
      ),
    ).resolves.toHaveProperty("spec");
  }
});
it("natural-language request creates a reviewable skill through the same router", async () => {
  const fake = vi.spyOn(f.coordinator, "create").mockResolvedValue({
    spec: {
      title: definition().title,
      steps: definition().steps.map(({ repeat, ...s }) => s),
      questions: [],
    },
  } as unknown as ExecutionPlan);
  const c = await f.repo.insert("conversations", {
    title: "Skill creation",
    metadata: {},
  });
  const source = await f.repo.insert("messages", {
    conversation_id: c.id,
    role: "user",
    content: "Ary, make onboarding into a reusable skill.",
    metadata: {},
  });
  const result = await new OrchestrationConversationService(
    f.repo,
    f.coordinator,
  ).handle(source.content, source);
  expect(result?.metadata.skill_id).toBeTruthy();
  expect((await service.list())[0].versions[0].approved_at).toBeNull();
  expect(await f.repo.list("tasks")).toHaveLength(0);
  expect(fake).toHaveBeenCalled();
});

it("duplicate save and concurrent version edits preserve a single canonical history", async () => {
  const key = randomUUID();
  const input = { definition: definition() };
  const saved = await request("skill.save", input, key);
  expect(await request("skill.save", input, key)).toEqual(saved);
  const skill = (saved.result as { skill: SkillRecord }).skill;
  const writes = await Promise.allSettled([
    request("skill.save", {
      id: skill.id,
      revision: skill.revision,
      definition: { ...definition(), title: "Revision A" },
    }),
    request("skill.save", {
      id: skill.id,
      revision: skill.revision,
      definition: { ...definition(), title: "Revision B" },
    }),
  ]);
  expect(writes.filter((w) => w.status === "fulfilled")).toHaveLength(1);
  expect((await service.get(skill.id)).skill.versions).toHaveLength(2);
});
it("rejects expansion beyond the existing mission limit", async () => {
  const d = definition();
  d.steps = Array.from({ length: 5 }, (_, i) => ({
    ...d.steps[0],
    id: `create${i}`,
    repeat: 3,
    verification: null,
  }));
  d.outputs = [];
  d.permissions = ["create_task"];
  await expect(save(d)).rejects.toThrow();
});
it("stored mission targets are snapshot-pinned and disabled initially", async () => {
  const d = definition();
  const plan = await f.engine.create("Onboard client", {
    title: d.title,
    steps: d.steps.map(({ repeat, ...s }) => s),
    questions: [],
  });
  const result = await request("automation.save", {
    title: "Reusable mission trigger",
    target: { kind: "mission", id: plan.id, revision: plan.revision },
    trigger: { kind: "manual" },
  });
  const a = result.result.automation as { enabled: boolean; spec: unknown };
  expect(a.enabled).toBe(false);
  expect(a.spec).toEqual(plan.spec);
  await expect(
    request("automation.save", {
      title: "Stale mission trigger",
      target: { kind: "mission", id: plan.id, revision: plan.revision + 1 },
      trigger: { kind: "manual" },
    }),
  ).rejects.toThrow("changed");
});
