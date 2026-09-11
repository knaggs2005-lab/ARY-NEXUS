import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LocalRepository } from "../src/infrastructure/repositories/local";
import { FinanceService } from "../src/services/finance-service";
import { financeImport, parseMoneyInput } from "../src/domain/finance";
import {
  ActionService,
  ApprovalRequiredError,
} from "../src/services/action-service";
import { ActionRequestService } from "../src/services/action-request-service";
import { FinanceConversationService } from "../src/services/finance-conversation-service";
let dir: string,
  repo: LocalRepository,
  service: FinanceService,
  actions: ActionService,
  requests: ActionRequestService;
export function statement(patch: Record<string, unknown> = {}) {
  return financeImport.parse({
    import_key: randomUUID(),
    account_key: "cash-main",
    parent_id: null,
    as_of: "2026-09-07T00:00:00Z",
    observed_at: "2026-09-07T00:00:00Z",
    source_label: "September statement",
    source_reference: "statement.pdf page 1",
    payload: {
      account: {
        name: "Operating cash",
        institution: "Source institution",
        currency: "USD",
        kind: "cash",
      },
      balance_minor: 100000,
      coverage: {
        start: "2026-09-01T00:00:00Z",
        end: "2026-09-07T00:00:00Z",
        complete: true,
      },
      transactions: [
        {
          source_id: "pay",
          at: "2026-09-02T00:00:00Z",
          description: "Reported income",
          kind: "income",
          amount_minor: 30000,
          status: "posted",
          entity_id: null,
          goal_id: null,
        },
        {
          source_id: "expense",
          at: "2026-09-03T00:00:00Z",
          description: "Reported expense",
          kind: "expense",
          amount_minor: 10000,
          status: "posted",
          entity_id: null,
          goal_id: null,
        },
        {
          source_id: "transfer",
          at: "2026-09-04T00:00:00Z",
          description: "Transfer",
          kind: "transfer",
          amount_minor: 50000,
          status: "posted",
          entity_id: null,
          goal_id: null,
        },
      ],
      bills: [],
      holdings: [],
      holdings_complete: false,
      entity_ids: [],
      goal_ids: [],
    },
    ...patch,
  });
}
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ary-finance-"));
  repo = new LocalRepository(randomUUID(), join(dir, "db.json"));
  service = new FinanceService(repo);
  actions = new ActionService(repo);
  requests = new ActionRequestService(repo, actions);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});
