import { it, expect, beforeEach, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LocalRepository } from "../src/infrastructure/repositories/local";
import { EncryptedCalendarVault } from "../src/infrastructure/calendar/vault";
import {
  GoogleGmailProvider,
  encodeMail,
  normalizeMail,
} from "../src/infrastructure/gmail/google-gmail";
import {
  gmailSendInput,
  type GmailProvider,
  type MailIntelligence,
  type MailThread,
} from "../src/domain/gmail";
import { GmailService } from "../src/services/gmail-service";
import { ActionRequestService } from "../src/services/action-request-service";
import {
  ActionService,
  ApprovalRequiredError,
} from "../src/services/action-service";
import { registerGmailTools } from "../src/infrastructure/tools/gmail-tools";
import { ToolRegistry } from "../src/domain/tool-registry";
import { MemoryService } from "../src/services/memory-service";
import { LocalEmbeddingProvider } from "../src/infrastructure/providers/local";
const connection = randomUUID(),
  quote =
    "We decided to prioritize fixing Wag Trails tracking before adding more features.";
const thread: MailThread = {
  id: "abc123",
  connection_id: connection,
  account: "owner@example.com",
  truncated: false,
  messages: [
    {
      id: "def456",
      thread_id: "abc123",
      from: "Alex <alex@example.com>",
      to: "owner@example.com",
      subject: "Wag Trails decision",
      date: "2026-09-07T12:00:00Z",
      text: quote,
      body_available: true,
      truncated: false,
    },
  ],
};
const candidate = {
  kind: "decision" as const,
  message_id: "def456",
  quote,
  importance: 0.9,
  confidence: 0.8,
  reason: "Explicit project decision",
};
let dir: string,
  repo: LocalRepository,
  actions: ActionService,
  requests: ActionRequestService,
  provider: GmailProvider,
  intelligence: MailIntelligence,
  vault: EncryptedCalendarVault;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ary-gmail-test-"));
  repo = new LocalRepository(randomUUID(), join(dir, "db.json"));
  vault = new EncryptedCalendarVault(join(dir, "vault"), "a".repeat(64));
  actions = new ActionService(repo);
  provider = {
    status: vi.fn(),
    search: vi.fn().mockResolvedValue({
      connection_id: connection,
      threads: [{ id: thread.id, snippet: quote }],
      next_page: null,
    }),
    thread: vi.fn().mockResolvedValue(thread),
    send: vi.fn().mockResolvedValue({
      message_id: "feed1",
      thread_id: "feed2",
      recovered: false,
    }),
  };
  intelligence = {
    summarize: vi.fn().mockResolvedValue({
      summary: "Tracking comes first.",
      candidates: [candidate],
    }),
    draft: vi.fn().mockResolvedValue({
      subject: "Re: Tracking",
      body: "Thanks for the decision. I have noted it.",
    }),
  };
  const service = new GmailService(
    repo,
    actions,
    provider,
    intelligence,
    new MemoryService(repo, new LocalEmbeddingProvider()),
    vault,
  );
  requests = new ActionRequestService(
    repo,
    actions,
    registerGmailTools(new ToolRegistry(), repo, service),
  );
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});
const reference = { connection_id: connection, thread_id: thread.id };
async function draft() {
  return requests.request({
    tool: "gmail.draft",
    input: { ...reference, instruction: "Acknowledge the decision" },
    request_key: randomUUID(),
  });
}
async function sendRequest() {
  const d = await draft();
  return {
    tool: "gmail.send",
    input: {
      connection_id: connection,
      operation_id: randomUUID(),
      draft_action_id: d.action_id,
      from_account: "owner@example.com",
      to: ["alex@example.com"],
      cc: [],
      subject: "Re: Tracking",
      body: "Thank you.",
      source_thread_id: thread.id,
    },
    request_key: randomUUID(),
    reason: "Explicit test review",
  };
}
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
    "Explicitly reviewed this request",
  );
}
it("reading and summarizing do not create permanent memories or send", async () => {
  await requests.request({ tool: "gmail.read", input: reference });
  await requests.request({ tool: "gmail.summarize", input: reference });
  expect(await repo.list("memories")).toEqual([]);
  expect(provider.send).not.toHaveBeenCalled();
  expect(
    (await repo.list("actions"))
      .filter((a) => a.tool_name.startsWith("gmail."))
      .every(
        (a) => a.metadata.external === true || a.tool_name === "gmail.read",
      ),
  ).toBe(true);
});
it("drafts stay local and retain an audited source conversation", async () => {
  const d = await draft();
  expect(d.result).toMatchObject({
    sent: false,
    state: "draft",
    source_thread_id: thread.id,
  });
  expect(provider.send).not.toHaveBeenCalled();
  expect((await repo.get("actions", d.action_id))?.output.result).toEqual(
    d.result,
  );
});
it.each([0, 1, 2, 3])("level %i cannot send", async (level) => {
  const r = await sendRequest();
  await actions.permissions.savePolicy({
    tool: "gmail.send",
    level,
    reason: "Boundary",
  });
  await expect(requests.request(r)).rejects.toThrow("not permitted");
  expect(provider.send).not.toHaveBeenCalled();
});
it.each([4, 5])(
  "level %i requires explicit approval and replays once",
  async (level) => {
    const r = await sendRequest();
    await actions.permissions.savePolicy({
      tool: "gmail.send",
      level,
      reason: "Boundary",
    });
    await approve(r);
    expect(provider.send).not.toHaveBeenCalled();
    const result = await requests.request(r);
    await requests.request(r);
    expect(provider.send).toHaveBeenCalledTimes(1);
    expect(
      (await repo.get("actions", result.action_id))?.metadata.approval_id,
    ).toBeTruthy();
  },
);
it("rejected approval never sends", async () => {
  const r = await sendRequest();
  let id = "";
  try {
    await requests.request(r);
  } catch (e) {
    id = (e as ApprovalRequiredError).actionId;
  }
  await actions.permissions.review(id, "rejected", "Do not send");
  await expect(requests.request(r)).rejects.toBeInstanceOf(
    ApprovalRequiredError,
  );
  expect(provider.send).not.toHaveBeenCalled();
});
it("editing recipients invalidates prior approval", async () => {
  const r = await sendRequest();
  await approve(r);
  await expect(
    requests.request({
      ...r,
      input: { ...r.input, to: ["different@example.com"] },
    }),
  ).rejects.toBeInstanceOf(ApprovalRequiredError);
  expect(provider.send).not.toHaveBeenCalled();
});
it("summaries and drafts cannot bypass denied Gmail read", async () => {
  await actions.permissions.savePolicy({
    tool: "gmail.read",
    level: 0,
    reason: "No reading",
  });
  await expect(
    requests.request({ tool: "gmail.summarize", input: reference }),
  ).rejects.toThrow("not permitted");
  await expect(draft()).rejects.toThrow("not permitted");
  expect(provider.thread).not.toHaveBeenCalled();
});
it("filters ungrounded, unimportant and truncated email candidates", async () => {
  vi.mocked(intelligence.summarize).mockResolvedValue({
    summary: "Selected context",
    candidates: [
      candidate,
      {
        ...candidate,
        quote: "This quote is invented and not present in the email.",
      },
      { ...candidate, importance: 0.2 },
    ],
  });
  const r = await requests.request({
    tool: "gmail.summarize",
    input: reference,
  });
  expect(r.result.candidates).toHaveLength(1);
  vi.mocked(provider.thread).mockResolvedValue({
    ...thread,
    messages: [{ ...thread.messages[0], truncated: true }],
  });
  const truncated = await requests.request({
    tool: "gmail.summarize",
    input: reference,
  });
  expect(truncated.result.candidates).toEqual([]);
});
it("only reviewed quotes become attributed episodic evidence; repeat capture is idempotent", async () => {
  const a = await requests.request({
    tool: "gmail.summarize",
    input: reference,
  });
  const r = {
    tool: "gmail.evidence",
    input: { analysis_action_id: a.action_id, candidate_index: 0, quote },
    request_key: randomUUID(),
  };
  await approve(r);
  const first = await requests.request(r);
  const retry = { ...r, request_key: randomUUID() };
  await approve(retry);
  const again = await requests.request(retry);
  expect(again.result.memory_id).toBe(first.result.memory_id);
  const memories = await repo.list("memories");
  expect(memories).toHaveLength(1);
  expect(memories[0].memory_type).toBe("episodic");
  expect(memories[0].content).toContain("alex@example.com");
  expect(memories[0].metadata.gmail_source).toMatchObject({
    message_id: "def456",
    quote,
    analysis_action_id: a.action_id,
  });
  expect((await repo.list("memory_sources"))[0].quote).toContain("gmail://");
});
it("cannot copy whole Gmail action results into memory", async () => {
  const a = await requests.request({ tool: "gmail.read", input: reference });
  await expect(requests.remember(a.action_id)).rejects.toThrow();
  expect(await repo.list("memories")).toEqual([]);
});
it("forged evidence quotes are rejected without a memory", async () => {
  const a = await requests.request({
    tool: "gmail.summarize",
    input: reference,
  });
  const r = {
    tool: "gmail.evidence",
    input: {
      analysis_action_id: a.action_id,
      candidate_index: 0,
      quote: "An invented, unrelated claim to store.",
    },
    request_key: randomUUID(),
  };
  await approve(r);
  await expect(requests.request(r)).rejects.toThrow("does not match");
  expect(await repo.list("memories")).toEqual([]);
});
it("existing canonical aliases link source context and enforce project send policy", async () => {
  const project = await repo.insert("entities", {
    name: "Wag Trails",
    entity_type: "project",
    description: "Trails",
    metadata: {},
  });
  await repo.insert("entity_aliases", { entity_id: project.id, alias: "Wag" });
  const r = await sendRequest();
  await actions.permissions.savePolicy({
    tool: "gmail.send",
    product_entity_id: project.id,
    level: 0,
    reason: "Project cannot send",
  });
  await expect(
    requests.request({ ...r, related_entity_ids: [] }),
  ).rejects.toThrow("not permitted");
  expect(provider.send).not.toHaveBeenCalled();
});
it("missing draft source cannot be sent", async () => {
  const r = await sendRequest();
  await expect(
    requests.request({
      ...r,
      input: { ...r.input, draft_action_id: randomUUID() },
    }),
  ).rejects.toThrow();
  expect(provider.send).not.toHaveBeenCalled();
});
it.each(["bad\r\nBcc: hidden@example.com", "not-an-email"])(
  "rejects recipient/header injection %s",
  (value) => {
    expect(
      gmailSendInput.safeParse({
        connection_id: connection,
        operation_id: randomUUID(),
        draft_action_id: randomUUID(),
        from_account: "owner@example.com",
        to: [value],
        cc: [],
        subject: "Hello",
        body: "Text",
      }).success,
    ).toBe(false);
  },
);
it("HTML-only mail and attachments are not executed or fetched", () => {
  const m = normalizeMail({
    id: "a",
    threadId: "b",
    payload: {
      mimeType: "multipart/mixed",
      parts: [
        {
          mimeType: "text/html",
          body: {
            data: Buffer.from("<script>alert(1)</script>").toString(
              "base64url",
            ),
          },
        },
        {
          mimeType: "text/plain",
          filename: "attachment.txt",
          body: { data: Buffer.from("private file").toString("base64url") },
        },
      ],
    },
  });
  expect(m.body_available).toBe(false);
  expect(m.text).toBe("");
});
async function google() {
  await vault.write("gmail:connection:" + repo.userId, {
    id: connection,
    account: "owner@example.com",
    refresh_token: "test",
    writable: true,
  });
  const fetcher = vi.fn<typeof fetch>();
  return {
    p: new GoogleGmailProvider(
      repo.userId,
      vault,
      fetcher,
      async () => "test-token",
    ),
    fetcher,
  };
}
const sendInput = () => ({
  connection_id: connection,
  operation_id: randomUUID(),
  draft_action_id: randomUUID(),
  from_account: "owner@example.com",
  to: ["alex@example.com"],
  cc: [],
  subject: "Reviewed message",
  body: "Exact message",
  source_thread_id: thread.id,
});
it("successful provider send is never repeated for the same operation", async () => {
  const { p, fetcher } = await google();
  fetcher.mockResolvedValue(Response.json({ id: "fed1", threadId: "fed2" }));
  const input = sendInput();
  await p.send(input);
  expect(await p.send(input)).toMatchObject({
    message_id: "fed1",
    recovered: true,
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
  const mime = Buffer.from(
    JSON.parse(String(fetcher.mock.calls[0][1]?.body)).raw,
    "base64url",
  ).toString();
  expect(mime).toContain("To: alex@example.com");
  expect(mime).toContain("Message-ID: <ary-");
  expect(mime).not.toContain("Bcc:");
});
it("timeout never triggers a blind resend; a Sent match recovers", async () => {
  const { p, fetcher } = await google();
  const input = sendInput();
  fetcher.mockRejectedValueOnce(new Error("Timeout"));
  await expect(p.send(input)).rejects.toThrow("uncertain");
  fetcher.mockResolvedValueOnce(Response.json({ messages: [] }));
  await expect(p.send(input)).rejects.toThrow("No resend");
  fetcher.mockResolvedValueOnce(
    Response.json({ messages: [{ id: "fed1", threadId: "fed2" }] }),
  );
  expect(await p.send(input)).toMatchObject({ recovered: true });
  expect(
    fetcher.mock.calls.filter((c) => c[1]?.method === "POST"),
  ).toHaveLength(1);
});
it("changed send text cannot reuse an operation ID", async () => {
  const { p, fetcher } = await google();
  fetcher.mockResolvedValue(Response.json({ id: "fed1", threadId: "fed2" }));
  const input = sendInput();
  await p.send(input);
  await expect(p.send({ ...input, body: "Different" })).rejects.toThrow(
    "different recipients or text",
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("disconnect/account replacement blocks a previously reviewed send", async () => {
  const { p, fetcher } = await google();
  await expect(
    p.send({ ...sendInput(), connection_id: randomUUID() }),
  ).rejects.toThrow("account changed");
  expect(fetcher).not.toHaveBeenCalled();
});
it("Gmail read-only consent cannot send", async () => {
  const { p, fetcher } = await google();
  await vault.write("gmail:connection:" + repo.userId, {
    id: connection,
    refresh_token: "test",
    writable: false,
  });
  await expect(p.send(sendInput())).rejects.toThrow("send consent");
  expect(fetcher).not.toHaveBeenCalled();
});
it("same Gmail thread ID under another tenant has no credential access", async () => {
  await google();
  const fetcher = vi.fn<typeof fetch>(),
    p = new GoogleGmailProvider(
      randomUUID(),
      vault,
      fetcher,
      async () => "test",
    );
  await expect(p.thread(reference)).rejects.toThrow("Connect Gmail");
  expect(fetcher).not.toHaveBeenCalled();
});
it("revoked read permission blocks captured evidence without writing memory", async () => {
  const a = await requests.request({
    tool: "gmail.summarize",
    input: reference,
  });
  const r = {
    tool: "gmail.evidence",
    input: { analysis_action_id: a.action_id, candidate_index: 0, quote },
    request_key: randomUUID(),
  };
  await approve(r);
  await actions.permissions.savePolicy({
    tool: "gmail.read",
    level: 0,
    reason: "Revoke reading",
  });
  await expect(requests.request(r)).rejects.toThrow("not permitted");
  expect(await repo.list("memories")).toEqual([]);
});
it("recovers a Gmail success after local outcome commit failure without a second send", async () => {
  const raw = await sendRequest();
  const { p, fetcher } = await google();
  fetcher.mockResolvedValue(Response.json({ id: "fed1", threadId: "fed2" }));
  requests = new ActionRequestService(
    repo,
    actions,
    registerGmailTools(
      new ToolRegistry(),
      repo,
      new GmailService(repo, actions, p),
    ),
  );
  await approve(raw);
  vi.spyOn(repo, "batch").mockRejectedValueOnce(
    new Error("Database commit unavailable"),
  );
  await expect(requests.request(raw)).rejects.toThrow(
    "Database commit unavailable",
  );
  expect(
    (await repo.list("outcomes")).some((o) => o.status === "failure"),
  ).toBe(true);
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
it("does not invent dates when Gmail omits one", () => {
  expect(normalizeMail({ id: "a", threadId: "b" }).date).toBe("unknown");
});
it("cannot execute a send with a misleading From account", async () => {
  const { p, fetcher } = await google();
  await expect(
    p.send({ ...sendInput(), from_account: "other@example.com" }),
  ).rejects.toThrow("sending account");
  expect(fetcher).not.toHaveBeenCalled();
});
it("long Unicode subjects retain exact text with valid folded MIME headers", () => {
  const input = {
    ...sendInput(),
    subject: "Wag Trails 🌿 — décision ".repeat(7),
  };
  const mime = Buffer.from(
    encodeMail(input, "owner@example.com", "fixture@ary-nexus.local"),
    "base64url",
  ).toString();
  const subject = mime.split("Subject: ")[1].split("\r\nMessage-ID:")[0];
  const words = [...subject.matchAll(/=\?UTF-8\?B\?([^?]+)\?=/g)];
  expect(
    words.map((w) => Buffer.from(w[1], "base64").toString()).join(""),
  ).toBe(input.subject);
  expect(
    ("Subject: " + subject).split("\r\n").every((line) => line.length <= 76),
  ).toBe(true);
});
