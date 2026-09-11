import { ActionService } from "./action-service";
import { isDeepStrictEqual } from "node:util";
import type { Repository } from "../domain/repository";
import {
  financeImport,
  financeQuery,
  validateFinanceSnapshot,
  isDebt,
  money,
  type FinanceSnapshot,
} from "../domain/finance";
import { AppError, required } from "../domain/validation";
import type { z } from "zod";
/** Statement adapter boundary. It accepts source records only and exposes no financial execution methods. */
export interface FinanceImportProvider {
  parse(raw: unknown): z.infer<typeof financeImport>;
}
export class StatementFinanceProvider implements FinanceImportProvider {
  parse(raw: unknown) {
    return financeImport.parse(raw);
  }
}
export class FinanceService {
  constructor(
    private repo: Repository,
    private importer: FinanceImportProvider = new StatementFinanceProvider(),
    private actions: ActionService = new ActionService(repo),
  ) {}
  async import(raw: unknown) {
    const entry = this.importer.parse(raw);
    if (Date.parse(entry.observed_at) > Date.now())
      throw new AppError("Future observations cannot be imported");
    const rows = await this.repo.list("finance_snapshots");
    const previous = rows.find((r) => r.import_key === entry.import_key);
    if (previous) {
      const { id, user_id, created_at, updated_at, ...data } = previous;
      if (!isDeepStrictEqual(normalizeDates(data), normalizeDates(entry)))
        throw new AppError(
          "Import key belongs to different statement data",
          409,
        );
      return { snapshot_id: id, recovered: true };
    }
    validateFinanceSnapshot(entry, rows);
    for (const id of financialLinks(entry).entityIds)
      required(await this.repo.get("entities", id), "Linked financial entity");
    for (const id of financialLinks(entry).goalIds)
      required(await this.repo.get("goals", id), "Linked financial goal");
    const saved = await this.repo.insert("finance_snapshots", entry);
    return {
      snapshot_id: saved.id,
      account_key: saved.account_key,
      recovered: false,
    };
  }
  async report(raw: unknown = {}) {
    const query = financeQuery.parse(raw),
      cutoff = new Date(query.as_of ?? Date.now()).toISOString();
    if (Date.parse(cutoff) > Date.now())
      throw new AppError("Finance reports cannot project future balances");
    const rows = (await this.repo.list("finance_snapshots")).filter(
      (r) =>
        (!query.account_key || r.account_key === query.account_key) &&
        Date.parse(r.as_of) <= Date.parse(cutoff) &&
        Date.parse(r.observed_at) <= Date.parse(cutoff),
    );
    for (const row of rows) financeImport.parse(rowInput(row));
    const current = rows.filter((r) => !rows.some((n) => n.parent_id === r.id));
    const keys = [...new Set(current.map((r) => r.account_key))];
    if (keys.length > 1000)
      throw new AppError("Select one account to narrow this report", 413);
    const accounts = await Promise.all(
      keys.map(async (key) => {
        const ordered = current
          .filter((r) => r.account_key === key)
          .sort((a, b) => Date.parse(b.as_of) - Date.parse(a.as_of));
        const latest = ordered[0],
          previous =
            (latest.parent_id
              ? rows.find((r) => r.id === latest.parent_id)
              : ordered[1]) ?? null,
          p = latest.payload,
          currency = p.account.currency;
        const delta =
          previous &&
          p.balance_minor !== null &&
          previous.payload.balance_minor !== null
            ? p.balance_minor - previous.payload.balance_minor
            : null;
        const monthStart = cutoff.slice(0, 7) + "-01T00:00:00.000Z";
        const transactions = p.transactions.filter(
          (t) =>
            t.status === "posted" &&
            Date.parse(t.at) >= Date.parse(monthStart) &&
            Date.parse(t.at) <= Date.parse(cutoff),
        );
        const sum = (kind: string) =>
          transactions
            .filter((t) => t.kind === kind)
            .reduce((s, t) => s + t.amount_minor, 0);
        const complete =
          !!p.coverage?.complete &&
          Date.parse(p.coverage.start) <= Date.parse(monthStart) &&
          Date.parse(p.coverage.end) >= Date.parse(cutoff);
        const links = financialLinks(latest);
        const [entities, goals] = await Promise.all([
          links.entityIds.length
            ? this.actions.run(
                "entity.read",
                null,
                () =>
                  Promise.all(
                    links.entityIds.map((id) => this.repo.get("entities", id)),
                  ),
                { entity_ids: links.entityIds },
                { productIds: links.entityIds },
              )
            : [],
          links.goalIds.length
            ? this.actions.run(
                "activity.read",
                null,
                () =>
                  Promise.all(
                    links.goalIds.map((id) => this.repo.get("goals", id)),
                  ),
                { goal_ids: links.goalIds },
                { productIds: links.entityIds },
              )
            : [],
        ]);
        return {
          key,
          latest,
          previous,
          delta_minor: delta,
          change_kind: latest.parent_id
            ? "correction"
            : previous
              ? "snapshot"
              : "unavailable",
          explanation: previous
            ? `${latest.parent_id ? "Source correction for the same balance date; this is not evidence of money movement. " : ""}Reported balance: ${money(previous.payload.balance_minor, currency)} (${previous.as_of}) → ${money(p.balance_minor, currency)} (${latest.as_of}). ${delta === null ? "A missing balance prevents comparison." : `Reported change: ${money(delta, currency)}.`} These statements establish the change; transaction causes and market returns have not been inferred.`
            : "Only one source snapshot is available; a change cannot yet be established.",
          spending_minor:
            transactions.length || complete
              ? sum("expense") - sum("refund")
              : null,
          income_minor: transactions.length || complete ? sum("income") : null,
          coverage_complete: complete,
          transactions,
          unclassified_count: transactions.filter(
            (t) => t.kind === "unclassified",
          ).length,
          entities: entities.flatMap((e) =>
            e ? [{ id: e.id, name: e.name, type: e.entity_type }] : [],
          ),
          goals: goals.flatMap((g) =>
            g ? [{ id: g.id, title: g.title, entity_id: g.entity_id }] : [],
          ),
          timeline: ordered
            .slice(0, 24)
            .reverse()
            .map((r) => ({
              id: r.id,
              as_of: r.as_of,
              balance_minor: r.payload.balance_minor,
              source_label: r.source_label,
            })),
          history: rows
            .filter((r) => r.account_key === key)
            .map((r) => ({
              id: r.id,
              parent_id: r.parent_id,
              as_of: r.as_of,
              observed_at: r.observed_at,
              source_label: r.source_label,
              superseded: rows.some((n) => n.parent_id === r.id),
            })),
        };
      }),
    );
    const groups = [
      ...new Set(accounts.map((a) => a.latest.payload.account.currency)),
    ].map((currency) => {
      const group = accounts.filter(
          (a) => a.latest.payload.account.currency === currency,
        ),
        known = group.filter((a) => a.latest.payload.balance_minor !== null);
      const amount = (list: typeof group) =>
        list.reduce((s, a) => s + (a.latest.payload.balance_minor ?? 0), 0);
      const assets = amount(
          known.filter((a) => !isDebt(a.latest.payload.account.kind)),
        ),
        debt = amount(
          known.filter((a) => isDebt(a.latest.payload.account.kind)),
        );
      const total = (field: "spending_minor" | "income_minor") =>
        group.some((a) => a[field] !== null)
          ? group.reduce((s, a) => s + (a[field] ?? 0), 0)
          : null;
      return {
        currency,
        assets_minor: known.length ? assets : null,
        debt_minor: known.length ? debt : null,
        net_worth_minor: known.length === group.length ? assets - debt : null,
        portfolio_minor: known.some(
          (a) => a.latest.payload.account.kind === "investment",
        )
          ? amount(
              known.filter(
                (a) => a.latest.payload.account.kind === "investment",
              ),
            )
          : null,
        spending_minor: total("spending_minor"),
        income_minor: total("income_minor"),
        missing_balances: group.length - known.length,
        coverage_complete: group.every((a) => a.coverage_complete),
      };
    });
    for (const g of groups)
      for (const v of Object.values(g))
        if (typeof v === "number" && !Number.isSafeInteger(v))
          throw new AppError("Financial total exceeds exact numeric range");
    return {
      as_of: cutoff,
      groups,
      accounts,
      scope:
        "Recorded accounts only; no claim that all assets or liabilities are represented. Currencies are never converted or mixed.",
      empty: accounts.length === 0,
    };
  }
}
export function rowInput(r: FinanceSnapshot) {
  const { id, user_id, created_at, updated_at, ...data } = r;
  return data;
}
export function financialLinks(entry: z.infer<typeof financeImport>) {
  return {
    entityIds: [
      ...new Set([
        ...entry.payload.entity_ids,
        ...entry.payload.transactions.flatMap((t) =>
          t.entity_id ? [t.entity_id] : [],
        ),
      ]),
    ],
    goalIds: [
      ...new Set([
        ...entry.payload.goal_ids,
        ...entry.payload.transactions.flatMap((t) =>
          t.goal_id ? [t.goal_id] : [],
        ),
      ]),
    ],
  };
}

function normalizeDates<T extends { as_of: string; observed_at: string }>(
  v: T,
) {
  return {
    ...v,
    as_of: new Date(v.as_of).toISOString(),
    observed_at: new Date(v.observed_at).toISOString(),
  };
}
