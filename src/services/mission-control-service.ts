import type { Repository } from "../domain/repository";
import {
  actionBelongsToMission,
  type MissionControlSnapshot,
} from "../domain/mission-control";
import { calculateRoi } from "../domain/roi";
import { AppError } from "../domain/validation";
import type { OrchestratorService } from "./orchestrator-service";
import type { ActionService } from "./action-service";

/** Owner-scoped presentation over canonical records; no dispatch or second mission store. */
export class MissionControlService {
  constructor(
    private repo: Repository,
    private orchestrator: OrchestratorService,
    private actions: ActionService,
  ) {}
  async inspect(id: string): Promise<MissionControlSnapshot> {
    // Existing conversation/activity policy checks and owner lookup run before any receipt reads.
    const plan = await this.orchestrator.inspect(id);
    const [all, approvals, outcomes] = await Promise.all([
      this.repo.list("actions"),
      this.repo.list("action_approvals"),
      this.repo.list("outcomes"),
    ]);
    const scoped = all.filter((a) => actionBelongsToMission(a, plan));
    const ids = new Set(scoped.map((a) => a.id));
    let costs: MissionControlSnapshot["costs"] = null;
    let calls: MissionControlSnapshot["receipts"][number]["calls"] = [];
    try {
      await this.actions.run("roi.read", null, async () => true);
      const [rawCalls, rawCosts] = await Promise.all([
        this.repo.list("model_calls"),
        this.repo.list("roi_cost_entries"),
      ]);
      calls = rawCalls.filter((c) => !!c.action_id && ids.has(c.action_id));
      const scopedCosts = rawCosts.filter((c) => ids.has(c.action_id));
      // Reuse Economics' cost precedence/revision logic. Unlinked calls are never guessed into a mission.
      costs = [...new Set(scoped.map((a) => a.created_at.slice(0, 7)))].flatMap(
        (month) =>
          calculateRoi(month, scoped, [], calls, scopedCosts, []).costRows,
      );
    } catch (error) {
      if (!(error instanceof AppError && error.status === 403)) throw error;
    }
    const receipts = scoped
      .toSorted((a, b) => a.created_at.localeCompare(b.created_at))
      .slice(-200)
      .map((action) => ({
        action,
        approvals: approvals.filter(
          (a) =>
            a.action_id === action.id || a.id === action.metadata.approval_id,
        ),
        outcomes: outcomes.filter((o) => o.action_id === action.id),
        calls: calls.filter((c) => c.action_id === action.id),
      }));
    return {
      plan,
      receipts,
      receipt_count: scoped.length,
      costs,
      observed_at: new Date().toISOString(),
    };
  }
}
