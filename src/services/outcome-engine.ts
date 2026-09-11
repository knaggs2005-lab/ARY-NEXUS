import type { Repository, Mutation } from "../domain/repository";
import type { Outcome, Action, Json } from "../domain/models";
import type { ToolExecutionContext } from "../domain/tool-registry";
import type { ExecutionPlan } from "../domain/orchestration";
import type { SkillRecord } from "../domain/skills";
import { actionBelongsToMission } from "../domain/mission-control";
import { calculateRoi } from "../domain/roi";
import {
  assessmentInput,
  LEARNING,
  emptyLearning,
  type OutcomeLearning,
  type Recommendation,
  type Evidence,
} from "../domain/outcome-engine";
import { AppError, required } from "../domain/validation";
import { digest } from "./permission-service";

/** Projection and reviewed learning over canonical outcomes. Never changes prompts or workflows. */
export class OutcomeEngine {
  constructor(private repo: Repository) {}
  learning(o: Outcome): OutcomeLearning {
    return structuredClone(
      (o.metadata[LEARNING] as unknown as OutcomeLearning) ?? emptyLearning(),
    );
  }
  private snapshot(o: Outcome, assessment = true): Json {
    const { [LEARNING]: _, ...metadata } = o.metadata;
    return {
      id: o.id,
      action_id: o.action_id,
      goal_id: o.goal_id,
      status: o.status,
      summary: o.summary,
      metrics: o.metrics,
      metadata,
      assessment: assessment
        ? (this.learning(o).assessments.at(-1) ?? null)
        : null,
    };
  }
  private receipt(o: Outcome, a: Action): Json {
    return { outcome: this.snapshot(o), action: JSON.parse(JSON.stringify(a)) };
  }
  private stage(
    o: Outcome,
    data: OutcomeLearning,
    c: ToolExecutionContext,
    checks: Mutation[] = [],
  ) {
    if (!c.stage || !c.actionId)
      throw new AppError("Outcome changes require the action pipeline", 403);
    c.stage([
      ...checks,
      {
        kind: "update",
        table: "outcomes",
        id: o.id,
        expected_updated_at: o.updated_at,
        data: { metadata: { ...o.metadata, [LEARNING]: data } },
      },
    ]);
  }
  async assess(raw: unknown, c: ToolExecutionContext) {
    const input = assessmentInput.parse(raw);
    const o = required(
      await this.repo.get("outcomes", input.outcome_id),
      "Outcome",
    );
    const data = this.learning(o);
    if (data.revision !== input.revision)
      throw new AppError("Outcome changed; review the latest revision", 409);
    if (data.assessments.length >= 100)
      throw new AppError("Assessment history limit reached", 409);
    const evidence: Evidence[] = [],
      checks: Mutation[] = [];
    for (const ref of input.evidence) {
      const row = required(await this.repo.get(ref.table, ref.id), "Evidence");
      const snapshot =
        ref.table === "outcomes"
          ? this.snapshot(row as Outcome, false)
          : (JSON.parse(JSON.stringify(row)) as Json);
      evidence.push({ ...ref, snapshot, hash: digest(snapshot) });
      if (!(ref.table === "outcomes" && ref.id === o.id))
        checks.push({
          kind: "check",
          table: ref.table,
          id: ref.id,
          expected_updated_at: row.updated_at,
        });
    }
    for (const link of input.links) {
      const artifact = ["skill", "agent"].includes(link.kind);
      const row = required(
        await this.repo.get(artifact ? "messages" : "entities", link.id),
        "Linked record",
      );
      if (link.kind === "skill") {
        const skill = row.metadata.nexus_skill_v1 as unknown as
          SkillRecord | undefined;
        if (
          !link.version ||
          !skill?.versions.some((v) => v.version === link.version)
        )
          throw new AppError("Select an existing Skill version");
      } else if (link.kind === "agent") {
        if (row.metadata.agent_version !== "agent-v1")
          throw new AppError("Not an agent record");
      } else if (link.kind === "strategy") {
        if (row.metadata.entity_facet !== "strategy")
          throw new AppError(
            "Strategy must be an existing entity marked entity_facet=strategy",
          );
      } else if (!("entity_type" in row) || row.entity_type !== link.kind)
        throw new AppError("Entity type does not match link");
      checks.push({
        kind: "check",
        table: artifact ? "messages" : "entities",
        id: row.id,
        expected_updated_at: row.updated_at,
      });
    }
    const { outcome_id: _, revision: __, ...values } = input;
    data.revision++;
    data.assessments.push({
      ...values,
      revision: data.revision,
      evidence,
      action_id: c.actionId!,
      at: new Date().toISOString(),
      actor: c.userId,
    });
    this.stage(o, data, c, checks);
    return {
      outcome_id: o.id,
      revision: data.revision,
      assessment: data.assessments.at(-1)!,
    };
  }
  async report(includeCosts = false) {
    const [outcomes, actions, messages, entities, goals, tasks] =
      await Promise.all([
        this.repo.list("outcomes"),
        this.repo.list("actions"),
        this.repo.list("messages"),
        this.repo.list("entities"),
        this.repo.list("goals"),
        this.repo.list("tasks"),
      ]);
    const plans = messages
      .filter(
        (m) =>
          m.metadata.orchestrator_version === "orchestrator-v1" &&
          m.metadata.plan,
      )
      .map((m) => m.metadata.plan as unknown as ExecutionPlan);
    let costs: ReturnType<typeof calculateRoi>["costRows"] = [];
    if (includeCosts) {
      const [calls, ledger] = await Promise.all([
        this.repo.list("model_calls"),
        this.repo.list("roi_cost_entries"),
      ]);
      costs = [
        ...new Set(actions.map((a) => a.created_at.slice(0, 7))),
      ].flatMap(
        (month) => calculateRoi(month, actions, [], calls, ledger, []).costRows,
      );
    }
    const actionMap = new Map(actions.map((a) => [a.id, a]));
    // Outcome Engine's own audits remain in Action History, but cannot recursively train itself.
    const rows = outcomes
      .filter((o) => {
        const a = actionMap.get(o.action_id);
        return (
          a &&
          !a.tool_name.startsWith("outcome.") &&
          !a.tool_name.endsWith(".read") &&
          !a.metadata.replay_of
        );
      })
      .map((o) => {
        const a = actionMap.get(o.action_id)!;
        const plan = plans.find((p) => actionBelongsToMission(a, p));
        const learning = this.learning(o),
          assessment = learning.assessments.at(-1) ?? null;
        const cost = costs.find((c) => c.action_id === a.id) ?? null;
        const elapsed = Date.parse(o.created_at) - Date.parse(a.created_at);
        const skillLinks = plan
          ? actions
              .filter(
                (x) =>
                  x.tool_name === "skill.launch" &&
                  (x.output.result as Json | undefined)?.mission_id === plan.id,
              )
              .map((x) => ({
                kind: "skill",
                id: String(x.input.id),
                version: Number(x.input.version),
              }))
          : [];
        const ids = new Set([
          ...(plan?.entity_ids ?? []),
          ...(a.product_entity_ids ?? []),
          ...((a.metadata.related_entity_ids as string[] | undefined) ?? []),
        ]);
        const links = [
          ...(assessment?.links ?? []),
          ...skillLinks,
          ...entities
            .filter((e) => ids.has(e.id))
            .map((e) => ({ kind: e.entity_type, id: e.id })),
        ].map((l) => ({
          ...l,
          label:
            entities.find((e) => e.id === l.id)?.name ??
            messages.find((m) => m.id === l.id)?.content ??
            l.id,
        }));
        return {
          outcome: o,
          action: a,
          goal: goals.find((g) => g.id === o.goal_id) ?? null,
          plan: plan
            ? {
                id: plan.id,
                goal: plan.goal,
                title: plan.spec.title,
                state: plan.mission?.state ?? plan.status,
                steps: plan.spec.steps,
              }
            : null,
          agents: [
            ...new Set([
              String(
                a.metadata.agent_id ?? a.metadata.requesting_agent ?? "unknown",
              ),
              ...(plan?.mission?.agent_id ? [plan.mission.agent_id] : []),
            ]),
          ],
          tool: a.tool_name,
          result: a.output,
          assessment,
          learning,
          links,
          duration_ms:
            Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : null,
          duration_basis:
            "Action record to outcome record; includes persistence, not a model latency benchmark",
          cost: cost && !cost.excluded ? cost : null,
          run: plan
            ? `mission:${plan.id}`
            : a.conversation_id
              ? `conversation:${a.conversation_id}`
              : `action:${String(a.metadata.execution_key ?? a.id)}`,
          hash: digest(this.receipt(o, a)),
          snapshot: this.receipt(o, a),
        };
      })
      .sort((a, b) => b.outcome.created_at.localeCompare(a.outcome.created_at));
    const hashes = new Map(rows.map((r) => [r.outcome.id, r.hash]));
    const sourceRows = new Map<string, Json>();
    for (const [table, records] of Object.entries({
      outcomes,
      actions,
      messages,
      entities,
      goals,
      tasks,
    }))
      for (const record of records)
        sourceRows.set(
          `${table}:${record.id}`,
          table === "outcomes"
            ? this.snapshot(record as Outcome, false)
            : JSON.parse(JSON.stringify(record)),
        );
    const currentSources = new Map(
      rows.map((r) => [
        r.outcome.id,
        (r.assessment?.evidence ?? []).every((e) => {
          const value = sourceRows.get(`${e.table}:${e.id}`);
          return value && digest(value) === e.hash;
        }),
      ]),
    );
    const recommendations = rows.flatMap((r) =>
      r.learning.recommendations.map((p) => ({
        outcome_id: r.outcome.id,
        ...p,
        evidence_current: p.evidence.every(
          (e) =>
            hashes.get(e.outcome_id) === e.hash &&
            currentSources.get(e.outcome_id) === true,
        ),
        active:
          p.history.at(-1)?.state === "accepted" &&
          p.evidence.every(
            (e) =>
              hashes.get(e.outcome_id) === e.hash &&
              currentSources.get(e.outcome_id) === true,
          ),
      })),
    );
    return {
      recommendations,
      rows: rows.slice(0, 200),
      total: rows.length,
      costs_visible: includeCosts,
      observed_at: new Date().toISOString(),
    };
  }
  async propose(ids: string[], c: ToolExecutionContext) {
    if (ids.length < 3 || ids.length > 8)
      throw new AppError("Compare three to eight independent runs");
    if (new Set(ids).size !== ids.length)
      throw new AppError("Duplicate outcome evidence");
    const report = await this.report();
    const rows = ids.map((id) =>
      required(
        report.rows.find((r) => r.outcome.id === id) ?? null,
        "Outcome in comparison window",
      ),
    );
    const tool = rows[0]?.tool;
    if (
      rows.length < 3 ||
      new Set(rows.map((r) => r.run)).size !== rows.length ||
      rows.some(
        (r) =>
          r.tool !== tool ||
          !(
            r.assessment?.achievement === "failure" ||
            r.assessment?.correction ||
            r.outcome.status === "failure"
          ),
      )
    )
      throw new AppError(
        "Select at least three independent runs of one tool with failures or explicit corrections",
      );
    const evidence = rows
      .map((r) => ({
        outcome_id: r.outcome.id,
        hash: r.hash,
        run: r.run,
        snapshot: r.snapshot,
      }))
      .sort((a, b) => a.outcome_id.localeCompare(b.outcome_id));
    const id = digest({ tool, evidence });
    const o = required(
      await this.repo.get("outcomes", evidence[0].outcome_id),
      "Outcome",
    );
    if (
      o.updated_at !==
      rows.find((r) => r.outcome.id === o.id)!.outcome.updated_at
    )
      throw new AppError("Evidence changed during proposal", 409);
    const learning = this.learning(o);
    if (learning.recommendations.some((p) => p.id === id))
      return { outcome_id: o.id, recommendation_id: id, replay: true };
    if (learning.recommendations.length >= 50)
      throw new AppError("Recommendation history limit reached");
    const proposal: Recommendation = {
      id,
      tool: tool!,
      reason: `${rows.length} distinct recorded runs have failures or corrections. ${rows.some((r) => r.action.metadata.simulated || r.tool.startsWith("mock.")) ? "Includes simulated evidence; this does not establish production effectiveness. " : ""}Association is not causal proof; selection may be biased.`,
      proposal: `Before the next ${tool} run, review these failures/corrections, confirm inputs and expected results, and use an explicit verification step. Test any workflow change as a separately reviewed Skill version.`,
      evidence,
      history: [
        {
          state: "proposed",
          reason: "Repeated-evidence rule v1; advisory only",
          at: new Date().toISOString(),
          action_id: c.actionId!,
          actor: c.userId,
        },
      ],
    };
    learning.recommendations.push(proposal);
    learning.revision++;
    this.stage(o, learning, c, [
      ...rows
        .filter((r) => r.outcome.id !== o.id)
        .map((r) => ({
          kind: "check" as const,
          table: "outcomes" as const,
          id: r.outcome.id,
          expected_updated_at: r.outcome.updated_at,
        })),
      ...rows.map((r) => ({
        kind: "check" as const,
        table: "actions" as const,
        id: r.action.id,
        expected_updated_at: r.action.updated_at,
      })),
    ]);
    return { outcome_id: o.id, recommendation_id: id, proposal };
  }
  async review(
    id: string,
    recommendationId: string,
    state: "accepted" | "rejected" | "withdrawn",
    reason: string,
    c: ToolExecutionContext,
  ) {
    const o = required(await this.repo.get("outcomes", id), "Outcome"),
      learning = this.learning(o);
    const p = required(
      learning.recommendations.find((p) => p.id === recommendationId) ?? null,
      "Recommendation",
    );
    const prior = p.history.at(-1)!.state;
    if (prior === state)
      return {
        outcome_id: id,
        recommendation_id: recommendationId,
        state,
        replay: true,
      };
    if (!(
      (prior === "proposed" && ["accepted", "rejected"].includes(state)) ||
      (prior === "accepted" && state === "withdrawn")
    ))
      throw new AppError("Invalid recommendation transition", 409);
    const checks: Mutation[] = [];
    if (state === "accepted")
      for (const e of p.evidence) {
        const row = required(
          await this.repo.get("outcomes", e.outcome_id),
          "Evidence outcome",
        );
        const action = required(
          await this.repo.get("actions", row.action_id),
          "Evidence action",
        );
        checks.push({
          kind: "check",
          table: "actions",
          id: action.id,
          expected_updated_at: action.updated_at,
        });
        if (digest(this.receipt(row, action)) !== e.hash)
          throw new AppError(
            "Evidence changed; generate and review a fresh proposal",
            409,
          );
        // Historical evidence remains visible; accepted advice must be based on still-present sources.
        for (const ref of this.learning(row).assessments.at(-1)?.evidence ??
          []) {
          const source = required(
            await this.repo.get(ref.table, ref.id),
            "Evidence source",
          );
          if (
            digest(
              ref.table === "outcomes"
                ? this.snapshot(source as Outcome, false)
                : JSON.parse(JSON.stringify(source)),
            ) !== ref.hash
          )
            throw new AppError("Evidence source changed", 409);
          if (!(ref.table === "outcomes" && ref.id === o.id))
            checks.push({
              kind: "check",
              table: ref.table,
              id: ref.id,
              expected_updated_at: source.updated_at,
            });
        }
        if (row.id !== o.id)
          checks.push({
            kind: "check",
            table: "outcomes",
            id: row.id,
            expected_updated_at: row.updated_at,
          });
      }
    p.history.push({
      state,
      reason,
      at: new Date().toISOString(),
      action_id: c.actionId!,
      actor: c.userId,
    });
    learning.revision++;
    this.stage(o, learning, c, checks);
    return {
      outcome_id: id,
      recommendation_id: recommendationId,
      state,
      core_instructions_changed: false,
    };
  }
}
