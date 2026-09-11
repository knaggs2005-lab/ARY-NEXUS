import type { Repository } from "../domain/repository";
import type { ActionService } from "./action-service";
import type { Message, Json } from "../domain/models";
import { ActionRequestService } from "./action-request-service";
import type { FinanceService } from "./finance-service";
import { money } from "../domain/finance";
import { AppError } from "../domain/validation";
export class FinanceConversationService {
  constructor(
    private repo: Repository,
    private actions: ActionService,
  ) {}
  async handle(
    text: string,
    source: Message,
  ): Promise<{ content: string; metadata: Json } | null> {
    const financial =
      /\b(finance|financial|balances?|spending|net worth|portfolio|holdings|debt|income|recurring bills)\b/i.test(
        text,
      );
    let account_key: string | undefined;
    if (!financial) {
      if (!/^why did (this|that|it) change\??$/i.test(text.trim())) return null;
      const history = await this.repo.list("messages", {
        conversation_id: source.conversation_id,
      });
      const latest = history
        .filter((m) => m.role === "assistant")
        .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
      if (!latest?.metadata.finance_context) return null;
      account_key =
        typeof latest.metadata.finance_account_key === "string"
          ? latest.metadata.finance_account_key
          : undefined;
    }
    if (/\b(trade|buy|sell|transfer|pay|invest for me)\b/i.test(text))
      return {
        content:
          "Finance v1 provides recorded account visibility and source explanations. It cannot move money, pay bills or execute trades.",
        metadata: { finance_context: true },
      };
    try {
      const result = await new ActionRequestService(
        this.repo,
        this.actions,
      ).request({
        tool: "finance.read",
        input: { ...(account_key ? { account_key } : {}) },
        request_key: `finance-chat:${source.id}`,
        conversation_id: source.conversation_id,
        source_message_id: source.id,
        reason: text.slice(0, 1000),
      });
      const report = result.result as unknown as Awaited<
        ReturnType<FinanceService["report"]>
      >;
      const matched = report.accounts.filter((a) =>
        text
          .toLowerCase()
          .includes(a.latest.payload.account.name.toLowerCase()),
      );
      const accounts = matched.length ? matched : report.accounts;
      return {
        content: report.empty
          ? "No financial statements are recorded yet. Open Finance to import a reviewed source; I cannot establish balances or changes without it."
          : `${report.scope}\n${report.groups.map((g) => `${g.currency}: recorded net worth ${money(g.net_worth_minor, g.currency)}; debt ${money(g.debt_minor, g.currency)}; month-to-date recorded net spending ${money(g.spending_minor, g.currency)}${g.coverage_complete ? "" : " (partial coverage)"}.`).join("\n")}\n${accounts
              .slice(0, 6)
              .map((a) => `${a.latest.payload.account.name}: ${a.explanation}`)
              .join(
                "\n",
              )}\nOpen the supporting account below to inspect sources, transactions, holdings and links.`,
        metadata: {
          finance_context: true,
          finance_account_key: accounts.length === 1 ? accounts[0].key : null,
          finance_accounts: accounts
            .slice(0, 20)
            .map((a) => ({ key: a.key, name: a.latest.payload.account.name })),
          financial_as_of: report.as_of,
        },
      };
    } catch (e) {
      if (e instanceof AppError || e instanceof Error)
        return {
          content: `Finance evidence is unavailable: ${e.message}. No financial values were inferred.`,
          metadata: { finance_context: true },
        };
      throw e;
    }
  }
}
