import type { Repository } from "../domain/repository";
import type { Entity, Goal, Task, Json, RecordBase } from "../domain/models";
import { currentEntries } from "../domain/roi";
import {
  deadlineValue,
  priorityPolicy,
  type PriorityEvidence,
  type PriorityItem,
  type PriorityPath,
  type PriorityReport,
  type PrioritySignal,
  type PriorityFactor,
} from "../domain/priority";
const object = (value: unknown): Json =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : {};
const number = (value: unknown, min: number, max: number): number | null =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= min &&
  value <= max
    ? value
    : null;
const closed = new Set([
  "completed",
  "cancelled",
  "archived",
  "abandoned",
  "resolved",
]);
const evidence = (
  table: string,
  record: RecordBase,
  field: string,
  detail: string,
): PriorityEvidence => ({
  table,
  id: record.id,
  field,
  updated_at: record.updated_at,
  detail,
});
interface Work {
  id: string;
  record: Task | Goal | Entity;
  kind: PriorityItem["kind"];
  title: string;
  status: string;
  entity: string | null;
  project: string | null;
  due: string | null;
}
interface Edge {
  from: string;
  to: string;
  evidence: PriorityEvidence;
}
/** All reads use the existing user-scoped repository. No model calls or business mutations. */
export class PriorityService {
  constructor(private readonly repository: Repository) {}
  async report(now = new Date()): Promise<PriorityReport> {
    const evaluated_at = now.toISOString();
    const [
      allTasks,
      allGoals,
      allEntities,
      allRelationships,
      allOutcomes,
      allImpacts,
    ] = await Promise.all([
      this.repository.list("tasks"),
      this.repository.list("goals"),
      this.repository.list("entities"),
      this.repository.list("relationships"),
      this.repository.list("outcomes"),
      this.repository.list("roi_outcome_entries"),
    ]);
    // Defense in depth for any future repository adapter.
    const own = <T extends RecordBase>(rows: T[]) =>
      rows.filter((r) => r.user_id === this.repository.userId);
    const tasks = own(allTasks),
      goals = own(allGoals),
      entities = own(allEntities),
      relationships = own(allRelationships);
    const entityMap = new Map(entities.map((e) => [e.id, e]));
    const goalsMap = new Map(goals.map((g) => [g.id, g]));
    const work: Work[] = [
      ...tasks.map((t) => ({
        id: `task:${t.id}`,
        record: t,
        kind: "task" as const,
        title: t.title,
        status: t.status,
        entity: t.entity_id,
        project:
          entityMap.get(t.entity_id ?? "")?.entity_type === "project"
            ? t.entity_id
            : null,
        due: t.due_at,
      })),
      ...goals.map((g) => ({
        id: `goal:${g.id}`,
        record: g,
        kind: "goal" as const,
        title: g.title,
        status: g.status,
        entity: g.entity_id,
        project:
          entityMap.get(g.entity_id ?? "")?.entity_type === "project"
            ? g.entity_id
            : null,
        due: g.target_date
          ? /^\d{4}-\d{2}-\d{2}$/.test(g.target_date)
            ? `${g.target_date}T23:59:59.000Z`
            : g.target_date
          : null,
      })),
      ...entities
        .filter((e) => e.entity_type === "project")
        .map((e) => ({
          id: `project:${e.id}`,
          record: e,
          kind: "project" as const,
          title: e.name,
          status:
            typeof e.metadata.status === "string"
              ? e.metadata.status
              : "unassessed",
          entity: e.id,
          project: e.id,
          due: typeof e.metadata.due_at === "string" ? e.metadata.due_at : null,
        })),
    ];
    const excluded = work
      .filter((w) => closed.has(w.status) || w.status === "paused")
      .map((w) => ({
        id: w.id,
        title: w.title,
        reason: `${w.status} work is excluded from active priorities`,
      }));
    const active = work.filter(
      (w) => !closed.has(w.status) && w.status !== "paused",
    );
    const activeKeys = new Set(active.map((w) => w.id));
    const labels = new Map<string, string>(
      entities.map((e) => [`entity:${e.id}`, e.name]),
    );
    work.forEach((w) =>
      labels.set(
        w.kind === "project" ? `entity:${w.record.id}` : w.id,
        w.title,
      ),
    );
    const edges: Edge[] = [];
    const warnings: string[] = [];
    const incomplete = new Set<string>();
    for (const r of relationships) {
      const source = entityMap.get(r.source_entity_id),
        target = entityMap.get(r.target_entity_id);
      if (!source || !target) continue;
      if (
        (r.valid_from && !(Date.parse(r.valid_from) <= now.getTime())) ||
        (r.valid_to && !(Date.parse(r.valid_to) > now.getTime()))
      )
        continue;
      if (!["blocks", "depends_on"].includes(r.relationship_type)) continue;
      const [from, to] =
        r.relationship_type === "blocks" ? [source, target] : [target, source];
      if (
        ["completed", "resolved"].includes(String(from.metadata.status)) ||
        closed.has(String(to.metadata.status)) ||
        to.metadata.status === "paused"
      )
        continue;
      edges.push({
        from: `entity:${from.id}`,
        to: `entity:${to.id}`,
        evidence: evidence(
          "relationships",
          r,
          r.relationship_type,
          `${from.name} → ${to.name}`,
        ),
      });
    }
    const taskMap = new Map(tasks.map((t) => [t.id, t]));
    for (const t of tasks) {
      // Optional references in the existing metadata, never inferred from titles or project membership.
      const ids = t.metadata.depends_on_task_ids;
      if (!Array.isArray(ids) || !activeKeys.has(`task:${t.id}`)) continue;
      for (const id of new Set(ids)) {
        if (typeof id !== "string") continue;
        const dependency = taskMap.get(id);
        if (!dependency) {
          incomplete.add(`task:${t.id}`);
          warnings.push(
            `Task ${t.id} has an unavailable dependency; its readiness needs review.`,
          );
          continue;
        }
        if (dependency.status === "completed") continue;
        if (dependency.status === "cancelled")
          warnings.push(
            `Task ${t.id} depends on cancelled task ${id}; cancellation is not completion.`,
          );
        edges.push({
          from: `task:${id}`,
          to: `task:${t.id}`,
          evidence: evidence(
            "tasks",
            t,
            "metadata.depends_on_task_ids",
            `${dependency.title} → ${t.title}`,
          ),
        });
      }
    }
    const outgoing = new Map<string, Edge[]>(),
      incoming = new Map<string, Edge[]>();
    for (const edge of edges) {
      outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge]);
      incoming.set(edge.to, [...(incoming.get(edge.to) ?? []), edge]);
    }
    function paths(root: string, direction: PriorityPath["direction"]) {
      const result: PriorityPath[] = [];
      const seen = new Set([root]);
      let cycle = false;
      const queue = [
        { node: root, ids: [root], proof: [] as PriorityEvidence[] },
      ];
      for (let i = 0; i < queue.length && result.length < 50; i++) {
        const step = queue[i];
        if (step.proof.length === 2) continue;
        for (const edge of (direction === "unblocks" ? outgoing : incoming).get(
          step.node,
        ) ?? []) {
          if (result.length >= 50) break;
          const id = direction === "unblocks" ? edge.to : edge.from;
          if (step.ids.includes(id)) {
            cycle = true;
            continue;
          }
          if (seen.has(id)) continue;
          seen.add(id);
          const ids = [...step.ids, id],
            proof = [...step.proof, edge.evidence];
          result.push({
            direction,
            nodes: ids.map((key) => ({
              id: key,
              label: labels.get(key) ?? key,
            })),
            evidence: proof,
          });
          queue.push({ node: id, ids, proof });
        }
      }
      return { result, cycle, capped: result.length >= 50 };
    }
    const outcomes = new Map(own(allOutcomes).map((o) => [o.id, o]));
    const impacts = currentEntries(
      own(allImpacts).filter(
        (i) => Date.parse(i.effective_at) <= now.getTime(),
      ),
    ).filter((i) => ["confirmed", "estimated"].includes(i.status));
    const items = active.map((w) => {
      const row = w.record,
        table = w.kind === "project" ? "entities" : `${w.kind}s`;
      const root = w.kind === "project" ? `entity:${row.id}` : w.id;
      const upstream = paths(root, "requires"),
        downstream = paths(root, "unblocks");
      const issues: string[] = [];
      if (incomplete.has(w.id))
        issues.push(
          "A referenced task dependency is unavailable. Resolve the source link before assuming readiness.",
        );
      if (upstream.cycle || downstream.cycle)
        issues.push(
          "Dependency cycle detected in the inspected two-hop neighborhood; resolve before planning execution.",
        );
      if (upstream.capped || downstream.capped)
        issues.push(
          "Dependency explanations limited to 50 reachable records per direction.",
        );
      const linkedGoals =
        w.kind === "goal"
          ? [row as Goal]
          : w.kind === "task"
            ? [goalsMap.get((row as Task).goal_id ?? "")].filter(
                (g): g is Goal => !!g && g.status === "active",
              )
            : goals.filter(
                (g) => g.entity_id === row.id && g.status === "active",
              );
      const signals: PrioritySignal[] = [];
      const add = (
        factor: PriorityFactor,
        label: string,
        value: number | null,
        explanation: string,
        proof: PriorityEvidence[],
        would_change: string,
      ) =>
        signals.push({
          factor,
          label,
          value,
          explanation,
          evidence: proof,
          would_change,
        });
      const due = w.due && Number.isFinite(Date.parse(w.due)) ? w.due : null;
      if (w.due && !due)
        issues.push("Invalid deadline ignored; correct the source date.");
      add(
        "deadline",
        "Deadline",
        deadlineValue(due, evaluated_at),
        due
          ? `Recorded deadline: ${due}. UTC bands: overdue 1; ≤1 day .95; ≤7 days .8; ≤30 days .4; later .1.`
          : "No valid deadline recorded.",
        due
          ? [
              evidence(
                table,
                row,
                w.kind === "task"
                  ? "due_at"
                  : w.kind === "goal"
                    ? "target_date"
                    : "metadata.due_at",
                due,
              ),
            ]
          : [],
        "Changing the deadline or crossing a deadline band changes this contribution.",
      );
      const priority = number(
        w.kind === "task" ? (row as Task).priority : row.metadata.priority,
        0,
        3,
      );
      add(
        "urgency",
        "Urgency",
        priority === null ? null : priority / 3,
        priority === null
          ? "No explicit urgency recorded."
          : `Recorded priority ${priority}/3; urgency is not inferred from wording.`,
        priority === null
          ? []
          : [
              evidence(
                table,
                row,
                w.kind === "task" ? "priority" : "metadata.priority",
                String(priority),
              ),
            ],
        "A reviewed priority change alters urgency points.",
      );
      const assessed = object(row.metadata.priority_intelligence);
      const assessment = (key: string, max: number) => {
        const entry = object(assessed[key]);
        const value = number(entry.value, 0, max);
        const citation =
          typeof entry.evidence === "string" ? entry.evidence.trim() : "";
        if (value === null || !citation) return null;
        return {
          value,
          proof: evidence(
            table,
            row,
            `metadata.priority_intelligence.${key}`,
            citation.slice(0, 2000),
          ),
        };
      };
      const strategy = assessment("strategic_importance", 1),
        effort = assessment("effort_hours", 100000),
        confidence = assessment("confidence", 1),
        revenue = assessment("expected_revenue_usd", 1e12);
      add(
        "strategy",
        "Strategic importance",
        strategy?.value ?? null,
        strategy
          ? `Recorded strategic assessment ${strategy.value}.`
          : "Strategic importance is unassessed.",
        strategy ? [strategy.proof] : [],
        "An evidence-backed strategic assessment changes this factor; no importance is inferred from a project name.",
      );
      add(
        "goals",
        "Active goal alignment",
        linkedGoals.length
          ? Math.min(1, linkedGoals.length / (w.kind === "project" ? 3 : 1))
          : null,
        linkedGoals.length
          ? `${linkedGoals.length} explicitly linked active goal(s). Project contribution saturates at three goals.`
          : "No direct active goal link; shared project membership is not a task-goal link.",
        [
          ...linkedGoals.map((g) =>
            evidence("goals", g, "status/entity_id", g.title),
          ),
          ...(w.kind === "task" && linkedGoals.length
            ? [
                evidence(
                  "tasks",
                  row,
                  "goal_id",
                  `Direct link to goal ${linkedGoals[0].id}`,
                ),
              ]
            : []),
        ],
        "Linking an active goal or completing/pausing a linked goal changes alignment.",
      );
      add(
        "dependencies",
        "Dependency leverage",
        Math.min(1, downstream.result.length / 3),
        `${downstream.result.length} unique dependent(s) within two hops; saturates at three. Missing links are not inferred.`,
        downstream.result.flatMap((p) => p.evidence),
        "Resolving or adding documented dependencies changes how much work this can unblock.",
      );
      add(
        "blockers",
        "Blocker attention",
        Math.min(1, upstream.result.length / 2),
        `${upstream.result.length} prerequisite(s) within two hops. Points mean attention is needed, not that work is ready.`,
        upstream.result.flatMap((p) => p.evidence),
        "Resolving prerequisites removes blocker-attention points and improves readiness.",
      );
      // Revenue is an explicit forward-looking estimate only; no historical impact is transferred.
      const revenueKnown = revenue && confidence;
      add(
        "revenue",
        "Expected revenue",
        revenueKnown
          ? Math.min(1, Math.log10(1 + revenue.value) / 5) * confidence.value
          : null,
        revenueKnown
          ? `Explicit estimate $${revenue.value.toLocaleString("en-US")} USD, discounted by recorded confidence ${confidence.value}. Log scale saturates near $100,000. Not earned revenue.`
          : "Expected revenue unknown. Requires an explicit estimate, evidence and recorded confidence; historical ROI is not a forecast.",
        revenueKnown ? [revenue.proof, confidence.proof] : [],
        "A supported forecast and its confidence can change this factor. Historical revenue alone cannot.",
      );
      add(
        "effort",
        "Effort",
        effort ? 1 / (1 + effort.value / 8) : null,
        effort
          ? `Recorded estimate ${effort.value} hours. Smaller effort earns more points: 1/(1+hours/8).`
          : "Effort unknown; no quick-win benefit assumed.",
        effort ? [effort.proof] : [],
        "A supported effort estimate changes this small tie-influence; unknown effort earns no benefit.",
      );
      add(
        "confidence",
        "Assessment confidence",
        confidence?.value ?? null,
        confidence
          ? `Recorded assessment confidence ${confidence.value}.`
          : "Confidence unknown; this is distinct from evidence coverage.",
        confidence ? [confidence.proof] : [],
        "Reviewing assessment confidence changes these points and any forecast discount.",
      );
      if (
        w.kind === "task" &&
        w.project &&
        (incoming.get(`entity:${w.project}`)?.length ?? 0) > 0
      )
        issues.push(
          "The linked project has recorded blockers. These are context, not proof this task depends on them; no task dependency points were added.",
        );
      const history = impacts.flatMap((i) => {
        const o = outcomes.get(i.outcome_id);
        if (
          !o ||
          o.status === "pending" ||
          !o.goal_id ||
          !linkedGoals.some((g) => g.id === o.goal_id) ||
          i.revenue_influenced_usd === null
        )
          return [];
        return [
          {
            amount: i.revenue_influenced_usd,
            status: i.status,
            confidence: i.confidence,
            evidence: [
              evidence(
                "roi_outcome_entries",
                i,
                "revenue_influenced_usd",
                i.attribution_notes,
              ),
              evidence("outcomes", o, "goal_id", o.summary),
            ],
          },
        ];
      });
      return {
        id: w.id,
        record_id: row.id,
        kind: w.kind,
        title: w.title,
        status: w.status,
        project_id: w.project,
        entity_id: w.entity,
        due_at: due,
        updated_at: row.updated_at,
        signals,
        paths: [...upstream.result, ...downstream.result],
        readiness: incomplete.has(w.id)
          ? "Dependency evidence incomplete"
          : upstream.cycle || downstream.cycle
            ? "Resolve dependency cycle"
            : upstream.result.length
              ? "Resolve prerequisites"
              : w.status === "blocked"
                ? "Recorded blocked status; inspect project"
                : "No recorded prerequisites — verify readiness",
        warnings: issues,
        historical_revenue: history,
      };
    });
    return {
      version: priorityPolicy.version,
      evaluated_at,
      items,
      excluded,
      warnings: [...new Set(warnings)],
    };
  }
}
