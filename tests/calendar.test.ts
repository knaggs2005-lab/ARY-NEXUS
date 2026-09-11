import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { mkdtemp, rm, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { LocalRepository } from "../src/infrastructure/repositories/local";
import {
  ActionService,
  ApprovalRequiredError,
} from "../src/services/action-service";
import { ActionRequestService } from "../src/services/action-request-service";
import { ToolRegistry } from "../src/domain/tool-registry";
import { registerCalendarTools } from "../src/infrastructure/tools/calendar-tools";
import {
  calendarConflicts,
  recommendBlocks,
  calendarWriteInput,
  type CalendarProvider,
  type CalendarEvent,
} from "../src/domain/calendar";
import {
  GoogleCalendarProvider,
  normalizeGoogleEvent,
  midnightInZone,
} from "../src/infrastructure/calendar/google-calendar";
import { EncryptedCalendarVault } from "../src/infrastructure/calendar/vault";
import { AppError } from "../src/domain/validation";
let dir: string,
  repo: LocalRepository,
  actions: ActionService,
  requests: ActionRequestService,
  provider: CalendarProvider;
const connection = randomUUID();
const fields = {
  summary: "Wag Trails focus",
  description: "Fix tracking",
  start: "2030-01-02T09:00:00Z",
  end: "2030-01-02T10:00:00Z",
  time_zone: "UTC",
};
const event: CalendarEvent = {
  ...fields,
  id: "event1",
  etag: '"v1"',
  all_day: false,
  busy: true,
  editable: true,
  html_url: null,
  people: [],
  entity_ids: [],
};
const write = () => ({
  tool: "google_calendar.create",
  input: {
    connection_id: connection,
    operation_id: randomUUID(),
    event: fields,
  },
  request_key: randomUUID(),
  reason: "Reserve project focus time",
});
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ary-calendar-test-"));
  repo = new LocalRepository(randomUUID(), join(dir, "db.json"));
  actions = new ActionService(repo);
  provider = {
    status: vi.fn(),
    list: vi.fn().mockResolvedValue({
      events: [event],
      complete: true,
      time_zone: "UTC",
      connection_id: connection,
    }),
    create: vi.fn().mockResolvedValue({ event, recovered: false }),
    update: vi.fn().mockResolvedValue({ event, recovered: false }),
  };
  requests = new ActionRequestService(
    repo,
    actions,
    registerCalendarTools(new ToolRegistry(), repo, provider),
  );
});
afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});
async function approve(raw: unknown) {
  let id = "";
  try {
    await requests.request(raw);
  } catch (e) {
    expect(e).toBeInstanceOf(ApprovalRequiredError);
    id = (e as ApprovalRequiredError).actionId;
  }
  expect(id).toBeTruthy();
  await actions.permissions.review(
    id,
    "approved",
    "Reviewed exact Google event",
  );
  return id;
}
it.each([0, 1, 2, 3])(
  "level %i blocks external writes without invocation",
  async (level) => {
    await actions.permissions.savePolicy({
      tool: "google_calendar.create",
      level,
      reason: "Boundary test",
    });
    await expect(requests.request(write())).rejects.toThrow("not permitted");
    expect(provider.create).not.toHaveBeenCalled();
    expect((await repo.list("actions"))[0].status).toBe("blocked");
  },
);
it.each([4, 5])(
  "level %i still requires approval for external writes",
  async (level) => {
    await actions.permissions.savePolicy({
      tool: "google_calendar.create",
      level,
      reason: "Boundary test",
    });
    const raw = write();
    await approve(raw);
    expect(provider.create).not.toHaveBeenCalled();
    const result = await requests.request(raw);
    expect(result.result).toMatchObject({ event: { id: event.id } });
    expect(provider.create).toHaveBeenCalledTimes(1);
    const action = await repo.get("actions", result.action_id);
    expect(action?.metadata).toMatchObject({
      external: true,
      simulated: false,
    });
    expect(action?.metadata.approval_id).toBeTruthy();
    await requests.request(raw);
    expect(provider.create).toHaveBeenCalledTimes(1);
    expect(
      (await repo.list("actions")).some(
        (a) => a.metadata.replay_of === result.action_id,
      ),
    ).toBe(true);
  },
);
it("rejecting approval does not invoke Google", async () => {
  const raw = write();
  let id = "";
  try {
    await requests.request(raw);
  } catch (e) {
    id = (e as ApprovalRequiredError).actionId;
  }
  await actions.permissions.review(id, "rejected", "Not this time");
  await expect(requests.request(raw)).rejects.toBeInstanceOf(
    ApprovalRequiredError,
  );
  expect(provider.create).not.toHaveBeenCalled();
});
it("invalid event times fail before requesting approval", async () => {
  const raw = write();
  raw.input.event = { ...fields, end: fields.start };
  await expect(requests.request(raw)).rejects.toThrow("Invalid tool input");
  expect(provider.create).not.toHaveBeenCalled();
  expect((await repo.list("actions"))[0].status).toBe("failed");
});
it("readonly does not grant recommendations", async () => {
  await actions.permissions.savePolicy({ level: 1, reason: "Observe only" });
  await requests.request({
    tool: "google_calendar.read",
    input: { start: fields.start, end: fields.end },
  });
  await expect(
    requests.request({
      tool: "google_calendar.recommend",
      input: { start: fields.start, end: fields.end, minutes: 60 },
    }),
  ).rejects.toThrow("not permitted");
  expect(provider.list).toHaveBeenCalledTimes(1);
});
it("recommendations respect an explicit read denial", async () => {
  await actions.permissions.savePolicy({
    tool: "google_calendar.read",
    level: 0,
    reason: "No read",
  });
  await expect(
    requests.request({
      tool: "google_calendar.recommend",
      input: { start: fields.start, end: fields.end, minutes: 60 },
    }),
  ).rejects.toThrow("not permitted");
  expect(provider.list).not.toHaveBeenCalled();
});
it("resolves Calendar aliases with the existing canonical resolver", async () => {
  const e = await repo.insert("entities", {
    name: "Wag Trails",
    entity_type: "project",
    description: "Trails",
    metadata: {},
  });
  await repo.insert("entity_aliases", { entity_id: e.id, alias: "Wag" });
  vi.mocked(provider.list).mockResolvedValue({
    events: [{ ...event, summary: "Wag planning" }],
    complete: true,
    time_zone: "UTC",
    connection_id: connection,
  });
  const result = await requests.request({
    tool: "google_calendar.read",
    input: { start: fields.start, end: fields.end },
  });
  expect((result.result.events as CalendarEvent[])[0].entity_ids).toEqual([
    e.id,
  ]);
});
it("suppresses recommendations from incomplete reads", async () => {
  vi.mocked(provider.list).mockResolvedValue({
    events: [],
    complete: false,
    time_zone: "UTC",
    connection_id: connection,
  });
  const result = await requests.request({
    tool: "google_calendar.recommend",
    input: { start: fields.start, end: fields.end, minutes: 60 },
  });
  expect(result.result.blocks).toEqual([]);
});
it("records failed external calls and preserves the existing retry contract", async () => {
  const raw = write();
  await approve(raw);
  vi.mocked(provider.create).mockRejectedValueOnce(
    new AppError("Google unavailable", 502),
  );
  await expect(requests.request(raw)).rejects.toThrow("Google unavailable");
  await expect(requests.request(raw)).rejects.toThrow(
    "Previous attempt failed",
  );
  const next = { ...raw, request_key: randomUUID() };
  await approve(next);
  await requests.request(next);
  expect(provider.create).toHaveBeenCalledTimes(2);
  expect(
    (await repo.list("outcomes")).some((o) => o.status === "failure"),
  ).toBe(true);
});
it("transparent events do not conflict; touching boundaries are not conflicts", () => {
  expect(
    calendarConflicts([
      event,
      { ...event, id: "b", start: event.end, end: "2030-01-02T11:00:00Z" },
      { ...event, id: "c", busy: false },
    ]),
  ).toEqual([]);
  expect(
    calendarConflicts([
      event,
      { ...event, id: "b", start: "2030-01-02T09:30:00Z" },
    ]),
  ).toHaveLength(1);
});
it("recommendations never overlap merged busy time", () => {
  const blocks = recommendBlocks(
    [
      event,
      { ...event, start: "2030-01-02T09:30:00Z", end: "2030-01-02T11:00:00Z" },
    ],
    "2030-01-02T08:00:00Z",
    "2030-01-02T13:00:00Z",
    60,
  );
  expect(blocks.map((b) => b.start)).toEqual([
    "2030-01-02T08:00:00.000Z",
    "2030-01-02T11:00:00.000Z",
    "2030-01-02T12:00:00.000Z",
  ]);
});
it("all-day dates use the calendar timezone across DST", () => {
  expect(midnightInZone("2026-03-08", "America/Los_Angeles")).toBe(
    "2026-03-08T08:00:00.000Z",
  );
  expect(midnightInZone("2026-03-09", "America/Los_Angeles")).toBe(
    "2026-03-09T07:00:00.000Z",
  );
});
it("shared and recurring events are readonly", () => {
  const raw = {
    id: "x",
    etag: "v",
    start: { dateTime: fields.start },
    end: { dateTime: fields.end },
    organizer: { self: true },
    attendees: [{ email: "person@example.com" }],
  };
  expect(normalizeGoogleEvent(raw).editable).toBe(false);
  expect(
    normalizeGoogleEvent({ ...raw, attendees: [], recurringEventId: "series" })
      .editable,
  ).toBe(false);
});
it("credential vault encrypts, binds tenants and consumes state once", async () => {
  const vault = new EncryptedCalendarVault(join(dir, "vault"), "a".repeat(64));
  await vault.write("user-a", { refresh_token: "private-test-token" });
  expect(await vault.read("user-b")).toBeNull();
  for (const file of await readdir(join(dir, "vault")))
    expect(await readFile(join(dir, "vault", file), "utf8")).not.toContain(
      "private-test-token",
    );
  expect(await vault.take("user-a")).toEqual({
    refresh_token: "private-test-token",
  });
  expect(await vault.take("user-a")).toBeNull();
});
async function google() {
  const vault = new EncryptedCalendarVault(join(dir, "vault"), "b".repeat(64));
  await vault.write("connection:" + repo.userId, {
    id: connection,
    account: "test@example.com",
    refresh_token: "test-only",
    writable: true,
  });
  const fetcher = vi.fn<typeof fetch>();
  const p = new GoogleCalendarProvider(
    repo.userId,
    vault,
    fetcher,
    async () => "test-access",
  );
  return { p, fetcher, vault };
}
const rawGoogle = (extra = {}) => ({
  id: "event1",
  etag: '"v1"',
  summary: fields.summary,
  description: fields.description,
  start: { dateTime: fields.start, timeZone: "UTC" },
  end: { dateTime: fields.end },
  organizer: { self: true },
  ...extra,
});
it("Google create has a stable provider ID and recovers without a duplicate write", async () => {
  const { p, fetcher } = await google();
  const input = write().input;
  fetcher
    .mockResolvedValueOnce(new Response("", { status: 404 }))
    .mockImplementationOnce(async (_url, init) =>
      Response.json({ ...rawGoogle(), ...JSON.parse(String(init?.body)) }),
    );
  const first = await p.create(input, []);
  const body = JSON.parse(String(fetcher.mock.calls[1][1]?.body));
  expect(body.id).toMatch(/^[a-f0-9]{64}$/);
  expect(body.attendees).toBeUndefined();
  expect(String(fetcher.mock.calls[1][0])).toContain("sendUpdates=none");
  fetcher.mockResolvedValueOnce(Response.json({ ...rawGoogle(), ...body }));
  const second = await p.create(input, []);
  expect(second.recovered).toBe(true);
  expect(second.event.id).toBe(first.event.id);
  expect(fetcher).toHaveBeenCalledTimes(3);
});
it("Google update uses If-Match and rejects a stale review", async () => {
  const { p, fetcher } = await google();
  const input = {
    ...write().input,
    event_id: "event1",
    etag: '"v1"',
    before: fields,
    event: { ...fields, summary: "New title" },
  };
  fetcher.mockResolvedValueOnce(Response.json(rawGoogle({ etag: '"v2"' })));
  await expect(p.update(input, [])).rejects.toThrow("changed since review");
  expect(fetcher).toHaveBeenCalledTimes(1);
  fetcher
    .mockResolvedValueOnce(Response.json(rawGoogle()))
    .mockResolvedValueOnce(new Response("", { status: 412 }));
  await expect(p.update(input, [])).rejects.toThrow("changed during execution");
  expect(fetcher.mock.calls[2][1]?.headers).toMatchObject({
    "If-Match": '"v1"',
  });
});
it("reconnecting invalidates previously reviewed account requests", async () => {
  const { p, fetcher } = await google();
  await expect(
    p.create({ ...write().input, connection_id: randomUUID() }, []),
  ).rejects.toThrow("connection changed");
  expect(fetcher).not.toHaveBeenCalled();
});
it("read-only Google consent cannot execute a write", async () => {
  const { p, fetcher, vault } = await google();
  await vault.write("connection:" + repo.userId, {
    id: connection,
    refresh_token: "test",
    writable: false,
  });
  await expect(p.create(write().input, [])).rejects.toThrow("editing consent");
  expect(fetcher).not.toHaveBeenCalled();
});
it("Google pagination signals incomplete results rather than claiming free time", async () => {
  const { p, fetcher } = await google();
  fetcher.mockImplementation(async () =>
    Response.json({ items: [], timeZone: "UTC", nextPageToken: "more" }),
  );
  const result = await p.list({ start: fields.start, end: fields.end });
  expect(result.complete).toBe(false);
  expect(fetcher).toHaveBeenCalledTimes(4);
});
it("tool metadata communicates mandatory approval even under level five", async () => {
  const catalog = await requests.catalog();
  expect(
    catalog.find((t) => t.name === "google_calendar.create")
      ?.always_requires_approval,
  ).toBe(true);
  expect(
    calendarWriteInput.safeParse({
      ...write().input,
      event: { ...fields, time_zone: "fake/zone" },
    }).success,
  ).toBe(false);
});
it("recovers an external success after local receipt failure without duplicating Google events", async () => {
  const { p, fetcher } = await google();
  let stored: unknown = null;
  fetcher.mockImplementation(async (_url, init) => {
    if (init?.method === "POST") {
      stored = { ...rawGoogle(), ...JSON.parse(String(init.body)) };
      return Response.json(stored);
    }
    return stored ? Response.json(stored) : new Response("", { status: 404 });
  });
  requests = new ActionRequestService(
    repo,
    actions,
    registerCalendarTools(new ToolRegistry(), repo, p),
  );
  const raw = write();
  await approve(raw);
  vi.spyOn(repo, "batch").mockRejectedValueOnce(
    new Error("Database commit unavailable"),
  );
  await expect(requests.request(raw)).rejects.toThrow(
    "Database commit unavailable",
  );
  expect(stored).not.toBeNull();
  const retry = { ...raw, request_key: randomUUID() };
  await approve(retry);
  const result = await requests.request(retry);
  expect(result.result.recovered).toBe(true);
  expect(
    fetcher.mock.calls.filter((c) => c[1]?.method === "POST"),
  ).toHaveLength(1);
  expect((await repo.get("actions", result.action_id))?.status).toBe(
    "succeeded",
  );
});
it("reusing a Google operation with different details cannot overwrite an event", async () => {
  const { p, fetcher } = await google();
  const input = write().input;
  fetcher
    .mockResolvedValueOnce(new Response("", { status: 404 }))
    .mockImplementationOnce(async (_url, init) =>
      Response.json({ ...rawGoogle(), ...JSON.parse(String(init?.body)) }),
    );
  await p.create(input, []);
  const body = JSON.parse(String(fetcher.mock.calls[1][1]?.body));
  fetcher.mockResolvedValueOnce(Response.json({ ...rawGoogle(), ...body }));
  await expect(
    p.create(
      { ...input, event: { ...fields, summary: "Different intent" } },
      [],
    ),
  ).rejects.toThrow("different event details");
  expect(
    fetcher.mock.calls.filter((c) => c[1]?.method === "POST"),
  ).toHaveLength(1);
});
it("existing event links cannot be omitted to bypass scoped policies", async () => {
  const { p, fetcher } = await google();
  fetcher.mockResolvedValueOnce(
    Response.json(
      rawGoogle({
        extendedProperties: { private: { ary_entity_ids: randomUUID() } },
      }),
    ),
  );
  await expect(
    p.update(
      { ...write().input, event_id: "event1", etag: '"v1"', before: fields },
      [],
    ),
  ).rejects.toThrow("existing Nexus links");
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("read and recommendation preserve the selected account through the existing action audit", async () => {
  const input = {
    start: fields.start,
    end: fields.end,
    connection_id: randomUUID(),
  };
  const result = await requests.request({
    tool: "google_calendar.read",
    input,
    request_key: randomUUID(),
    reason: "Read selected work calendar",
  });
  expect(provider.list).toHaveBeenLastCalledWith(input);
  const record = await repo.get("actions", result.action_id);
  expect(JSON.stringify(record)).toContain(input.connection_id);
  await requests.request({
    tool: "google_calendar.recommend",
    input: { ...input, minutes: 60 },
    request_key: randomUUID(),
    reason: "Recommend on selected work calendar",
  });
  expect(provider.list).toHaveBeenLastCalledWith(input);
});
