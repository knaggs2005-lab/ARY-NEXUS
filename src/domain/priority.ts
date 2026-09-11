/** Priority is a read model over canonical work, never a second task/project store. */
export const priorityPolicy = {
  version: "priority-v1",
  weights: {
    deadline: 20,
    urgency: 15,
    strategy: 15,
    goals: 15,
    dependencies: 10,
    blockers: 5,
    revenue: 10,
    effort: 5,
    confidence: 5,
  },
} as const;
export type PriorityFactor = keyof typeof priorityPolicy.weights;
export interface PriorityEvidence {
  table: string;
  id: string;
  field: string;
  updated_at: string;
  detail: string;
}
export interface PrioritySignal {
  factor: PriorityFactor;
  label: string;
  value: number | null;
  explanation: string;
  evidence: PriorityEvidence[];
  would_change: string;
}
export interface PriorityPath {
  nodes: { id: string; label: string }[];
  evidence: PriorityEvidence[];
  direction: "requires" | "unblocks";
}
export interface PriorityItem {
  id: string;
  record_id: string;
  kind: "task" | "project" | "goal";
  title: string;
  status: string;
  project_id: string | null;
  entity_id: string | null;
  due_at: string | null;
  updated_at: string;
  signals: PrioritySignal[];
  paths: PriorityPath[];
  readiness: string;
  warnings: string[];
  historical_revenue: {
    amount: number;
    status: string;
    confidence: number;
    evidence: PriorityEvidence[];
  }[];
}
export interface PriorityReport {
  version: string;
  evaluated_at: string;
  items: PriorityItem[];
  excluded: { id: string; title: string; reason: string }[];
  warnings: string[];
}
export function deadlineValue(due: string | null, at: string): number | null {
  if (!due || !Number.isFinite(Date.parse(due))) return null;
  const days = (Date.parse(due) - Date.parse(at)) / 86400000;
  return days <= 0
    ? 1
    : days <= 1
      ? 0.95
      : days <= 7
        ? 0.8
        : days <= 30
          ? 0.4
          : 0.1;
}
export type PriorityWeights = Record<PriorityFactor, number>;
export function rankPriorities(
  report: PriorityReport,
  weights: PriorityWeights = priorityPolicy.weights,
  at = report.evaluated_at,
) {
  // Callers may change policy emphasis, never introduce undocumented business impact.
  if (!Number.isFinite(Date.parse(at)))
    throw new Error("Invalid evaluation time");
  const keys = Object.keys(priorityPolicy.weights) as PriorityFactor[];
  if (
    keys.some(
      (k) => !Number.isFinite(weights[k]) || weights[k] < 0 || weights[k] > 100,
    )
  )
    throw new Error("Invalid priority weights");
  const maximum = keys.reduce((sum, k) => sum + weights[k], 0);
  if (!maximum) throw new Error("At least one factor must have weight");
  const rows = report.items
    .map((item) => {
      const factors = item.signals.map((signal) => {
        const value =
          signal.factor === "deadline"
            ? deadlineValue(item.due_at, at)
            : signal.value;
        return {
          ...signal,
          value,
          points: ((value ?? 0) * weights[signal.factor] * 100) / maximum,
          available:
            ((1 - (value ?? 0)) * weights[signal.factor] * 100) / maximum,
        };
      });
      const score = factors.reduce((n, f) => n + f.points, 0);
      const coverage =
        factors.reduce(
          (n, f) => n + (f.value === null ? 0 : weights[f.factor]),
          0,
        ) / maximum;
      return { ...item, factors, score, coverage, rank: 0 };
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        (a.due_at ?? "9999").localeCompare(b.due_at ?? "9999") ||
        a.id.localeCompare(b.id),
    );
  return rows.map((row, index) => ({ ...row, rank: index + 1 }));
}
export type RankedPriority = ReturnType<typeof rankPriorities>[number];
