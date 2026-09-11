import { z } from "zod";
import type { RecordBase, Action, Outcome, ModelCall } from "./models";

const amount = z.number().finite().min(0).max(1e12).nullable();
const common = {
  parent_id: z.uuid().nullable(),
  confidence: z.number().min(0).max(1),
  attribution_notes: z.string().trim().min(1).max(4000),
};
export const costEntrySchema = z
  .object({
    ...common,
    action_id: z.uuid(),
    estimated_compute_cost_usd: amount,
    actual_model_cost_usd: amount,
    additional_compute_cost_usd: amount.optional(),
    tool_cost_usd: amount.optional(),
    evidence: z.string().trim().max(2000),
  })
  .strict()
  .refine(
    (v) => v.actual_model_cost_usd === null || v.evidence.length > 0,
    "Reported actual cost needs an evidence reference",
  );
export const outcomeEntrySchema = z
  .object({
    ...common,
    outcome_id: z.uuid(),
    effective_at: z.iso.datetime({ offset: true }),
    time_saved_minutes: amount,
    revenue_influenced_usd: amount,
    expense_avoided_usd: amount,
    status: z.enum(["pending", "estimated", "confirmed", "rejected"]),
    evidence: z.string().trim().max(2000),
  })
  .strict()
  .refine(
    (v) =>
      v.status !== "confirmed" || (v.evidence.length > 0 && v.confidence === 1),
    "Confirmed attribution requires evidence and full attribution confidence; otherwise use estimated",
  );
export interface RoiCostEntry
  extends RecordBase, z.infer<typeof costEntrySchema> {}
export interface RoiOutcomeEntry
  extends RecordBase, z.infer<typeof outcomeEntrySchema> {}
export const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
export function currentEntries<
  T extends { id: string; parent_id: string | null },
