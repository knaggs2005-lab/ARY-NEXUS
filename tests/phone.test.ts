import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { LocalRepository } from "../src/infrastructure/repositories/local";
import { EntityService } from "../src/services/entity-service";
import {
  ActionService,
  ApprovalRequiredError,
} from "../src/services/action-service";
import {
  ActionRequestService,
  createActionToolRegistry,
} from "../src/services/action-request-service";
import {
  PhoneService,
  assertCallsEnabled,
} from "../src/services/phone-service";
import { EncryptedCalendarVault } from "../src/infrastructure/calendar/vault";
import {
  ARY_CALL_DISCLOSURE,
  type PhoneProvider,
  type CallSnapshot,
} from "../src/domain/phone";
import type { Entity } from "../src/domain/models";
let dir: string,
  repo: LocalRepository,
  actions: ActionService,
  requests: ActionRequestService,
  provider: PhoneProvider,
  contact: Entity,
  project: Entity,
  clock: number;
const destination = "+14155550123";
const snapshot = (status: CallSnapshot["status"] = "queued"): CallSnapshot => ({
  id: "fixture-call",
  status,
  duration_seconds: null,
  cost: null,
  transcript: null,
});
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ary-calls-"));
  repo = new LocalRepository(randomUUID(), join(dir, "repo.json"));
  actions = new ActionService(repo);
  clock = Date.now();
  provider = {
    name: "fixture",
    supportsTranscript: true,
    assertConfigured: () => {},
    inspectNumber: vi.fn(async (n) => ({
      number: n,
      valid: true,
      country: "US",
      lineType: "mobile",
    })),
    initiate: vi.fn(async () => snapshot()),
    getCall: vi.fn(async () => snapshot("completed")),
    cancelCall: vi.fn(async () => snapshot("canceled")),
  };
  const phone = new PhoneService(
    repo,
    provider,
    () => {},
    new EncryptedCalendarVault(join(dir, "vault"), "a".repeat(64)),
    () => clock,
  );
  requests = new ActionRequestService(
    repo,
    actions,
    createActionToolRegistry(repo, undefined, actions, undefined, phone),
  );
  contact = await new EntityService(repo).createEntity({
    name: "Test contact",
    entity_type: "person",
    metadata: { phone: destination },
  });
  project = await new EntityService(repo).createEntity({
    name: "Test project",
    entity_type: "project",
  });
  vi.stubEnv(
    "ARY_CALLS_ALLOWED_NUMBERS",
    destination + ",+14155550124,+14155550125,+14155550126",
  );
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});
const request = () => ({
  tool: "phone.initiate",
  input: {
    operation_id: randomUUID(),
    to: destination,
    contact_entity_id: contact.id,
    entity_ids: [project.id],
    script:
      ARY_CALL_DISCLOSURE +
      " Please call the owner about tomorrow's appointment.",
    user_intent: true,
    capture_transcript: false,
    recording_consent_confirmed: false,
  },
  request_key: randomUUID(),
  reason: "User explicitly requested fixture call",
});
async function pending(raw: unknown) {
  try {
    await requests.request(raw);
    throw Error("Expected approval");
  } catch (e) {
    expect(e).toBeInstanceOf(ApprovalRequiredError);
    return (e as ApprovalRequiredError).actionId;
  }
}
async function approve(raw: unknown) {
  const id = await pending(raw);
  await actions.permissions.review(
    id,
    "approved",
    "Approve exact fixture call",
  );
}
async function start(raw = request()) {
  await approve(raw);
  return requests.request(raw);
}
it("valid contact requires approval, persists actual provider metadata, links scope and replays once", async () => {
  const raw = request();
  await approve(raw);
  expect(provider.initiate).not.toHaveBeenCalled();
  const result = await requests.request(raw);
  expect(result.result.to).toBe(destination);
  expect(result.result.snapshot).toEqual(snapshot());
  expect(provider.initiate).toHaveBeenCalledTimes(1);
  expect(await requests.request(raw)).toEqual(result);
  expect(provider.initiate).toHaveBeenCalledTimes(1);
  expect(await repo.get("actions", result.action_id)).toMatchObject({
    status: "succeeded",
    metadata: {
      related_entity_ids: expect.arrayContaining([contact.id, project.id]),
      simulated: false,
      external: true,
    },
  });
  expect(await repo.list("outcomes", { action_id: result.action_id })).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        status: "pending",
        metadata: expect.objectContaining({
          kind: "call_snapshot",
          business_outcome: "unknown",
        }),
      }),
    ]),
  );
});
it("declined approval never contacts provider", async () => {
  const raw = request(),
    id = await pending(raw);
  await actions.permissions.review(id, "rejected", "Do not call");
  await expect(requests.request(raw)).rejects.toThrow();
  expect(provider.inspectNumber).not.toHaveBeenCalled();
  expect(provider.initiate).not.toHaveBeenCalled();
});
it.each([
  "911",
  "988",
  "+19005550123",
  "+14159761234",
  "+18005550123",
  "+442071234567",
  "+14155550123;curl evil",
  "+12115550123",
])("rejects invalid/emergency/service number %s", async (to) => {
  const raw = request();
  raw.input.to = to;
  raw.input.contact_entity_id = null as unknown as string;
  await expect(requests.request(raw)).rejects.toThrow("Invalid tool input");
  expect(provider.initiate).not.toHaveBeenCalled();
  expect((await repo.list("actions")).at(-1)?.status).toBe("failed");
});
it("rejects missing user intent and missing automated identification", async () => {
  for (const change of [
    { user_intent: false },
    { script: "Hello this is your boss" },
  ])
    await expect(
      requests.request({
        ...request(),
        input: { ...request().input, ...change },
      }),
    ).rejects.toThrow("Invalid tool input");
  expect(provider.initiate).not.toHaveBeenCalled();
});
it("detects a saved contact changed after approval", async () => {
  const raw = request();
  await approve(raw);
  await repo.update("entities", contact.id, {
    metadata: { phone: "+14155550124" },
  });
  await expect(requests.request(raw)).rejects.toThrow(
    "Saved contact number changed",
  );
  expect(provider.initiate).not.toHaveBeenCalled();
});
it("mandatory approval remains at level five; no access denies", async () => {
  const policy = await actions.permissions.savePolicy({
    tool: "phone.initiate",
    level: 5,
    reason: "Fixture",
  });
  await pending(request());
  expect(provider.initiate).not.toHaveBeenCalled();
  await actions.permissions.savePolicy({
    tool: "phone.initiate",
    level: 0,
    parent_id: policy.id,
    reason: "Fixture deny",
  });
  await expect(requests.request(request())).rejects.toThrow("not permitted");
});
it.each(["premium", "unknown", "tollFree", "nonFixedVoip"])(
  "provider line type %s cannot dial",
  async (lineType) => {
    vi.mocked(provider.inspectNumber).mockResolvedValue({
      number: destination,
      valid: true,
      country: "US",
      lineType,
    });
    const raw = request();
    await approve(raw);
    await expect(requests.request(raw)).rejects.toThrow(
      "Only provider-verified",
    );
    expect(provider.initiate).not.toHaveBeenCalled();
  },
);
it("requires an explicit destination allowlist", async () => {
  vi.stubEnv("ARY_CALLS_ALLOWED_NUMBERS", "");
  const raw = request();
  await approve(raw);
  await expect(requests.request(raw)).rejects.toThrow("allowlist");
  expect(provider.initiate).not.toHaveBeenCalled();
});
it("provider failure is audited and uncertain initiation never redials, even with a new request key", async () => {
  vi.mocked(provider.initiate).mockRejectedValue(Error("timeout"));
  const raw = request();
  await approve(raw);
  await expect(requests.request(raw)).rejects.toThrow();
  const retry = { ...raw, request_key: randomUUID() };
  await approve(retry);
  await expect(requests.request(retry)).rejects.toThrow("uncertain");
  expect(provider.initiate).toHaveBeenCalledTimes(1);
  expect((await repo.list("actions")).some((a) => a.status === "failed")).toBe(
    true,
  );
});
it("interruption uses an owned provider call and captures cancellation outcome", async () => {
  const initial = await start();
  const result = await requests.request({
    tool: "phone.cancel",
    input: { call_action_id: initial.action_id, user_intent: true },
    request_key: randomUUID(),
  });
  expect(provider.cancelCall).toHaveBeenCalledWith("fixture-call");
  expect((result.result.snapshot as CallSnapshot).status).toBe("canceled");
  expect(provider.initiate).toHaveBeenCalledTimes(1);
});
it("captures consented provider transcript and links a separately approved real follow-up task", async () => {
  const raw = request();
  raw.input.capture_transcript = true;
  raw.input.recording_consent_confirmed = true;
  const initial = await start(raw);
  vi.mocked(provider.getCall).mockResolvedValue({
    ...snapshot("completed"),
    duration_seconds: 19,
    transcript: {
      text: "Please call back tomorrow.",
      source_id: "provider-transcript-1",
    },
  });
  const refresh = await requests.request({
    tool: "phone.refresh",
    input: { call_action_id: initial.action_id },
    request_key: randomUUID(),
  });
  expect(refresh.result.summary).toContain("Please call back tomorrow.");
  expect(refresh.result.call_action_id).toBe(initial.action_id);
  const follow = {
    tool: "create_task",
    input: { project_id: project.id, title: "Call back tomorrow" },
    source_action_id: refresh.action_id,
    request_key: randomUUID(),
  };
  await approve(follow);
  expect(await repo.list("tasks")).toHaveLength(0);
  const task = await requests.request(follow);
  expect(await repo.get("tasks", String(task.result.task_id))).toMatchObject({
    metadata: {
      source_action_id: refresh.action_id,
      related_entity_ids: expect.arrayContaining([contact.id, project.id]),
    },
  });
  await requests.request(follow);
  expect(await repo.list("tasks")).toHaveLength(1);
  expect(await repo.list("memories")).toHaveLength(0);
});
it("discards unsolicited transcript when consent was not requested", async () => {
  const initial = await start();
  vi.mocked(provider.getCall).mockResolvedValue({
    ...snapshot("completed"),
    transcript: { text: "Private", source_id: "unexpected" },
  });
  const r = await requests.request({
    tool: "phone.refresh",
    input: { call_action_id: initial.action_id },
    request_key: randomUUID(),
  });
  expect((r.result.snapshot as CallSnapshot).transcript).toBeNull();
});
it("blocks repeated calling and hourly limit using durable receipts", async () => {
  for (const to of [destination, "+14155550124", "+14155550125"]) {
    const raw = request();
    raw.input.to = to;
    raw.input.contact_entity_id = null as unknown as string;
    const call = await start(raw);
    await requests.request({
      tool: "phone.refresh",
      input: { call_action_id: call.action_id },
      request_key: randomUUID(),
    });
  }
  const raw = request();
  raw.input.to = "+14155550126";
  raw.input.contact_entity_id = null as unknown as string;
  await approve(raw);
  await expect(requests.request(raw)).rejects.toThrow("rate limit");
  expect(provider.initiate).toHaveBeenCalledTimes(3);
});
it("does not dial before durable guard storage succeeds", async () => {
  const phone = new PhoneService(repo, provider, () => {}, {
    lock: async (_k: string, f: () => Promise<unknown>) => f(),
    read: async () => null,
    write: async () => {
      throw Error("disk failure");
    },
  } as unknown as EncryptedCalendarVault);
  const registry = createActionToolRegistry(
    repo,
    undefined,
    actions,
    undefined,
    phone,
  );
  requests = new ActionRequestService(repo, actions, registry);
  const raw = request();
  await approve(raw);
  await expect(requests.request(raw)).rejects.toThrow();
  expect(provider.initiate).not.toHaveBeenCalled();
});
it("disabled and wrong-owner configuration fails closed", () => {
  expect(() => assertCallsEnabled(repo.userId)).toThrow("disabled");
  vi.stubEnv("ARY_CALLS_ENABLED", "true");
  vi.stubEnv("ARY_STORAGE", "supabase");
  vi.stubEnv("ARY_CALLS_USER_ID", "someone-else");
  expect(() => assertCallsEnabled(repo.userId)).toThrow("disabled");
});
it("rejects deceptive identity language even with the introduction", async () => {
  const raw = request();
  raw.input.script = ARY_CALL_DISCLOSURE + " I am a human.";
  await expect(requests.request(raw)).rejects.toThrow("Invalid tool input");
  expect(provider.initiate).not.toHaveBeenCalled();
});
it("linked project permission restricts calls even when omitted from top-level scope", async () => {
  await actions.permissions.savePolicy({
    product_entity_id: project.id,
    level: 0,
    reason: "Restricted project",
  });
  await expect(requests.request(request())).rejects.toThrow("not permitted");
  expect(provider.initiate).not.toHaveBeenCalled();
});
it("cannot refresh a different user's call reference", async () => {
  await expect(
    requests.request({
      tool: "phone.refresh",
      input: { call_action_id: randomUUID() },
      request_key: randomUUID(),
    }),
  ).rejects.toThrow("Call action not found");
  expect(provider.getCall).not.toHaveBeenCalled();
});
it("retains provider receipt after an action transaction fails; reapproval recovers without another dial", async () => {
  const raw = request();
  await approve(raw);
  const batch = repo.batch.bind(repo);
  vi.spyOn(repo, "batch")
    .mockImplementationOnce(async () => {
      throw Error("commit failed");
    })
    .mockImplementation(batch);
  await expect(requests.request(raw)).rejects.toThrow();
  expect(provider.initiate).toHaveBeenCalledTimes(1);
  const retry = { ...raw, request_key: randomUUID() };
  await approve(retry);
  const recovered = await requests.request(retry);
  expect(provider.initiate).toHaveBeenCalledTimes(1);
  await requests.request({
    tool: "phone.refresh",
    input: { call_action_id: recovered.action_id },
    request_key: randomUUID(),
  });
  expect(provider.getCall).toHaveBeenCalledTimes(1);
});
