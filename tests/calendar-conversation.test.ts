import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { LocalRepository } from "../src/infrastructure/repositories/local";
import { ActionService } from "../src/services/action-service";
import { ActionRequestService } from "../src/services/action-request-service";
import { CalendarConversationService } from "../src/services/calendar-conversation-service";
import { registerCalendarTools } from "../src/infrastructure/tools/calendar-tools";
import { ToolRegistry } from "../src/domain/tool-registry";
import type { CalendarProvider } from "../src/domain/calendar";
import type { Message } from "../src/domain/models";
import { AppError } from "../src/domain/validation";
let dir: string,
  repo: LocalRepository,
  actions: ActionService,
  provider: CalendarProvider,
  chat: CalendarConversationService,
  source: Message;
const personal = {
  connection_id: randomUUID(),
  account: "owner@gmail.com",
  writable: false,
};
const work = {
  connection_id: randomUUID(),
  account: "owner@clevaryn.com",
  writable: false,
};
const status = () => ({
  configured: true,
  connected: true,
  writable: false,
  connection_id: personal.connection_id,
  account: personal.account,
  accounts: [personal, work],
});
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ary-chat-calendar-"));
  repo = new LocalRepository(randomUUID(), join(dir, "db.json"));
  actions = new ActionService(repo);
  const conversation = await repo.insert("conversations", {
    title: "Calendar acceptance",
    metadata: {},
  });
  source = await repo.insert("messages", {
    conversation_id: conversation.id,
    role: "user",
    content: "Show my calendar",
    metadata: {},
  });
  provider = {
    status: vi.fn().mockResolvedValue(status()),
    list: vi.fn(async ({ connection_id, start }) => ({
      connection_id: connection_id!,
      complete: true,
      time_zone: "UTC",
      events: [
        {
          id: "same-id",
          etag: "v1",
          time_zone: "UTC",
          summary:
            connection_id === personal.connection_id
              ? "Personal check"
              : "Work review",
          description: "",
          start,
          end: new Date(Date.parse(start) + 3600000).toISOString(),
          all_day: false,
          busy: true,
          editable: false,
          html_url: null,
          people: [],
          entity_ids: [],
        },
      ],
    })),
    create: vi.fn(),
    update: vi.fn(),
  };
  chat = new CalendarConversationService(
    repo,
    actions,
    provider,
    new ActionRequestService(
      repo,
      actions,
      registerCalendarTools(new ToolRegistry(), repo, provider),
    ),
  );
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});
it("reads both by default through existing actions with account attribution and cross-account conflicts", async () => {
  const reply = await chat.handle("What's on my calendar?", source);
  expect(provider.list).toHaveBeenCalledTimes(2);
  expect(reply?.content).toContain("[owner@gmail.com] Personal check");
  expect(reply?.content).toContain("[owner@clevaryn.com] Work review");
  expect(reply?.metadata.calendar_complete).toBe(true);
  expect(reply?.metadata.calendar_conflicts).toEqual([
    expect.objectContaining({
      event_ids: expect.arrayContaining([
        personal.connection_id + ":same-id",
        work.connection_id + ":same-id",
      ]),
    }),
  ]);
  const reads = (await repo.list("actions")).filter(
    (a) => a.tool_name === "google_calendar.read",
  );
  expect(reads).toHaveLength(2);
  expect(reads.every((a) => a.status === "succeeded")).toBe(true);
  expect(
    (await repo.list("outcomes")).filter((o) =>
      reads.some((a) => a.id === o.action_id),
    ),
  ).toHaveLength(2);
});
it.each([
  ["Show my personal calendar", personal.connection_id],
  ["Show my work calendar", work.connection_id],
  ["Show my Clevaryn calendar", work.connection_id],
  ["Show the calendar for owner@clevaryn.com", work.connection_id],
])("targets the requested account: %s", async (query, id) => {
  await chat.handle(query, source);
  expect(provider.list).toHaveBeenCalledTimes(1);
  expect(provider.list).toHaveBeenCalledWith(
    expect.objectContaining({ connection_id: id }),
  );
});
it("handles plural calendars and a schedule question as reads", async () => {
  expect(
    (await chat.handle("Show both calendars", source))?.metadata
      .calendar_complete,
  ).toBe(true);
  expect(
    (
      await chat.handle(
        "What is my schedule tomorrow?",
        await repo.insert("messages", {
          conversation_id: source.conversation_id,
          role: "user",
          content: "What is my schedule tomorrow?",
          metadata: {},
        }),
      )
    )?.metadata.calendar_complete,
  ).toBe(true);
  expect(provider.create).not.toHaveBeenCalled();
});
it("reports partial failures instead of asserting combined availability", async () => {
  vi.mocked(provider.list).mockImplementation(async ({ connection_id }) => {
    if (connection_id === work.connection_id)
      throw new AppError("Work service unavailable", 502);
    return {
      events: [],
      complete: true,
      connection_id: personal.connection_id,
      time_zone: "UTC",
    };
  });
  const reply = await chat.handle("What events are on both calendars?", source);
  expect(reply?.content).toContain("Could not check owner@clevaryn.com");
  expect(reply?.content).toContain("combined availability is unknown");
  expect(reply?.metadata.calendar_complete).toBe(false);
  expect(
    (await repo.list("actions")).some(
      (a) => a.tool_name === "google_calendar.read" && a.status === "failed",
    ),
  ).toBe(true);
});
it("respects read denial for every account with no provider calls", async () => {
  await actions.permissions.savePolicy({
    tool: "google_calendar.read",
    level: 0,
    reason: "Deny calendar reads",
  });
  const reply = await chat.handle("Show both calendars", source);
  expect(provider.list).not.toHaveBeenCalled();
  expect(reply?.metadata.calendar_complete).toBe(false);
  expect(
    (await repo.list("actions")).filter((a) => a.status === "blocked"),
  ).toHaveLength(2);
});
it("requires clarification for ambiguous work accounts or an unknown email", async () => {
  vi.mocked(provider.status).mockResolvedValue({
    ...status(),
    accounts: [
      ...status().accounts,
      { ...work, connection_id: randomUUID(), account: "second@clevaryn.com" },
    ],
  });
  expect(
    (await chat.handle("Show my work calendar", source))?.content,
  ).toContain("ambiguous");
  expect(
    (await chat.handle("Show calendar for unknown@example.com", source))
      ?.content,
  ).toContain("not connected");
  expect(provider.list).not.toHaveBeenCalled();
});
it("leaves writes in the existing approval form", async () => {
  expect(
    (await chat.handle("Schedule a meeting on my work calendar", source))
      ?.content,
  ).toContain("approval");
  expect(provider.status).not.toHaveBeenCalled();
  expect(provider.list).not.toHaveBeenCalled();
  expect(provider.create).not.toHaveBeenCalled();
});
it("replays the same message without duplicate external reads", async () => {
  await chat.handle("Show both calendars", source);
  await chat.handle("Show both calendars", source);
  expect(provider.list).toHaveBeenCalledTimes(2);
});
it("does not infer availability from truncated results", async () => {
  vi.mocked(provider.list).mockResolvedValue({
    events: [],
    complete: false,
    connection_id: personal.connection_id,
    time_zone: "UTC",
  });
  const reply = await chat.handle("Show my personal calendar", source);
  expect(reply?.content).toContain("combined availability is unknown");
});
it("preserves legacy single-account status responses", async () => {
  const { accounts, ...legacy } = status();
  vi.mocked(provider.status).mockResolvedValue(legacy);
  await chat.handle("Show my calendar", source);
  expect(provider.list).toHaveBeenCalledTimes(1);
});