>(entries: T[]) {
  const superseded = new Set(entries.map((e) => e.parent_id));
  return entries.filter((e) => !superseded.has(e.id));
}
const total = (values: (number | null)[]) => {
  const known = values.filter((v): v is number => v !== null);
  return known.length ? known.reduce((s, v) => s + v, 0) : null;
};
/** USD only. Null is unknown, including the no-outcome case. Never monetize time implicitly. */
export function calculateRoi(
  month: string,
  actions: Action[],
  outcomes: Outcome[],
  calls: ModelCall[],
  costs: RoiCostEntry[],
  impacts: RoiOutcomeEntry[],
) {
  monthSchema.parse(month);
  const inMonth = (date: string) =>
    new Date(date).toISOString().slice(0, 7) === month;
  const actionMap = new Map(actions.map((a) => [a.id, a]));
  const costMap = new Map(currentEntries(costs).map((c) => [c.action_id, c]));
  const grouped = new Map<string, ModelCall[]>();
  const standalone: ModelCall[] = [];
  for (const call of calls) {
    if (call.action_id && actionMap.has(call.action_id)) {
      const group = grouped.get(call.action_id) ?? [];
      group.push(call);
      grouped.set(call.action_id, group);
    } else if (inMonth(call.created_at)) standalone.push(call);
  }
  const costRows = actions
    .filter((a) => inMonth(a.created_at))
    .map((a) => {
      const record = costMap.get(a.id);
      const metrics = grouped.get(a.id) ?? [];
      const telemetryEstimate = total(metrics.map((m) => m.estimated_cost_usd));
      const actual = record?.actual_model_cost_usd ?? null;
      const estimate = record?.estimated_compute_cost_usd ?? telemetryEstimate;
      const excluded =
        !!record &&
        (actual !== null || record.estimated_compute_cost_usd !== null) &&
        a.metadata?.telemetry_scope !== "action-v1" &&
        standalone.length > 0;
      return {
        excluded,
        action_id: a.id,
        label: a.tool_name,
        at: a.created_at,
        model_amount: actual ?? estimate,
        compute_amount: record?.additional_compute_cost_usd ?? null,
        tool_amount: record?.tool_cost_usd ?? null,
        amount: total([
          actual ?? estimate,
          record?.additional_compute_cost_usd ?? null,
          record?.tool_cost_usd ?? null,
        ]),
        basis:
          actual !== null
            ? "reported_actual"
            : estimate !== null
              ? "estimated"
              : "unknown",
        unknown_calls:
          actual !== null || record?.estimated_compute_cost_usd != null
            ? 0
            : metrics.filter((m) => m.estimated_cost_usd === null).length,
        confidence: record?.confidence ?? null,
        notes: excluded
          ? "Excluded from totals: this legacy action cost may overlap unlinked calls. Original assessment: " +
            record?.attribution_notes
          : (record?.attribution_notes ??
            "Token-priced telemetry where available; no billed amount received."),
        call_count: metrics.length,
      };
    });
  for (const call of standalone)
    costRows.push({
      excluded: false,
      action_id: call.id,
      label: `${call.model} · unlinked call`,
      at: call.created_at,
      model_amount: call.estimated_cost_usd,
      compute_amount: null,
      tool_amount: null,
      amount: call.estimated_cost_usd,
      basis: call.estimated_cost_usd === null ? "unknown" : "estimated",
      unknown_calls: call.estimated_cost_usd === null ? 1 : 0,
      confidence: null,
      notes:
        "Legacy or unscoped telemetry. Counted once; no action attribution inferred.",
      call_count: 1,
    });
  const outcomeMap = new Map(outcomes.map((o) => [o.id, o]));
  const activeImpacts = currentEntries(impacts);
  const assessedOutcomes = new Set(activeImpacts.map((i) => i.outcome_id));
  const impactRows = activeImpacts
    .filter((i) => inMonth(i.effective_at))
    .map((i) => {
      const outcome = outcomeMap.get(i.outcome_id);
      const eligible =
        !!outcome &&
        outcome.status !== "pending" &&
        ["estimated", "confirmed"].includes(i.status);
      return {
        ...i,
        summary: outcome?.summary ?? "Outcome unavailable",
        outcome_status: outcome?.status ?? null,
        action_id: outcome?.action_id ?? null,
        eligible,
        included: eligible && i.status === "confirmed" && i.confidence === 1,
        exclusion: !outcome
          ? "Missing outcome"
          : outcome.status === "pending"
            ? "Outcome still pending"
            : !eligible
              ? `${i.status} attribution`
              : i.status !== "confirmed"
                ? "Uncertain attribution — excluded from confirmed totals"
                : null,
      };
    });
  const confirmed = impactRows.filter((i) => i.included);
  const uncertain = impactRows.filter((i) => i.eligible && !i.included);
  const benefits = (rows: typeof impactRows) => ({
    revenue: total(rows.map((i) => i.revenue_influenced_usd)),
    expenses: total(rows.map((i) => i.expense_avoided_usd)),
    minutes: total(rows.map((i) => i.time_saved_minutes)),
  });
  const impact = benefits(confirmed);
  const unresolvedOverlapRows = costRows.filter((c) => c.excluded).length;
  const includedCosts = costRows.filter((c) => !c.excluded);
  const operatingCost = total(includedCosts.map((c) => c.amount));
  const recordedBenefit = total([impact.revenue, impact.expenses]);
  const unknownModelRows = includedCosts.filter(
    (c) => c.model_amount === null,
  ).length;
  const unknownCalls = includedCosts.reduce((n, c) => n + c.unknown_calls, 0);
  const monthActions = actions.filter((a) => inMonth(a.created_at));
  const roiReady = !unresolvedOverlapRows && !unknownModelRows && !unknownCalls;
  return {
    month,
    actionCount: monthActions.length,
    executedActionCount: monthActions.filter(
      (a) => a.status === "succeeded" && !a.metadata?.replay_of,
    ).length,
    replayCount: monthActions.filter((a) => a.metadata?.replay_of).length,
    modelCost: total(includedCosts.map((c) => c.model_amount)),
    computeCost: total(includedCosts.map((c) => c.compute_amount)),
    toolCost: total(includedCosts.map((c) => c.tool_amount)),
    unknownModelRows,
    attributionQuality: {
      confirmed: confirmed.length,
      uncertain: uncertain.length,
      pending: impactRows.filter((i) => i.status === "pending").length,
      rejected: impactRows.filter((i) => i.status === "rejected").length,
      meanConfidence: impactRows.filter((i) => i.eligible).length
        ? impactRows
            .filter((i) => i.eligible)
            .reduce((n, i) => n + i.confidence, 0) /
          impactRows.filter((i) => i.eligible).length
        : null,
    },
    calculationStatus: roiReady
      ? ("recorded_totals" as const)
      : ("incomplete_costs" as const),
    currency: "USD" as const,
    operatingCost,
    unresolvedOverlapRows,
    reportedActualCost: total(
      includedCosts
        .filter((c) => c.basis === "reported_actual")
        .map((c) => c.model_amount),
    ),
    estimatedCost: total(
      includedCosts
        .filter((c) => c.basis === "estimated")
        .map((c) => c.model_amount),
    ),
    ...impact,
    uncertain: benefits(uncertain),
    netContribution:
      roiReady && operatingCost !== null && recordedBenefit !== null
        ? recordedBenefit - operatingCost
        : null,
    roiMultiple:
      roiReady &&
      operatingCost !== null &&
      operatingCost > 0 &&
      recordedBenefit !== null
        ? recordedBenefit / operatingCost
        : null,
    unknownCostRows: costRows.filter((c) => c.amount === null).length,
    unknownCalls: costRows.reduce((sum, c) => sum + c.unknown_calls, 0),
    unlinkedCalls: standalone.length,
    unassessedOutcomes: outcomes.filter(
      (o) => inMonth(o.created_at) && !assessedOutcomes.has(o.id),
    ).length,
    costRows,
    impactRows,
  };
}
