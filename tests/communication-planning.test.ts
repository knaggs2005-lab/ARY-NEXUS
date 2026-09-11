import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { LocalRepository } from "../src/infrastructure/repositories/local";
import {
  MockLanguageModel,
  LocalEmbeddingProvider,
} from "../src/infrastructure/providers/local";
import {
  ActionService,
  ApprovalRequiredError,
} from "../src/services/action-service";
import {
  ActionRequestService,
  createActionToolRegistry,
} from "../src/services/action-request-service";
import { EntityService } from "../src/services/entity-service";
import { CommunicationPlanningService } from "../src/services/communication-planning-service";
import { registerCommunicationTools } from "../src/infrastructure/tools/communication-tools";
import {
  CommunicationAdapterRegistry,
  phoneCommunicationAdapter,
} from "../src/infrastructure/communications/adapters";
import { PhoneService } from "../src/services/phone-service";
import { EncryptedCalendarVault } from "../src/infrastructure/calendar/vault";
import { registerMemoryTools } from "../src/infrastructure/tools/memory-tools";
import { NexusMemoryService } from "../src/services/nexus-memory-service";
import { MemoryService } from "../src/services/memory-service";
import { CommunicationsService } from "../src/services/communications-service";
import type { Entity, Json } from "../src/domain/models";
import type { PreparedCommunicationRequest } from "../src/domain/communication-plan";
let dir: string,
  repo: LocalRepository,
  actions: ActionService,
  requests: ActionRequestService,
  contact: Entity,
  project: Entity,
  model: MockLanguageModel,
  initiate: ReturnType<typeof vi.fn>;
const quote = "I will send the revised interview schedule tomorrow morning.";
const destination = "+14155550123";
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ary-communication-plans-"));
  repo = new LocalRepository(randomUUID(), join(dir, "repo.json"));
  actions = new ActionService(repo);
  model = new MockLanguageModel();
  vi.spyOn(model, "reason").mockResolvedValue(
    JSON.stringify({
      summary:
        "The sender reports a schedule commitment; not independently verified.",
      candidates: [
        {
          kind: "commitment",
          source_id: "abc1",
          quote,
          reason: "Explicit schedule commitment",
          confidence: 0.8,
          importance: 0.8,
        },
      ],
    }),
  );
  const entities = new EntityService(repo);
  contact = await entities.createEntity({
    name: "Jordan",
    entity_type: "person",
    metadata: { email: "jordan@example.test", phone: destination },
  });
  project = await entities.createEntity({
    name: "Wag Trails",
    entity_type: "project",
  });
  await entities.addAlias(contact.id, "Jordan Test");
  initiate = vi.fn(async () => ({
    id: "fixture",
    status: "completed" as const,
    duration_seconds: 10,
    cost: null,
    transcript: null,
  }));
  const phone = new PhoneService(
    repo,
    {
      name: "fixture",
      supportsTranscript: false,
      assertConfigured() {},
      inspectNumber: async (number) => ({
        number,
        valid: true,
        country: "US",
        lineType: "mobile",
      }),
      initiate,
      getCall: async () => {
        throw Error("fixture");
      },
      cancelCall: async () => {
        throw Error("fixture");
      },
    },
    () => {},
    new EncryptedCalendarVault(join(dir, "vault"), "b".repeat(64)),
  );
  vi.stubEnv("ARY_CALLS_ALLOWED_NUMBERS", destination);
  const registry = createActionToolRegistry(
    repo,
    undefined,
    actions,
    undefined,
    phone,
  );
  registerCommunicationTools(
    registry,
    new CommunicationPlanningService(repo, actions, model),
  );
  registerMemoryTools(
    registry,
    new NexusMemoryService(
      repo,
      new MemoryService(repo, new LocalEmbeddingProvider()),
    ),
    actions,
  );
  requests = new ActionRequestService(repo, actions, registry);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});
