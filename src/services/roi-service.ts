import type { Repository } from "../domain/repository";
import {
  calculateRoi,
  costEntrySchema,
  outcomeEntrySchema,
} from "../domain/roi";
import { AppError, required } from "../domain/validation";

export class RoiService {
  constructor(private repository: Repository) {}
  async recordCost(input: unknown) {
    const entry = costEntrySchema.parse(input);
    required(await this.repository.get("actions", entry.action_id), "Action");
    return this.repository.insert("roi_cost_entries", entry);
  }
  async recordOutcome(input: unknown) {
    const entry = outcomeEntrySchema.parse(input);
    const outcome = required(
      await this.repository.get("outcomes", entry.outcome_id),
      "Outcome",
    );
    if (entry.status === "confirmed" && outcome.status === "pending")
      throw new AppError("Pending outcomes cannot have confirmed impact");
    return this.repository.insert("roi_outcome_entries", entry);
  }
  async report(month: string) {
    const [actions, outcomes, calls, costs, impacts] = await Promise.all([
      this.repository.list("actions"),
      this.repository.list("outcomes"),
      this.repository.list("model_calls"),
      this.repository.list("roi_cost_entries"),
      this.repository.list("roi_outcome_entries"),
    ]);
    const report = calculateRoi(
      month,
      actions,
      outcomes,
      calls,
      costs,
      impacts,
    );
    const [year, monthNumber] = month.split("-").map(Number);
    // Keep the existing four-digit year contract even at its lower boundary.
    const trendCount = Math.min(6, year * 12 + monthNumber);
    const trends = Array.from({ length: trendCount }, (_, index) => {
      const date = new Date(0);
      date.setUTCFullYear(year, monthNumber - 1 - (trendCount - 1 - index), 1);
      const key = date.toISOString().slice(0, 7);
      const row = calculateRoi(key, actions, outcomes, calls, costs, impacts);
      return {
        month: key,
        operatingCost: row.operatingCost,
        revenue: row.revenue,
        expenses: row.expenses,
        minutes: row.minutes,
        netContribution: row.netContribution,
        roiMultiple: row.roiMultiple,
        actionCount: row.actionCount,
        calculationStatus: row.calculationStatus,
      };
    });
    return {
      ...report,
      trends,
      actions: actions.map((a) => ({
        id: a.id,
        label: a.tool_name,
        created_at: a.created_at,
        status: a.status,
      })),
      outcomes: outcomes.map((o) => ({
        id: o.id,
        action_id: o.action_id,
        summary: o.summary,
        status: o.status,
      })),
      costHistory: costs,
      outcomeHistory: impacts,
    };
  }
}
