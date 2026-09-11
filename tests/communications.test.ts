import { beforeEach, afterEach, it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { LocalRepository } from "../src/infrastructure/repositories/local";
import { CommunicationsService } from "../src/services/communications-service";
import { PermissionService } from "../src/services/permission-service";
import {
  communicationFixture,
  fixtureNow,
} from "./helpers/communications-fixture";
let dir: string,
  repo: LocalRepository,
  service: CommunicationsService,
  f: Awaited<ReturnType<typeof communicationFixture>>;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ary-communications-"));
  repo = new LocalRepository(randomUUID(), join(dir, "repo.json"));
  f = await communicationFixture(repo);
  service = new CommunicationsService(repo, undefined, () => fixtureNow);
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});
it("unifies three sources and collapses call observations", async () => {
  const r = await service.read();
  expect(r.timeline).toHaveLength(3);
  expect(r.timeline.map((e) => e.source.channel).sort()).toEqual([
    "calendar",
    "gmail",
    "phone",
  ]);
  expect(r.timeline.find((e) => e.source.channel === "phone")?.state).toBe(
    "completed",
  );
});
it("groups explicit company/project relationships without merging identities", async () => {
  const r = await service.read();
  expect(r.people.map((p) => p.entity.id).sort()).toEqual(
    [f.person.id, f.company.id, f.project.id].sort(),
  );
  expect(r.people.every((p) => p.open_follow_ups === 1)).toBe(true);
  expect(await repo.list("entities")).toHaveLength(3);
});
it("returns source references and bounded summaries, never mail bodies/transcripts/drafts", async () => {
  const r = await service.read();
  expect(JSON.stringify(r)).not.toContain("PRIVATE");
  expect(
    r.timeline.find((e) => e.source.channel === "gmail")?.source.action_id,
  ).toBe(f.mail.id);
});
it("does not treat future calendar events as last contact", async () => {
  const r = await service.read();
  expect(r.people[0].last_contact).toBe(f.call.created_at);
  expect(r.timeline.find((e) => e.source.channel === "calendar")?.contact).toBe(
    false,
  );
});
it("shows observed unanswered threads without asserting a reply obligation", async () => {
  const r = await service.read();
  expect(r.people[0].unanswered_threads).toBe(1);
  expect(r.coverage.join(" ")).toContain("does not prove");
});
it("a later inbound observation clears waiting for reply and shows review instead", async () => {
  const t = f.thread();
  await f.action(
    "gmail.read",
    f.thread({
      messages: [
        ...t.messages,
        {
          ...t.messages[0],
          id: "abc2",
          from: "jordan@example.test",
          to: "owner@example.test",
          date: "2026-09-08T11:00:00Z",
        },
      ],
    }),
  );
  const r = await service.read();
  expect(r.people[0].unanswered_threads).toBe(0);
  expect(r.timeline.find((e) => e.source.channel === "gmail")?.attention).toBe(
    "review_inbound",
  );
});
it.each([
  { truncated: true },
  {
    messages: [
      {
        date: "invalid",
        from: "owner@example.test",
        to: "jordan@example.test",
      },
    ],
  },
  {
    messages: [
      {
        date: "2030-01-01T00:00:00Z",
        from: "owner@example.test",
        to: "jordan@example.test",
      },
    ],
  },
])(
  "never infers reply status from partial/undated/future data: %j",
  async (overrides) => {
    await f.action("gmail.read", f.thread(overrides));
    const r = await service.read();
    expect(r.people[0].unanswered_threads).toBe(0);
  },
);
it("keeps identical thread ids separate across account connections", async () => {
  await f.action(
    "gmail.read",
    f.thread({ connection_id: "fixture-account-b" }),
  );
  expect(
    (await service.read()).timeline.filter((e) => e.source.channel === "gmail"),
  ).toHaveLength(2);
});
it("does not count successful drafts or failed calls as contact", async () => {
  await f.action("phone.refresh", {
    kind: "phone_call",
    operation_id: "fixture-operation",
    snapshot: { id: "x", status: "failed" },
  });
  await f.action("gmail.draft", {
    subject: "Draft",
    source_thread_id: "abcd",
    connection_id: "fixture-account-a",
    body: "PRIVATE",
  });
  const r = await service.read();
  expect(
    r.timeline
      .filter((e) => e.source.channel !== "gmail" || e.state === "draft")
      .every((e) => !e.contact),
  ).toBe(true);
  expect(r.timeline.some((e) => e.state === "draft")).toBe(true);
});
it("shows pending approvals but removes rejected or consumed approvals", async () => {
  expect((await service.read()).approvals).toHaveLength(1);
  await new PermissionService(repo).review(
    f.pending.id,
    "rejected",
    "Fixture rejection",
  );
  expect((await service.read()).approvals).toHaveLength(0);
});
it("keeps expired approvals visible as expired, never approved execution", async () => {
  await repo.insert("action_approvals", {
    action_id: f.pending.id,
    decision: "approved",
    reason: "Expired fixture review",
    fingerprint: "fixture-fingerprint",
    policy_hash: "fixture-policy",
    expires_at: "2026-01-01T00:00:00Z",
    consumed_at: null,
  });
  expect((await service.read()).approvals[0].state).toBe("expired_review");
  const second = await f.action(
    "gmail.send",
    {},
    {
      status: "approval_required",
      metadata: {
        fingerprint: "fixture-fingerprint",
        policy_hash: "fixture-policy",
      },
    },
  );
  const active = await new PermissionService(repo).review(
    second.id,
    "approved",
    "Current fixture approval",
  );
  expect(
    await repo.consumeApproval(
      active.id,
      "fixture-fingerprint",
      "fixture-policy",
    ),
  ).toBe(true);
  expect((await service.read()).approvals).toHaveLength(1);
});
it("includes only open source-linked tasks, excluding unrelated work", async () => {
  await repo.insert("tasks", {
    entity_id: f.project.id,
    goal_id: null,
    title: "Unrelated task",
    description: "",
    status: "pending",
    priority: 1,
    due_at: null,
    metadata: {},
  });
  expect((await service.read()).follow_ups).toHaveLength(1);
  await repo.update("tasks", f.task.id, { status: "completed" });
  expect((await service.read()).follow_ups).toHaveLength(0);
});
it("rechecks revoked source read permissions, including project scopes", async () => {
  await new PermissionService(repo).savePolicy({
    tool: "gmail.read",
    level: 0,
    product_entity_id: f.project.id,
    reason: "Fixture denial",
  });
  const r = await service.read();
  expect(r.timeline.some((e) => e.source.channel === "gmail")).toBe(false);
  expect(r.approvals).toHaveLength(0);
  expect(r.people[0].unanswered_threads).toBe(0);
});
it("denied entity context removes summaries rather than leaking names", async () => {
  await new PermissionService(repo).savePolicy({
    tool: "entity.read",
    level: 0,
    product_entity_id: f.project.id,
    reason: "Fixture denial",
  });
  const r = await service.read();
  expect(r.timeline).toHaveLength(0);
  expect(r.people).toHaveLength(0);
  expect(r.follow_ups).toHaveLength(0);
});
it("hub denial is audited without executing the projection", async () => {
  await new PermissionService(repo).savePolicy({
    tool: "communications.read",
    level: 0,
    reason: "Fixture denial",
  });
  await expect(service.read()).rejects.toThrow();
  expect((await repo.list("actions")).at(-1)?.status).toBe("blocked");
});
it("honors project-scoped hub denial for every source and follow-up", async () => {
  await new PermissionService(repo).savePolicy({
    tool: "communications.read",
    product_entity_id: f.project.id,
    level: 0,
    reason: "Fixture project hub denial",
  });
  const r = await service.read();
  expect(r.timeline).toHaveLength(0);
  expect(r.follow_ups).toHaveLength(0);
  expect(r.approvals).toHaveLength(0);
});
it("does not fall back to an older unlinked copy of a denied thread", async () => {
  const thread = f.thread({
    id: "defa",
    entities: [],
    messages: [
      {
        date: "2026-09-08T08:00:00Z",
        from: "outside@example.test",
        to: "owner@example.test",
        subject: "Private source",
      },
    ],
  });
  await f.action("gmail.read", thread, { metadata: {} });
  await f.action(
    "gmail.read",
    { ...thread, entities: [{ id: f.project.id }] },
    { metadata: {} },
  );
  await new PermissionService(repo).savePolicy({
    tool: "gmail.read",
    product_entity_id: f.project.id,
    level: 0,
    reason: "Fixture source denial",
  });
  expect(
    (await service.read()).timeline.some((e) => e.source.record_id === "defa"),
  ).toBe(false);
});
it("never writes memory or creates actions that send, call, or create a task", async () => {
  const before = (await repo.list("actions")).length;
  await service.read();
  await service.read();
  expect(await repo.list("memories")).toHaveLength(0);
  expect(await repo.list("tasks")).toHaveLength(1);
  const added = (await repo.list("actions")).slice(before);
  expect(added.map((a) => a.tool_name)).toEqual([
    "communications.read",
    "communications.read",
  ]);
  expect(added.every((a) => !a.output.result)).toBe(true);
});
it("does not expose another owner's records", async () => {
  const other = new LocalRepository(randomUUID(), join(dir, "repo.json"));
  const r = await new CommunicationsService(other).read();
  expect(r.timeline).toHaveLength(0);
  expect(r.people).toHaveLength(0);
});
it("paginates sources and filters by canonical project id", async () => {
  const r = await service.read({ entity_id: f.project.id, limit: 1 });
  expect(r.timeline).toHaveLength(1);
  expect(r.total).toBe(3);
  expect(r.has_more).toBe(true);
  expect((await service.read({ entity_id: randomUUID() })).total).toBe(0);
});
it("ignores historical relationship context", async () => {
  for (const rel of await repo.list("relationships"))
    await repo.update("relationships", rel.id, {
      valid_to: "2026-01-02T00:00:00Z",
    });
  const r = await service.read({ entity_id: f.company.id });
  expect(r.total).toBe(0);
});
it("resolves unique exact contact address but not duplicate address identities", async () => {
  await f.action(
    "gmail.summarize",
    {
      thread: f.thread({ entities: [], id: "feed" }),
      summary: "Exact address match",
    },
    { metadata: {} },
  );
  expect(
    (await service.read()).timeline.find((e) => e.source.record_id === "feed")
      ?.entity_ids,
  ).toContain(f.person.id);
  await repo.insert("entities", {
    entity_type: "person",
    name: "Another Jordan",
    description: "",
    metadata: { email: "jordan@example.test" },
  });
  expect(
    (await service.read()).timeline.find((e) => e.source.record_id === "feed")
      ?.entity_ids,
  ).toEqual([]);
});