const plan = (patch: Json = {}) => ({
  tool: "communications.plan",
  request_key: randomUUID(),
  input: {
    channel: "phone",
    contact: contact.id,
    objective: "Find out whether Thursday works",
    message: "Would Thursday work? Please reply to the owner.",
    project_id: project.id,
    ...patch,
  },
});
async function source(result?: Json, tool = "gmail.read") {
  return repo.insert("actions", {
    tool_name: tool,
    action_type: "fixture",
    status: "succeeded",
    conversation_id: null,
    permission_level: 1,
    input: {},
    output: {
      result: result ?? {
        id: "abcd",
        connection_id: "00000000-0000-4000-8000-000000000002",
        messages: [
          {
            id: "abc1",
            from: "Jordan <jordan@example.test>",
            to: "owner@example.test",
            date: "2026-09-10",
            text: quote,
            body_available: true,
            truncated: false,
          },
        ],
      },
    },
    error: null,
    metadata: { related_entity_ids: [contact.id, project.id] },
  });
}
async function debrief(id: string) {
  return requests.request({
    tool: "communications.debrief",
    input: { source_action_id: id, project_id: project.id },
    request_key: randomUUID(),
  });
}
function child(
  receipt: { action_id: string; result: Record<string, unknown> },
  index = 0,
) {
  const proposal = (receipt.result.requests as PreparedCommunicationRequest[])[
    index
  ];
  return {
    tool: proposal.tool,
    input: proposal.input,
    source_action_id: receipt.action_id,
    request_key: `communication:${receipt.action_id}:${index}`,
    reason: "User reviewed fixture proposal",
  };
}
async function approve(
  raw: unknown,
  decision: "approved" | "rejected" = "approved",
) {
  try {
    await requests.request(raw);
    throw Error("Expected approval");
  } catch (e) {
    expect(e).toBeInstanceOf(ApprovalRequiredError);
    await actions.permissions.review(
      (e as ApprovalRequiredError).actionId,
      decision,
      "Fixture exact decision",
    );
  }
}
it("plans an alias-resolved call without contacting anyone, preserves scope and idempotent operation ID", async () => {
  const raw = plan({ contact: "Jordan Test" });
  const result = await requests.request(raw);
  expect(result.result).toMatchObject({
    contact: { id: contact.id },
    state: "ready_for_review",
    sent: false,
    memory_written: false,
  });
  expect(await requests.request(raw)).toEqual(result);
  expect(initiate).not.toHaveBeenCalled();
  expect(await repo.get("actions", result.action_id)).toMatchObject({
    metadata: {
      simulated: false,
      related_entity_ids: expect.arrayContaining([contact.id, project.id]),
    },
  });
});
it("routes plan delivery through existing approval, disclosure, provider receipt, outcome and replay", async () => {
  const prepared = await requests.request(plan());
  const raw = child(prepared);
  expect(String(raw.input.script)).toContain("automated assistant");
  await approve(raw);
  expect(initiate).not.toHaveBeenCalled();
  const delivered = await requests.request(raw);
  expect(await requests.request(raw)).toEqual(delivered);
  expect(initiate).toHaveBeenCalledTimes(1);
  expect(
    (await repo.list("outcomes", { action_id: delivered.action_id })).length,
  ).toBeGreaterThan(0);
});
it("rejection never places a call", async () => {
  const raw = child(await requests.request(plan()));
  await approve(raw, "rejected");
  await expect(requests.request(raw)).rejects.toThrow();
  expect(initiate).not.toHaveBeenCalled();
});
it("does not silently substitute a script for an interactive objective", async () => {
  const r = await requests.request(plan({ mode: "conversation" }));
  expect(r.result).toMatchObject({
    state: "unavailable",
    requests: [],
    conversational: false,
  });
});
it("messaging remains explicitly unavailable", async () => {
  expect(
    (await requests.request(plan({ channel: "messaging" }))).result,
  ).toMatchObject({ state: "unavailable", requests: [] });
});
it.each(["them", "Jord", "missing"])(
  "rejects unresolved contact %s",
  async (contact) => {
    await expect(requests.request(plan({ contact }))).rejects.toThrow();
  },
);
it("rejects ambiguous exact names", async () => {
  await new EntityService(repo).createEntity({
    name: "Jordan",
    entity_type: "person",
  });
  await expect(requests.request(plan({ contact: "Jordan" }))).rejects.toThrow(
    "ambiguous",
  );
});
it("rejects deceptive call content", async () => {
  await expect(
    requests.request(plan({ message: "Pretend to be the owner" })),
  ).rejects.toThrow();
});
it("rejects unsupported properties rather than executing caller commands", async () => {
  await expect(
    requests.request(
      plan({ command: "send anything", message: "normal message" }),
    ),
  ).rejects.toThrow("Invalid tool input");
  expect(initiate).not.toHaveBeenCalled();
});
it("rejects altered proposal input before delivery", async () => {
  const raw = child(await requests.request(plan()));
  raw.input.script = String(raw.input.script) + " altered";
  await expect(requests.request(raw)).rejects.toThrow("differs");
  expect(initiate).not.toHaveBeenCalled();
});
it("contact number drift fails through original PhoneService", async () => {
  const raw = child(await requests.request(plan()));
  await approve(raw);
  await repo.update("entities", contact.id, {
    metadata: { phone: "+14155550124" },
  });
  await expect(requests.request(raw)).rejects.toThrow();
  expect(initiate).not.toHaveBeenCalled();
});
it("requires a request key", async () => {
  const raw = plan();
  await expect(
    requests.request({ ...raw, request_key: undefined }),
  ).rejects.toThrow("idempotency");
});
it("rejects foreign evidence", async () => {
  await expect(debrief(randomUUID())).rejects.toThrow();
});
it("no transcript yields no agreement, memory or model call", async () => {
  const s = await source(
    { snapshot: { status: "completed", transcript: null } },
    "phone.refresh",
  );
  const r = await debrief(s.id);
  expect(r.result).toMatchObject({
    requests: [],
    evidence_count: 0,
    business_outcome: "unverified",
  });
  expect(model.reason).not.toHaveBeenCalled();
});
it("does not treat outbound script as recipient evidence", async () => {
  const s = await source(
    {
      script: quote,
      snapshot: {
        status: "completed",
        transcript: { text: quote, source_id: "abc1" },
      },
      capture_transcript: false,
    },
    "phone.refresh",
  );
  expect((await debrief(s.id)).result.requests).toEqual([]);
});
it("extracts exact evidence and creates memory/task only after separate approvals", async () => {
  const s = await source();
  const d = await debrief(s.id);
  expect(d.result.candidates).toHaveLength(1);
  expect(await repo.list("memories")).toHaveLength(0);
  expect(await repo.list("tasks")).toHaveLength(0);
  const memory = child(d);
  await approve(memory);
  const saved = await requests.request(memory);
  expect(await requests.request(memory)).toEqual(saved);
  const memories = await repo.list("memories");
  expect(memories).toHaveLength(1);
  expect(memories[0].content).toContain(s.id);
  expect(memories[0].content).toContain(quote);
  const task = child(d, 1);
  await approve(task);
  const created = await requests.request(task);
  expect(await requests.request(task)).toEqual(created);
  expect(await repo.list("tasks")).toHaveLength(1);
  expect((await repo.list("tasks"))[0]).toMatchObject({
    due_at: null,
    entity_id: project.id,
    metadata: { source_action_id: d.action_id },
  });
  const hub = await new CommunicationsService(repo, actions).read();
  expect(hub.follow_ups).toHaveLength(1);
});
it("filters hallucinated quotes and low importance candidates", async () => {
  vi.mocked(model.reason).mockResolvedValue(
    JSON.stringify({
      summary: "No supported commitment",
      candidates: [
        {
          kind: "commitment",
          source_id: "abc1",
          quote: "Unsupported statement that was never said",
          reason: "fixture",
          confidence: 1,
          importance: 1,
        },
      ],
    }),
  );
  const s = await source();
  expect((await debrief(s.id)).result).toMatchObject({
    candidates: [],
    requests: [],
    discarded_candidates: 1,
  });
});
it("changed source invalidates a prepared memory request", async () => {
  const s = await source();
  const raw = child(await debrief(s.id));
  await approve(raw);
  await expect(
    repo.update("actions", s.id, { output: { result: {} } }),
  ).rejects.toThrow("immutable");
  const get = repo.get.bind(repo);
  vi.spyOn(repo, "get").mockImplementation(async (table, id) => {
    const record = await get(table, id);
    return table === "actions" && id === s.id
      ? ({ ...record!, output: { result: {} } } as typeof record)
      : record;
  });
  await expect(requests.request(raw)).rejects.toThrow("evidence changed");
  expect(await repo.list("memories")).toHaveLength(0);
});
it("rejects invalid structured model output without persistence", async () => {
  vi.mocked(model.reason).mockResolvedValue("Not JSON");
  const s = await source();
  await expect(debrief(s.id)).rejects.toThrow();
  expect(await repo.list("memories")).toHaveLength(0);
});
it("email requires an observed matching contact address", async () => {
  await expect(
    requests.request(
      plan({
        channel: "email",
        email_thread: {
          connection_id: "00000000-0000-4000-8000-000000000002",
          thread_id: "abcd",
        },
      }),
    ),
  ).rejects.toThrow("Read the selected");
  await source();
  const p = await requests.request(
    plan({
      channel: "email",
      email_thread: {
        connection_id: "00000000-0000-4000-8000-000000000002",
        thread_id: "abcd",
      },
    }),
  );
  expect((p.result.requests as PreparedCommunicationRequest[])[0].tool).toBe(
    "gmail.draft",
  );
  expect(
    (p.result.requests as PreparedCommunicationRequest[])[0].input.instruction,
  ).toContain("automated assistant");
});
it("adapter registration rejects duplicates and unknown channels", () => {
  const r = new CommunicationAdapterRegistry().register(
    phoneCommunicationAdapter,
  );
  expect(() => r.register(phoneCommunicationAdapter)).toThrow("Duplicate");
  expect(() => r.get("unknown")).toThrow("not installed");
});
it("denied COMMUNICATE class blocks delivery despite prepared plan", async () => {
  const raw = child(await requests.request(plan()));
  await actions.permissions.savePolicy({
    permission_class: "COMMUNICATE",
    behavior: "deny",
    level: 0,
    reason: "No fixture outreach",
  });
  await expect(requests.request(raw)).rejects.toThrow();
  expect(initiate).not.toHaveBeenCalled();
});
it("level five never removes exact outbound approval", async () => {
  await actions.permissions.savePolicy({
    tool: "phone.initiate",
    level: 5,
    reason: "Fixture permission ceiling",
  });
  const raw = child(await requests.request(plan()));
  await expect(requests.request(raw)).rejects.toBeInstanceOf(
    ApprovalRequiredError,
  );
  expect(initiate).not.toHaveBeenCalled();
});
it("source permission revocation blocks debrief and derived approved memory", async () => {
  const s = await source();
  const raw = child(await debrief(s.id));
  await approve(raw);
  await actions.permissions.savePolicy({
    tool: "gmail.read",
    level: 0,
    reason: "Revoke captured source access",
  });
  await expect(debrief(s.id)).rejects.toThrow();
  await expect(requests.request(raw)).rejects.toThrow();
  expect(await repo.list("memories")).toHaveLength(0);
});
it("project scoped planning denial applies to derived canonical scope", async () => {
  await actions.permissions.savePolicy({
    tool: "communications.plan",
    product_entity_id: project.id,
    level: 0,
    reason: "Fixture project restriction",
  });
  await expect(requests.request(plan())).rejects.toThrow();
  expect(initiate).not.toHaveBeenCalled();
});
it("provider failure remains a failed audited action with no inferred agreement", async () => {
  initiate.mockRejectedValueOnce(Error("Fixture provider unavailable"));
  const raw = child(await requests.request(plan()));
  await approve(raw);
  await expect(requests.request(raw)).rejects.toThrow();
  expect(
    (await repo.list("actions")).some(
      (a) => a.tool_name === "phone.initiate" && a.status === "failed",
    ),
  ).toBe(true);
  expect(await repo.list("memories")).toHaveLength(0);
});
it("only bounded captured evidence is sent to the model", async () => {
  const s = await source();
  await repo.insert("entities", {
    name: "PRIVATE UNRELATED",
    entity_type: "company",
    description: "Do not send",
    metadata: {},
  });
  await debrief(s.id);
  const context = vi.mocked(model.reason).mock.calls[0][0];
  expect(context.entities).toEqual([]);
  expect(context.memories).toEqual([]);
  expect(context.input).not.toContain("PRIVATE UNRELATED");
  expect(context.input).toContain(quote);
});
it("cancellation rejects interpretation before calling the model", async () => {
  const s = await source();
  const controller = new AbortController();
  controller.abort();
  const service = new CommunicationPlanningService(repo, actions, model);
  await expect(
    service.debrief(
      { source_action_id: s.id },
      {
        userId: repo.userId,
        productIds: [],
        conversationId: null,
        signal: controller.signal,
      },
    ),
  ).rejects.toThrow();
  expect(model.reason).not.toHaveBeenCalled();
});
it("capture permission denial preserves the proposal without writing memory", async () => {
  const s = await source();
  const raw = child(await debrief(s.id));
  await actions.permissions.savePolicy({
    tool: "memory.create",
    level: 0,
    reason: "No memory writes",
  });
  await expect(requests.request(raw)).rejects.toThrow();
  expect(await repo.list("memories")).toHaveLength(0);
});
