import { createHash } from "node:crypto";
import type { Repository } from "../domain/repository";
import type { ToolExecutionContext } from "../domain/tool-registry";
import type {
  DevelopmentExecutor,
  DevelopmentRun,
} from "../domain/self-development";
import { DEVELOPMENT } from "../domain/self-development";
import {
  AUTONOMY,
  autonomyLimits,
  documentationPath,
  completeValidation,
  emptyLedger,
  evaluateAutonomy,
  type AutonomyLedger,
} from "../domain/development-autonomy";
import { AppError, required } from "../domain/validation";
import type { SelfDevelopmentService } from "./self-development-service";
import type { Json } from "../domain/models";
import { digest } from "./permission-service";
const json = (v: unknown): Json => JSON.parse(JSON.stringify(v));

/** Level 2 is a constrained release role over the existing runs/actions/outcomes. */
export class DevelopmentAutonomyService {
  constructor(
    private repo: Repository,
    private development: SelfDevelopmentService,
    private executor: DevelopmentExecutor,
    private enabled = () =>
      process.env.ARY_DEVELOPMENT_LEVEL2_ENABLED === "true",
    private now = () => Date.now(),
  ) {}
  private guard(c: ToolExecutionContext) {
    if (
      !c.stage ||
      !c.actionId ||
      !c.requestKey ||
      c.userId !== this.repo.userId
    )
      throw new AppError("Canonical action context required", 403);
    c.signal?.throwIfAborted();
  }
  private ledgerId() {
    const h = createHash("sha256")
      .update(`${AUTONOMY}:${this.repo.userId}`)
      .digest("hex");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
  }
  private async ledger() {
    const row = await this.repo.get("messages", this.ledgerId());
    return {
      row,
      value: row
        ? structuredClone(row.metadata[AUTONOMY] as unknown as AutonomyLedger)
        : emptyLedger(),
    };
  }
  private async write(
    value: AutonomyLedger,
    old: Awaited<ReturnType<typeof this.ledger>>,
    conversation: string,
  ) {
    if (
      value.attempts.length +
        value.qualifications.length +
        value.discoveries.length >
      512
    )
      throw new AppError(
        "Development ledger capacity reached; owner maintenance required",
        409,
      );
    if (old.row)
      await this.repo.batch([
        {
          kind: "update",
          table: "messages",
          id: old.row.id,
          expected_updated_at: old.row.updated_at,
          data: { metadata: { ...old.row.metadata, [AUTONOMY]: json(value) } },
        },
      ]);
    else
      await this.repo.batch([
        {
          kind: "insert",
          table: "messages",
          id: this.ledgerId(),
          data: {
            conversation_id: conversation,
            role: "system",
            content: "Bounded development release ledger",
            metadata: { [AUTONOMY]: json(value) },
          },
        },
      ]);
  }
  private async history() {
    return (await this.repo.list("messages"))
      .map((m) => m.metadata[DEVELOPMENT] as unknown as DevelopmentRun)
      .filter((r) => r?.owner === this.repo.userId);
  }
  private async costs(run: DevelopmentRun) {
    const entries = await this.repo.list("roi_cost_entries");
    let total = 0;
    for (const id of new Set(run.history.map((h) => h.action_id))) {
      const e = entries
        .filter((e) => e.action_id === id)
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
        .at(-1);
      if (
        !e ||
        !e.evidence ||
        e.confidence !== 1 ||
        [
          e.actual_model_cost_usd,
          e.estimated_compute_cost_usd,
          e.additional_compute_cost_usd,
          e.tool_cost_usd,
        ].some((n) => n == null || !Number.isFinite(n) || n < 0)
      )
        return null;
      total +=
        e.actual_model_cost_usd! +
        e.estimated_compute_cost_usd! +
        e.additional_compute_cost_usd! +
        e.tool_cost_usd!;
    }
    return total;
  }
  async assess(id: string) {
    const { run } = await this.development.read(id);
    if (
      !run.plan ||
      digest(run.plan) !== run.plan_hash ||
      !run.patch ||
      digest(run.patch.value) !== run.patch.hash
    )
      throw new AppError("Scope or patch integrity mismatch", 409);
    const snapshot = await this.executor.inspect(run);
    const ledger = await this.ledger();
    const outcomes = await this.repo.list("outcomes");
    const history = await this.history();
    const verifiedLedger = {
      ...ledger.value,
      qualifications: ledger.value.qualifications.filter((q) =>
        outcomes.some(
          (o) =>
            o.id === q.outcome_id &&
            o.status === "success" &&
            history.some(
              (h) =>
                h.id === q.run_id &&
                h.history.some((e) => e.action_id === o.action_id),
            ),
        ),
      ),
    };
    const cost = await this.costs(run);
    return {
      run,
      snapshot,
      ledger,
      cost,
      policy: evaluateAutonomy({
        enabled: this.enabled(),
        run,
        ...snapshot,
        history,
        ledger: verifiedLedger,
        costUsd: cost,
        now: this.now(),
      }),
    };
  }
  async inspect(id: string) {
    const a = await this.assess(id);
    return json({
      run_id: id,
      candidate: a.snapshot.candidate,
      cost_usd: a.cost,
      ...a.policy,
    });
  }
  async qualify(id: string, outcomeId: string, c: ToolExecutionContext) {
    this.guard(c);
    if (c.agentId)
      throw new AppError(
        "Only owner can qualify historical release evidence",
        403,
      );
    const { run } = await this.development.read(id);
    const outcome = required(
      await this.repo.get("outcomes", outcomeId),
      "Outcome",
    );
    if (
      run.phase !== "COMPLETED" ||
      !run.decision?.accept ||
      !run.release ||
      !run.review?.ready ||
      /fixture|mock|stub|local-evidence/i.test(
        `${run.review.model} ${run.review.provider}`,
      ) ||
      !completeValidation(run, run.review.candidate) ||
      !run.plan?.paths.length ||
      !run.plan.paths.every(documentationPath) ||
      outcome.status !== "success" ||
      !run.history.some((h) => h.action_id === outcome.action_id)
    )
      throw new AppError(
        "Completed supervised documentation run and linked successful outcome required",
        409,
      );
    const ledger = await this.ledger();
    if (ledger.value.qualifications.some((q) => q.run_id === id))
      return { qualified: true, run_id: id };
    ledger.value.qualifications.push({
      run_id: id,
      outcome_id: outcomeId,
      action_id: c.actionId!,
      at: new Date(this.now()).toISOString(),
      release_hash: run.release.hash,
      candidate: run.review.candidate,
    });
    await this.write(ledger.value, ledger, run.conversation_id);
    return { qualified: true, run_id: id, outcome_id: outcomeId };
  }
  async release(id: string, hash: string, c: ToolExecutionContext) {
    this.guard(c);
    const a = await this.assess(id);
    if (a.run.release?.hash !== hash || digest(a.run.release.manifest) !== hash)
      throw new AppError("Release manifest changed", 409);
    if (!a.policy.eligible) return json({ released: false, ...a.policy });
    if (!this.executor.publishLocal)
      throw new AppError("Local release executor unavailable", 503);
    // CAS reservation is durable BEFORE any Git effect. Never retry an uncertain reservation.
    const attempt = {
      run_id: id,
      action_id: c.actionId!,
      at: new Date(this.now()).toISOString(),
      cost_usd: a.cost!,
      status: "reserved" as const,
    };
    a.ledger.value.attempts.push(attempt);
    await this.write(a.ledger.value, a.ledger, a.run.conversation_id);
    try {
      if (!this.enabled()) throw new AppError("Level 2 disabled", 403);
      c.signal?.throwIfAborted();
      const fresh = await this.development.read(id);
      if (
        fresh.run.revision !== a.run.revision ||
        fresh.run.release?.hash !== hash
      )
        throw new AppError("Run changed before release", 409);
      const mission = (await this.development.inspect(id))
        .mission as unknown as { mission?: { state: string } };
      if (
        ["CANCELLED", "FAILED", "PAUSED"].includes(
          mission?.mission?.state ?? "FAILED",
        )
      )
        throw new AppError("Mission stopped", 409);
      const result = await this.executor.publishLocal(a.run, c.signal);
      const ledger = await this.ledger();
      const saved = required(
        ledger.value.attempts.find((x) => x.action_id === c.actionId) ?? null,
        "Release reservation",
      );
      Object.assign(saved, result, {
        status: result.healthy
          ? "released"
          : result.rolled_back
            ? "rolled_back"
            : "stopped",
      });
      await this.write(ledger.value, ledger, a.run.conversation_id);
      return json({
        released: result.healthy,
        ...result,
        policy: a.policy,
        merged: false,
        deployed: false,
      });
    } catch {
      const ledger = await this.ledger();
      const saved = ledger.value.attempts.find(
        (x) => x.action_id === c.actionId,
      );
      if (saved) {
        saved.status = "stopped";
        saved.reason =
          "Uncertain or failed release; inspect action and filesystem receipts. No automatic retry.";
        await this.write(ledger.value, ledger, a.run.conversation_id);
      }
      throw new AppError(
        "Release stopped; owner reconciliation required. No automatic retry",
        409,
      );
    }
  }
  async discover(id: string, c: ToolExecutionContext) {
    this.guard(c);
    // Existing evidence-backed OBSERVATION only; this scheduler hook cannot plan/edit/build.
    const { run } = await this.development.read(id);
    if (run.phase !== "OBSERVATION" || !run.evidence.length)
      throw new AppError(
        "Unprocessed evidence-backed observation required",
        409,
      );
    const ledger = await this.ledger();
    if (
      ledger.value.discoveries.some(
        (d) =>
          d.run_id === id ||
          this.now() - Date.parse(d.at) < autonomyLimits.discoveryIntervalMs,
      )
    )
      throw new AppError("Discovery cooldown or duplicate observation", 409);
    ledger.value.discoveries.push({
      run_id: id,
      at: new Date(this.now()).toISOString(),
      action_id: c.actionId!,
    });
    await this.write(ledger.value, ledger, run.conversation_id);
    return this.development.propose(
      id,
      run.revision,
      `Review observed evidence: ${run.observation}. Discovery proposes only; owner scope approval remains required.`,
      c,
    );
  }
  async metrics() {
    const runs = await this.history(),
      { value } = await this.ledger();
    return json({
      enabled: this.enabled(),
      proposals: runs.filter((r) => r.proposal).length,
      approvals: runs.filter((r) => r.mission_id).length,
      rejected_proposals: runs.filter(
        (r) => r.phase === "REJECTED" || r.decision?.accept === false,
      ).length,
      releases: value.attempts.filter((a) => a.status === "released").length,
      rollbacks: value.attempts.filter((a) => a.status === "rolled_back")
        .length,
      regressions: null,
      test_failures: runs.filter((r) => r.validation && !r.validation.passed)
        .length,
      time_saved: null,
      outcome_improvement: null,
      qualified_outcomes: value.qualifications.length,
      attempts: value.attempts,
      limits: autonomyLimits,
    });
  }
}
