import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  newMission,
  submissionInput,
  type MissionEngine,
  type MissionRuntime,
} from "../domain/mission";
import {
  bindInput,
  type ExecutionPlan,
  type PlanSpec,
} from "../domain/orchestration";
import type { Repository } from "../domain/repository";
import type { OrchestratorService } from "./orchestrator-service";
import { AppError } from "../domain/validation";
import { missionExecution } from "./mission-execution-context";
import { NexusEventBus } from "./nexus-event-bus";
/** Scheduling around the existing coordinator. Tool dispatch, approvals and receipt recovery remain there. */
export class CheckpointMissionEngine implements MissionEngine {
  readonly implementation = "checkpoint-v1";
  constructor(
    private repo: Repository,
    private coordinator: OrchestratorService,
  ) {}
  async create(
    goal: string,
    spec?: PlanSpec,
    options?: Parameters<typeof newMission>[0],
    agentId?: string,
  ) {
    return this.coordinator.create(goal, spec, {
      ...newMission(options),
      ...(agentId ? { agent_id: agentId } : {}),
    });
  }
  async inspect(id: string) {
    const plan = await this.coordinator.inspect(id);
    if (!plan.mission)
      throw new AppError("This is a legacy execution plan", 409);
    return plan;
  }
  private async leased<T>(id: string, work: () => Promise<T>) {
    const plan = await this.inspect(id),
      token = randomUUID();
    if (
      !(await this.repo.claimMission(
        id,
        token,
        plan.mission!.options.step_timeout_ms + 10000,
      ))
    )
      throw new AppError("Mission is already claimed by another worker", 409);
    try {
      return await missionExecution.run({ id, token }, work);
    } finally {
      await this.repo.releaseMission(id, token);
    }
  }
  async control(
    id: string,
    command: Parameters<MissionEngine["control"]>[1],
    revision: number,
  ) {
    const current = await this.inspect(id);
    if (current.revision !== revision)
      throw new AppError("Mission changed; reload", 409);
    if (["COMPLETED", "CANCELLED"].includes(current.mission!.state))
      return current;
    if (["pause", "cancel"].includes(command)) {
      await this.coordinator.requestControl(id, command as "pause" | "cancel");
      try {
        return await this.leased(id, () =>
          this.coordinator.reconcileMissionControl(id),
        );
      } catch (e) {
        if (!(e instanceof AppError) || e.status !== 409) throw e;
        return {
          ...current,
          summary: `${command} requested durably. In-flight effects may finish; future dispatch will stop.`,
        };
      }
    }
    return this.leased(id, async () => {
      let plan = await this.inspect(id),
        m = plan.mission!;
      if (plan.revision !== revision)
        throw new AppError("Mission changed; reload", 409);
      if (command === "plan") {
        if (m.state !== "DRAFT")
          throw new AppError("Only draft missions can be planned", 409);
        m.state = "PLANNING";
        m.activated = false;
        m.wake_at = new Date().toISOString();
      } else if (command === "start" || command === "resume") {
        if (
          !["READY", "PAUSED", "WAITING", "APPROVAL_REQUIRED"].includes(m.state)
        )
          throw new AppError(
            "Plan or recover this mission before starting",
            409,
          );
        await this.coordinator.requestControl(id, "resume");
        m.activated = true;
        m.state = "RUNNING";
        m.wake_at = new Date().toISOString();
      } else if (command === "retry" && plan.model === "not-planned") {
        m.state = "PLANNING";
        m.wake_at = new Date().toISOString();
        delete m.reason;
      } else if (command === "retry") {
        plan = await this.coordinator.command(id, "retry", plan.revision);
        m = plan.mission!;
        m.retry = undefined;
        m.state = "PAUSED";
        m.activated = false;
      }
      return this.coordinator.checkpoint(
        plan,
        `Mission ${command} checkpoint. Per-step approvals remain required.`,
      );
    });
  }
  async submit(id: string, raw: Parameters<MissionEngine["submit"]>[1]) {
    const input = submissionInput.parse(raw);
    return this.leased(id, async () => {
      const plan = await this.inspect(id),
        m = plan.mission!;
      const prior = m.submissions.find((s) => s.id === input.id);
      if (prior) {
        const { at, ...saved } = prior;
        if (!isDeepStrictEqual(saved, input))
          throw new AppError("Submission ID belongs to different content", 409);
        return plan;
      }
      if (["COMPLETED", "CANCELLED", "FAILED"].includes(m.state))
        throw new AppError("Mission is closed", 409);
      if (!plan.spec.steps.some((s) => s.wait_for?.name === input.name))
        throw new AppError("No declared event accepts this submission");
      if (m.submissions.length >= 50)
        throw new AppError("Submission limit reached", 409);
      m.submissions.push({ ...input, at: new Date().toISOString() });
      if (m.activated) m.wake_at = new Date().toISOString();
      const saved = await this.coordinator.checkpoint(
        plan,
        `Submission ${input.id} accepted for ${input.name}; this is evidence, never action approval.`,
      );
      await new NexusEventBus(this.repo).record({
        type: "mission.submitted",
        source: { kind: "backend", name: "MissionEngine" },
        mission_id: id,
        correlation_id: plan.conversation_id,
        payload: { record_id: input.id, label: input.name },
      });
      return saved;
    });
  }
  private async deadline<T>(
    work: Promise<T>,
    milliseconds: number,
  ): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        work,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(new AppError("Mission planning deadline elapsed", 408)),
            milliseconds,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  async tick(id: string) {
    return this.leased(id, async () => {
      let plan = await this.coordinator.reconcileMissionControl(id),
        m = plan.mission!;
      if (m.state === "PLANNING") {
        try {
          return await this.deadline(
            this.coordinator.planMission(id),
            m.options.step_timeout_ms,
          );
        } catch (e) {
          if (e instanceof AppError && e.status === 409) throw e;
          m.state = "FAILED";
          m.wake_at = null;
          m.reason =
            "Planning failed; inspect the recorded provider/action error.";
          return this.coordinator.checkpoint(plan, m.reason);
        }
      }
      if (
        !m.activated ||
        ["CANCELLED", "COMPLETED", "PAUSED"].includes(m.state)
      )
        return plan;
      if (m.wake_at && Date.parse(m.wake_at) > Date.now()) return plan;
      const pending = Object.values(plan.states).filter(
        (s) => s.status === "waiting_approval",
      );
      if (
        pending.length &&
        !plan.spec.steps.some(
          (step) =>
            plan.states[step.id].status === "running" ||
            (plan.states[step.id].status === "planned" &&
              step.depends_on.every(
                (d) => plan.states[d].status === "verified",
              )),
        )
      ) {
        const decisions = await this.repo.list("action_approvals");
        if (
          !pending.some((s) =>
            decisions.some(
              (a) =>
                a.action_id === s.approval_action_id &&
                (a.decision === "rejected" ||
                  (a.decision === "approved" &&
                    !a.consumed_at &&
                    Date.parse(a.expires_at) > Date.now())),
            ),
          )
        )
          return plan;
      }
      const running = Object.values(plan.states).some(
        (s) => s.status === "running",
      );
      if (running) {
        try {
          plan = await this.coordinator.command(id, "recover", plan.revision);
        } catch (e) {
          if (
            !(e instanceof AppError) ||
            e.status !== 409 ||
            !e.message.includes("unresolved")
          )
            throw e;
          if (m.uncertain) return plan;
          m.uncertain = true;
          m.state = "WAITING";
          m.wake_at = new Date(Date.now() + 5000).toISOString();
          return this.coordinator.checkpoint(
            plan,
            "Waiting for an authoritative action receipt. An uncertain effect is never repeated.",
          );
        }
        m = plan.mission!;
        m.uncertain = false;
        delete m.dispatch_deadline;
      }
      if (m.retry) {
        if (Date.parse(m.retry.at) > Date.now()) return plan;
        plan = await this.coordinator.command(id, "retry", plan.revision);
        m = plan.mission!;
        delete m.retry;
        plan = await this.coordinator.checkpoint(
          plan,
          "Durable retry timer elapsed; permissions are checked again.",
        );
        m = plan.mission!;
      }
      const failed = plan.spec.steps.find(
        (s) => plan.states[s.id].status === "failed",
      );
      if (failed) return this.failed(plan, failed.id);
      // Resolve declarative branch/wait gates before the coordinator selects runnable work.
      let changed = false;
      const results = Object.fromEntries(
        Object.entries(plan.states)
          .filter(([, s]) => s.result)
          .map(([id, s]) => [id, s.result!]),
      );
      for (const step of plan.spec.steps) {
        const state = plan.states[step.id];
        if (
          !["planned", "waiting_event"].includes(state.status) ||
          !step.depends_on.every((d) => plan.states[d].status === "verified") ||
          state.phase !== "execute"
        )
          continue;
        if (step.when) {
          let matches = false;
          try {
            matches = isDeepStrictEqual(
              bindInput(
                { $from: step.when.step, path: step.when.path },
                results,
                step.depends_on,
              ),
              step.when.equals,
            );
          } catch {
            state.status = "failed";
            state.error = "Branch evidence unavailable";
            changed = true;
            continue;
          }
          if (!matches) {
            state.status = "skipped";
            state.evidence =
              "Declared branch condition did not match the recorded dependency result";
            changed = true;
            continue;
          }
        }
        if (step.wait_for) {
          const submission = m.submissions.find(
            (s) => s.name === step.wait_for!.name,
          );
          if (submission) {
            if (state.status === "waiting_event") {
              state.status = "planned";
              changed = true;
            }
            state.evidence = `Submission ${submission.id}`;
          } else {
            m.wait_deadlines[step.id] ??= new Date(
              Date.now() + step.wait_for.timeout_ms,
            ).toISOString();
            if (Date.parse(m.wait_deadlines[step.id]) <= Date.now()) {
              state.status = "failed";
              state.error = "External event deadline expired";
            } else state.status = "waiting_event";
            changed = true;
          }
        }
      }
      if (changed) {
        plan = await this.coordinator.checkpoint(
          plan,
          "Evaluated declared branch and event gates against recorded evidence.",
        );
        m = plan.mission!;
      }
      const gateFailure = plan.spec.steps.find(
        (s) => plan.states[s.id].status === "failed",
      );
      if (gateFailure) return this.failed(plan, gateFailure.id);
      m.dispatch_deadline = new Date(
        Date.now() + m.options.step_timeout_ms,
      ).toISOString();
      m.state = "RUNNING";
      m.wake_at = new Date().toISOString();
      plan = await this.coordinator.checkpoint(
        plan,
        "Durable execution checkpoint before dispatch.",
      );
      // Deadline is not an assertion that an external side effect was cancelled.
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        const result = await Promise.race([
          this.coordinator.command(id, "advance", plan.revision),
          new Promise<never>((_, reject) => {
            timeout = setTimeout(
              () => reject(new AppError("Mission step deadline elapsed", 408)),
              m.options.step_timeout_ms,
            );
          }),
        ]);
        return await this.afterStep(result);
      } catch (e) {
        if (!(e instanceof AppError) || e.status !== 408) throw e;
        const latest = await this.inspect(id);
        latest.mission!.uncertain = true;
        latest.mission!.wake_at = new Date(Date.now() + 5000).toISOString();
        return this.coordinator.checkpoint(
          latest,
          "Step deadline elapsed. Awaiting its receipt; cancellation cannot undo an in-flight effect.",
        );
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    });
  }
  private async failed(plan: ExecutionPlan, stepId: string) {
    const s = plan.states[stepId],
      m = plan.mission!;
    if (
      s.failure?.kind === "transient" &&
      s.failure.retry_safe &&
      s.attempt + 1 < m.options.max_attempts
    ) {
      const at = new Date(
        Date.now() + m.options.retry_delay_ms * 2 ** s.attempt,
      ).toISOString();
      m.retry = { step: stepId, at };
      m.state = "WAITING";
      m.wake_at = at;
    } else {
      m.state = "FAILED";
      m.wake_at = null;
    }
    return this.coordinator.checkpoint(
      plan,
      m.retry
        ? "Safe transient failure; bounded retry scheduled durably."
        : "Mission failed; completed actions and evidence remain available.",
    );
  }
  private async afterStep(plan: ExecutionPlan) {
    const m = plan.mission!;
    delete m.dispatch_deadline;
    m.uncertain = false;
    const failed = Object.entries(plan.states).find(
      ([, s]) => s.status === "failed",
    );
    if (failed) return this.failed(plan, failed[0]);
    if (
      m.activated &&
      plan.status !== "stopped" &&
      Object.values(plan.states).every((s) =>
        ["verified", "skipped"].includes(s.status),
      )
    ) {
      plan.status = "complete";
      m.state = "COMPLETED";
      m.wake_at = null;
    }

    if (!m.activated || ["CANCELLED", "COMPLETED", "PAUSED"].includes(m.state))
      m.wake_at = null;
    else if (
      Object.values(plan.states).some((s) => s.status === "waiting_approval")
    ) {
      m.state = "APPROVAL_REQUIRED";
      m.wake_at = new Date(Date.now() + 2000).toISOString();
    } else if (
      Object.values(plan.states).some((s) =>
        ["planned", "running"].includes(s.status),
      ) &&
      plan.status !== "paused"
    ) {
      m.state = "RUNNING";
      m.wake_at = new Date().toISOString();
    } else {
      m.state = "WAITING";
      const deadlines = Object.entries(m.wait_deadlines)
        .filter(([id]) => plan.states[id].status === "waiting_event")
        .map(([, at]) => at)
        .sort();
      m.wake_at = deadlines[0] ?? null;
    }
    return this.coordinator.checkpoint(
      plan,
      "Mission checkpoint saved; the next worker can resume from recorded state.",
    );
  }
  async runDue(limit = 10) {
    const result = { processed: [] as string[], errors: [] as string[] };
    for (const row of await this.repo.dueMissions(limit)) {
      try {
        await this.coordinator.requests.request({
          tool: "mission.tick",
          input: { mission_id: row.id },
          request_key: randomUUID(),
          reason:
            "Resume a previously activated durable mission; per-step permissions remain authoritative",
        });
        result.processed.push(row.id);
      } catch (e) {
        if (!(e instanceof AppError && e.status === 409))
          result.errors.push(row.id);
      }
    }
    return result;
  }
}
