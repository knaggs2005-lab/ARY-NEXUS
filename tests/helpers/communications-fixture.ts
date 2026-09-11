import type { Repository } from "../../src/domain/repository";
import type { Action, Json } from "../../src/domain/models";
export const fixtureNow = Date.now() + 60000;
export async function communicationFixture(repo: Repository) {
  const person = await repo.insert("entities", {
    entity_type: "person",
    name: "Jordan Fixture",
    description: "Test contact",
    metadata: { email: "jordan@example.test" },
  });
  const company = await repo.insert("entities", {
    entity_type: "company",
    name: "Clevaryn Fixture",
    description: "Test company",
    metadata: {},
  });
  const project = await repo.insert("entities", {
    entity_type: "project",
    name: "Wag Trails Fixture",
    description: "Test project",
    metadata: {},
  });
  for (const target of [company, project])
    await repo.insert("relationships", {
      source_entity_id: person.id,
      target_entity_id: target.id,
      relationship_type: "works_with",
      strength: 1,
      valid_from: "2026-01-01T00:00:00Z",
      valid_to: null,
      memory_id: null,
      metadata: {},
    });
  const action = async (
    tool: string,
    result: Json,
    patch: Partial<Action> = {},
  ) => {
    await new Promise((resolve) => setTimeout(resolve, 2));
    const record = await repo.insert("actions", {
      tool_name: tool,
      action_type: "fixture",
      conversation_id: null,
      permission_level: 4,
      status: "succeeded",
      input: {},
      output: { result },
      error: null,
      metadata: {
        related_entity_ids: [person.id],
        reason: "Fixture user request",
      },
      ...patch,
    });
    return record;
  };
  const thread = (overrides: Json = {}) => ({
    id: "abcd",
    connection_id: "fixture-account-a",
    account: "owner@example.test",
    entities: [{ id: person.id }],
    truncated: false,
    messages: [
      {
        id: "abc1",
        thread_id: "abcd",
        from: "Owner <owner@example.test>",
        to: "Jordan <jordan@example.test>",
        subject: "Wag Trails delivery",
        date: "2026-09-08T09:00:00Z",
        text: "PRIVATE EMAIL BODY NOT FOR HUB",
        body_available: true,
        truncated: false,
      },
    ],
    ...overrides,
  });
  const mail = await action("gmail.summarize", {
    summary: "Asked Jordan to review the tracking fix.",
    thread: thread(),
  });
  const call = await action("phone.initiate", {
    kind: "phone_call",
    operation_id: "fixture-operation",
    call_action_id: "",
    provider: "fixture",
    contact_entity_id: person.id,
    snapshot: { id: "fixture-call", status: "ringing" },
    observed_at: "2026-09-08T10:00:00Z",
  });
  await action("phone.refresh", {
    kind: "phone_call",
    operation_id: "fixture-operation",
    call_action_id: call.id,
    provider: "fixture",
    contact_entity_id: person.id,
    snapshot: {
      id: "fixture-call",
      status: "completed",
      transcript: {
        text: "PRIVATE TRANSCRIPT",
        source_id: "fixture-transcript",
      },
    },
    observed_at: "2026-09-08T10:30:00Z",
  });
  const calendar = await action("google_calendar.read", {
    connection_id: "fixture-calendar",
    events: [
      {
        id: "event-a",
        summary: "Wag Trails review",
        start: "2026-09-09T12:00:00Z",
        entity_ids: [project.id],
      },
    ],
  });
  const task = await repo.insert("tasks", {
    entity_id: project.id,
    goal_id: null,
    title: "Follow up with Jordan",
    description: "Source-linked fixture",
    status: "pending",
    priority: 2,
    due_at: "2026-09-08T08:00:00Z",
    metadata: { source_action_id: call.id },
  });
  const pending = await action(
    "gmail.send",
    {},
    {
      status: "approval_required",
      input: { to: ["jordan@example.test"], body: "PRIVATE DRAFT" },
      metadata: {
        related_entity_ids: [person.id],
        reason: "Review proposed follow-up",
        fingerprint: "fixture-fingerprint",
        policy_hash: "fixture-policy",
      },
    },
  );
  return {
    person,
    company,
    project,
    mail,
    call,
    calendar,
    task,
    pending,
    action,
    thread,
  };
}