const at = { as_of: "2026-09-07T00:00:00Z" };
async function approve(raw: unknown) {
  let id = "";
  try {
    await requests.request(raw);
  } catch (e) {
    expect(e).toBeInstanceOf(ApprovalRequiredError);
    id = (e as ApprovalRequiredError).actionId;
  }
  expect(id).toBeTruthy();
  await actions.permissions.review(id, "approved", "Reviewed statement import");
  return id;
}
it("empty finance does not invent zeros, accounts or financial impact", async () => {
  expect(await service.report(at)).toMatchObject({
    empty: true,
    groups: [],
    accounts: [],
  });
});
it("balances, spending, income and transfers follow source classification", async () => {
  await service.import(statement());
  const r = await service.report(at);
  expect(r.groups[0]).toMatchObject({
    net_worth_minor: 100000,
    spending_minor: 10000,
    income_minor: 30000,
    coverage_complete: true,
  });
  expect(r.accounts[0].latest.source_reference).toBe("statement.pdf page 1");
  expect(await repo.list("memories")).toEqual([]);
});
it("debt reduces net worth and holdings are not double-counted", async () => {
  await service.import(statement());
  const debt = statement({ account_key: "debt" });
  debt.payload.account.kind = "loan";
  debt.payload.balance_minor = 20000;
  debt.payload.transactions = [];
  await service.import(debt);
  const invest = statement({ account_key: "portfolio" });
  invest.payload.account.kind = "investment";
  invest.payload.balance_minor = 50000;
  invest.payload.holdings = [
    {
      source_id: "stock",
      name: "Recorded holding",
      symbol: "ABC",
      quantity: "2.50",
      value_minor: 45000,
    },
  ];
  invest.payload.transactions = [];
  await service.import(invest);
  expect((await service.report(at)).groups[0]).toMatchObject({
    net_worth_minor: 130000,
    debt_minor: 20000,
    portfolio_minor: 50000,
  });
});
it("currencies are separated and missing balances stay unknown", async () => {
  await service.import(statement());
  const jpy = statement({ account_key: "yen" });
  jpy.payload.account.currency = "JPY";
  jpy.payload.balance_minor = null;
  await service.import(jpy);
  const r = await service.report(at);
  expect(r.groups).toHaveLength(2);
  expect(r.groups.find((g) => g.currency === "JPY")).toMatchObject({
    net_worth_minor: null,
    missing_balances: 1,
  });
});
it("changes reference two statements and do not infer causes or investment returns", async () => {
  const before = statement({
    as_of: "2026-09-01T00:00:00Z",
    observed_at: "2026-09-01T00:00:00Z",
    payload: {
      ...statement().payload,
      balance_minor: 80000,
      coverage: null,
      transactions: [],
    },
  });
  await service.import(before);
  await service.import(statement());
  const account = (await service.report(at)).accounts[0];
  expect(account.delta_minor).toBe(20000);
  expect(account.explanation).toContain("have not been inferred");
  expect(account.previous?.payload.balance_minor).toBe(80000);
});
it("explicit corrections retain history and respect observation time", async () => {
  const original = statement();
  const old = await service.import(original);
  const correction = statement({
    parent_id: old.snapshot_id,
    observed_at: "2026-09-07T01:00:00Z",
  });
  correction.payload.balance_minor = 90000;
  await service.import(correction);
  expect(
    (await service.report(at)).accounts[0].latest.payload.balance_minor,
  ).toBe(100000);
  const r = await service.report({ as_of: "2026-09-07T02:00:00Z" });
  expect(r.accounts[0].latest.payload.balance_minor).toBe(90000);
  expect(r.accounts[0].history).toHaveLength(2);
  expect(
    r.accounts[0].history.find((h) => h.id === old.snapshot_id)?.superseded,
  ).toBe(true);
});
it("duplicate import is idempotent while altered reuse is rejected", async () => {
  const input = statement();
  const first = await service.import(input);
  expect(await service.import(input)).toMatchObject({
    snapshot_id: first.snapshot_id,
    recovered: true,
  });
  await expect(
    service.import({ ...input, source_label: "Different" }),
  ).rejects.toThrow("different statement");
});
it("same account/date requires explicit correction; identity is stable", async () => {
  await service.import(statement());
  await expect(service.import(statement())).rejects.toThrow(
    "explicit correction",
  );
  const entry = statement({
    as_of: "2026-09-07T02:00:00Z",
    observed_at: "2026-09-07T02:00:00Z",
  });
  entry.payload.account.currency = "EUR";
  await expect(service.import(entry)).rejects.toThrow();
});
it("prevents foreign entity/goal links and cross-user visibility", async () => {
  const other = new LocalRepository(randomUUID(), join(dir, "db.json"));
  const entity = await other.insert("entities", {
    name: "Private",
    entity_type: "company",
    description: "",
    metadata: {},
  });
  const entry = statement();
  entry.payload.entity_ids = [entity.id];
  await expect(service.import(entry)).rejects.toThrow();
  await new FinanceService(other).import(statement());
  expect((await service.report(at)).empty).toBe(true);
});
it.each([0, 1, 2, 3])(
  "permission level %i cannot import statements",
  async (level) => {
    await actions.permissions.savePolicy({
      tool: "finance.import",
      level,
      reason: "Test",
    });
    await expect(
      requests.request({
        tool: "finance.import",
        input: statement(),
        request_key: randomUUID(),
      }),
    ).rejects.toThrow("not permitted");
    expect(await repo.list("finance_snapshots")).toEqual([]);
  },
);
it.each([4, 5])(
  "level %i requires import approval and logs success without memory",
  async (level) => {
    await actions.permissions.savePolicy({
      tool: "finance.import",
      level,
      reason: "Test",
    });
    const raw = {
      tool: "finance.import",
      input: statement(),
      request_key: randomUUID(),
    };
    await approve(raw);
    expect(await repo.list("finance_snapshots")).toEqual([]);
    const r = await requests.request(raw);
    await requests.request(raw);
    expect(await repo.list("finance_snapshots")).toHaveLength(1);
    expect((await repo.get("actions", r.action_id))?.metadata.simulated).toBe(
      false,
    );
    expect(await repo.list("outcomes")).not.toEqual([]);
    await expect(requests.remember(r.action_id)).rejects.toThrow(
      "cannot be copied",
    );
  },
);
it("rejection and read denial preserve boundaries", async () => {
  const raw = {
    tool: "finance.import",
    input: statement(),
    request_key: randomUUID(),
  };
  let id = "";
  try {
    await requests.request(raw);
  } catch (e) {
    id = (e as ApprovalRequiredError).actionId;
  }
  await actions.permissions.review(id, "rejected", "Reject source");
  expect(await repo.list("finance_snapshots")).toEqual([]);
  await service.import(statement());
  await actions.permissions.savePolicy({
    tool: "finance.read",
    level: 0,
    reason: "No financial visibility",
  });
  await expect(
    requests.request({ tool: "finance.read", input: {} }),
  ).rejects.toThrow("not permitted");
});
it("project policy cannot be bypassed by omitting outer related entities", async () => {
  const e = await repo.insert("entities", {
    name: "Wag Trails",
    entity_type: "project",
    description: "",
    metadata: {},
  });
  const entry = statement();
  entry.payload.entity_ids = [e.id];
  await service.import(entry);
  await actions.permissions.savePolicy({
    tool: "finance.read",
    product_entity_id: e.id,
    level: 0,
    reason: "Private project",
  });
  await expect(
    requests.request({
      tool: "finance.read",
      input: {},
      related_entity_ids: [],
    }),
  ).rejects.toThrow("not permitted");
});
it("local outcome failure recovers imported source without duplication", async () => {
  const raw = {
    tool: "finance.import",
    input: statement(),
    request_key: randomUUID(),
  };
  await approve(raw);
  vi.spyOn(repo, "batch").mockRejectedValueOnce(
    new Error("Receipt unavailable"),
  );
  await expect(requests.request(raw)).rejects.toThrow("Receipt unavailable");
  expect(await repo.list("finance_snapshots")).toHaveLength(1);
  const retry = { ...raw, request_key: randomUUID() };
  await approve(retry);
  expect((await requests.request(retry)).result.recovered).toBe(true);
  expect(await repo.list("finance_snapshots")).toHaveLength(1);
});
it("write failure leaves no source and logs failure", async () => {
  const raw = {
    tool: "finance.import",
    input: statement(),
    request_key: randomUUID(),
  };
  await approve(raw);
  const insert = repo.insert.bind(repo);
  vi.spyOn(repo, "insert").mockImplementation(async (table, input) => {
    if (table === "finance_snapshots") throw new Error("Database unavailable");
    return insert(table, input) as never;
  });
  await expect(requests.request(raw)).rejects.toThrow("Database unavailable");
  expect(await repo.list("finance_snapshots")).toEqual([]);
  expect((await repo.list("actions")).some((a) => a.status === "failed")).toBe(
    true,
  );
});
it("invalid precision, debt, duplicate transactions and future observations fail", async () => {
  expect(parseMoneyInput("0.29", "USD")).toBe(29);
  expect(parseMoneyInput("-12.01", "USD")).toBe(-1201);
  expect(() => parseMoneyInput("0.001", "USD")).toThrow();
  expect(() => parseMoneyInput("1.1", "JPY")).toThrow();
  const bad = statement();
  bad.payload.account.kind = "credit";
  bad.payload.balance_minor = -10;
  expect(financeImport.safeParse(bad).success).toBe(false);
  const duplicate = statement();
  duplicate.payload.transactions.push(duplicate.payload.transactions[0]);
  expect(financeImport.safeParse(duplicate).success).toBe(false);
  await expect(
    service.import(statement({ observed_at: "2099-01-01T00:00:00Z" })),
  ).rejects.toThrow("Future");
});
it("pending transactions and unknown classifications do not become income/spending", async () => {
  const input = statement();
  input.payload.transactions[0].status = "pending";
  input.payload.transactions[1].kind = "unclassified";
  input.payload.coverage = null;
  await service.import(input);
  const r = await service.report(at);
  expect(r.groups[0]).toMatchObject({
    income_minor: 0,
    spending_minor: 0,
    coverage_complete: false,
  });
  expect(r.accounts[0].unclassified_count).toBe(1);
});
it("Chat returns deterministic evidence links and refuses financial execution", async () => {
  await service.import(statement());
  const c = await repo.insert("conversations", {
    title: "Finance",
    metadata: {},
  });
  const m = await repo.insert("messages", {
    conversation_id: c.id,
    role: "user",
    content: "Why did my balance change?",
    metadata: {},
  });
  const bridge = new FinanceConversationService(repo, actions);
  const reply = await bridge.handle(m.content, m);
  expect(reply?.metadata.finance_accounts).toHaveLength(1);
  expect(reply?.content).toContain("Only one source");
  await repo.insert("messages", {
    conversation_id: c.id,
    role: "assistant",
    content: reply!.content,
    metadata: reply!.metadata,
  });
  expect(
    (await bridge.handle("Why did this change?", m))?.metadata.finance_context,
  ).toBe(true);
  expect((await bridge.handle("Buy portfolio holdings", m))?.content).toContain(
    "cannot move money",
  );
  await actions.permissions.savePolicy({
    tool: "finance.read",
    level: 0,
    reason: "Revoke",
  });
  expect((await bridge.handle("Show balances", m))?.content).toContain(
    "unavailable",
  );
});
it("equivalent PostgreSQL timestamp formatting preserves import idempotency", async () => {
  const input = statement();
  const first = await service.import(input);
  const retry = {
    ...input,
    as_of: "2026-09-07T00:00:00+00:00",
    observed_at: "2026-09-07T00:00:00+00:00",
  };
  expect(await service.import(retry)).toMatchObject({
    snapshot_id: first.snapshot_id,
    recovered: true,
  });
});
it("no financial execution tool is registered", async () => {
  for (const tool of [
    "finance.transfer",
    "finance.trade",
    "finance.pay",
    "kronos.execute",
  ]) {
    await expect(
      requests.request({ tool, input: {}, request_key: randomUUID() }),
    ).rejects.toThrow();
  }
  expect(await repo.list("finance_snapshots")).toEqual([]);
});
it("simultaneous copies cannot insert duplicate source snapshots", async () => {
  const input = statement();
  await Promise.allSettled([service.import(input), service.import(input)]);
  expect(await repo.list("finance_snapshots")).toHaveLength(1);
  expect((await service.import(input)).recovered).toBe(true);
});
it("linked entity reads retain workspace permission context", async () => {
  const e = await repo.insert("entities", {
    name: "Private project",
    entity_type: "project",
    description: "",
    metadata: {},
  });
  const input = statement();
  input.payload.entity_ids = [e.id];
  await service.import(input);
  const scoped = new ActionService(repo, {
    workspace: "ary-nexus",
    productIds: [],
  });
  await scoped.permissions.savePolicy({
    tool: "entity.read",
    workspace: "ary-nexus",
    level: 0,
    reason: "Private entity context",
  });
  await expect(
    new ActionRequestService(repo, scoped).request({
      tool: "finance.read",
      input: {},
    }),
  ).rejects.toThrow("not permitted");
});
it("a corrected source explains its original value without implying money movement", async () => {
  const old = await service.import(statement());
  const corrected = statement({
    parent_id: old.snapshot_id,
    observed_at: "2026-09-07T01:00:00Z",
  });
  corrected.payload.balance_minor = 90000;
  await service.import(corrected);
  const a = (await service.report({ as_of: "2026-09-07T02:00:00Z" }))
    .accounts[0];
  expect(a.change_kind).toBe("correction");
  expect(a.previous?.id).toBe(old.snapshot_id);
  expect(a.explanation).toContain("not evidence of money movement");
});
it("offset report times use the documented UTC reporting month", async () => {
  const entry = statement({
    as_of: "2026-08-31T12:00:00Z",
    observed_at: "2026-08-31T12:00:00Z",
    payload: { ...statement().payload, coverage: null, transactions: [] },
  });
  entry.payload.coverage = null;
  entry.payload.transactions = [
    {
      ...statement().payload.transactions[0],
      at: "2026-08-31T10:00:00Z",
      amount_minor: 100,
    },
  ];
  await service.import(entry);
  const r = await service.report({ as_of: "2026-09-01T01:00:00+12:00" });
  expect(r.groups[0].income_minor).toBe(100);
  expect(r.as_of).toBe("2026-08-31T13:00:00.000Z");
});
