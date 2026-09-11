import { z } from "zod";
import type { RecordBase } from "./models";
export const currencies = {
  USD: 2,
  EUR: 2,
  GBP: 2,
  CAD: 2,
  AUD: 2,
  CHF: 2,
  JPY: 0,
} as const;
const text = z.string().trim().min(1).max(300),
  date = z.iso.datetime({ offset: true });
const minor = z.number().int().min(-1e12).max(1e12);
const positive = minor.refine(
  (v) => v >= 0,
  "Use a nonnegative minor-unit amount",
);
export const financePayload = z
  .object({
    account: z
      .object({
        name: text,
        institution: text,
        kind: z.enum([
          "cash",
          "investment",
          "asset",
          "credit",
          "loan",
          "liability",
        ]),
        currency: z.enum(["USD", "EUR", "GBP", "CAD", "AUD", "CHF", "JPY"]),
      })
      .strict(),
    balance_minor: minor.nullable(),
    coverage: z
      .object({ start: date, end: date, complete: z.boolean() })
      .strict()
      .nullable(),
    transactions: z
      .array(
        z
          .object({
            source_id: text,
            at: date,
            description: text,
            kind: z.enum([
              "income",
              "expense",
              "refund",
              "transfer",
              "adjustment",
              "unclassified",
            ]),
            amount_minor: positive,
            status: z.enum(["posted", "pending"]),
            entity_id: z.uuid().nullable(),
            goal_id: z.uuid().nullable(),
          })
          .strict(),
      )
      .max(200),
    bills: z
      .array(
        z
          .object({
            source_id: text,
            name: text,
            amount_minor: positive,
            next_due: date,
            frequency: z.enum([
              "weekly",
              "monthly",
              "quarterly",
              "annual",
              "other",
            ]),
          })
          .strict(),
      )
      .max(50),
    holdings: z
      .array(
        z
          .object({
            source_id: text,
            name: text,
            symbol: z.string().max(40),
            quantity: z.string().regex(/^\d{1,16}(\.\d{1,12})?$/),
            value_minor: positive.nullable(),
          })
          .strict(),
      )
      .max(100),
    holdings_complete: z.boolean(),
    entity_ids: z.array(z.uuid()).max(20),
    goal_ids: z.array(z.uuid()).max(20),
  })
  .strict();
export const financeImport = z
  .object({
    import_key: z.string().trim().min(1).max(120),
    account_key: z.string().trim().min(1).max(120),
    parent_id: z.uuid().nullable(),
    as_of: date,
    observed_at: date,
    source_label: text,
    source_reference: z.string().trim().min(1).max(1000),
    payload: financePayload,
  })
  .strict()
  .superRefine((v, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: "custom", message });
    if (Date.parse(v.as_of) > Date.parse(v.observed_at))
      fail("Source observation cannot precede its balance date");
    if (v.payload.coverage) {
      const c = v.payload.coverage;
      if (
        Date.parse(c.start) > Date.parse(c.end) ||
        Date.parse(c.end) > Date.parse(v.as_of)
      )
        fail("Coverage must end on or before the snapshot date");
    }
    if (
      ["credit", "loan", "liability"].includes(v.payload.account.kind) &&
      (v.payload.balance_minor ?? 0) < 0
    )
      fail("Debt balances are positive amounts owed");
    for (const rows of [
      v.payload.transactions,
      v.payload.bills,
      v.payload.holdings,
    ])
      if (new Set(rows.map((x) => x.source_id)).size !== rows.length)
        fail("Duplicate source record ID");
    if (
      v.payload.transactions.some((t) => Date.parse(t.at) > Date.parse(v.as_of))
    )
      fail("Transactions cannot post after the snapshot date");
  });
export interface FinanceSnapshot
  extends RecordBase, z.infer<typeof financeImport> {}
export const financeQuery = z
  .object({
    as_of: date.optional(),
    account_key: z.string().min(1).max(120).optional(),
  })
  .strict();
export const isDebt = (kind: string) =>
  ["credit", "loan", "liability"].includes(kind);
export function money(value: number | null, currency: keyof typeof currencies) {
  return value === null
    ? "Unknown"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency,
        minimumFractionDigits: currencies[currency],
        maximumFractionDigits: currencies[currency],
      }).format(value / 10 ** currencies[currency]);
}
/** Shared append-only invariant validation for service and local repository. Database mirrors identity/revision constraints. */
export function validateFinanceSnapshot(
  value: unknown,
  existing: FinanceSnapshot[],
) {
  const entry = financeImport.parse(value),
    same = existing.filter((r) => r.account_key === entry.account_key);
  if (existing.some((r) => r.import_key === entry.import_key))
    throw new Error("Import key already exists");
  if (
    same.some(
      (r) =>
        r.payload.account.currency !== entry.payload.account.currency ||
        r.payload.account.kind !== entry.payload.account.kind,
    )
  )
    throw new Error(
      "Account currency and type are stable; use the original account identity",
    );
  if (entry.parent_id) {
    const parent = same.find((r) => r.id === entry.parent_id);
    if (
      !parent ||
      Date.parse(parent.as_of) !== Date.parse(entry.as_of) ||
      Date.parse(parent.observed_at) > Date.parse(entry.observed_at)
    )
      throw new Error(
        "Correction must refer to the same account/date and a later observation",
      );
    if (same.some((r) => r.parent_id === entry.parent_id))
      throw new Error("Snapshot already superseded");
  } else if (
    same.some(
      (r) => !r.parent_id && Date.parse(r.as_of) === Date.parse(entry.as_of),
    )
  )
    throw new Error(
      "This date already has a snapshot; append an explicit correction",
    );
  return entry;
}

/** Parse display money without binary floating-point multiplication. */
export function parseMoneyInput(
  raw: string,
  currency: keyof typeof currencies,
): number | null {
  const text = raw.trim();
  if (!text) return null;
  const digits = currencies[currency];
  if (
    !new RegExp(`^-?\\d+(?:\\.\\d{1,${Math.max(1, digits)}})?$`).test(text) ||
    (!digits && text.includes("."))
  )
    throw new Error("Invalid currency precision");
  const negative = text.startsWith("-"),
    [whole, fraction = ""] = text.replace("-", "").split(".");
  const amount =
    Number(whole) * 10 ** digits + Number(fraction.padEnd(digits, "0"));
  if (!Number.isSafeInteger(amount) || amount > 1e12)
    throw new Error("Amount outside supported range");
  return negative ? -amount : amount;
}
