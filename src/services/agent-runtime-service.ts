import { isDeepStrictEqual } from "node:util";
import {
  agentInput,
  agentStatus,
  type Agent,
  type AgentRuntime,
  type AgentView,
} from "../domain/agent";
import type { AgentModelRegistry } from "../domain/agent-models";
import type { Repository, Mutation } from "../domain/repository";
import type { Message, Json } from "../domain/models";
import type { ExecutionPlan, PlanSpec } from "../domain/orchestration";
import type { OrchestratorService } from "./orchestrator-service";
import type { MissionEngine } from "../domain/mission";
import type { BoardMeetingService } from "./board-meeting-service";
import type { ActionService } from "./action-service";
import type { ActionRequestService } from "./action-request-service";
import { AppError, required } from "../domain/validation";
import { getToolDefinition } from "../domain/permissions";
import { agentExecution, agentAssignment } from "./agent-context";
import { NexusEventBus } from "./nexus-event-bus";
import { assertMissionLease } from "./mission-execution-context";

const VERSION = "agent-v1";
const controllers = new Map<string, Set<AbortController>>();
export async function readAgentViews(
  repo: Repository,
  includeUsage = false,
): Promise<AgentView[]> {
  const [messages, actions, calls] = await Promise.all([
    repo.list("messages"),
    repo.list("actions"),
    includeUsage ? repo.list("model_calls") : Promise.resolve([]),
  ]);
  const agents = messages
    .filter((m) => m.metadata.agent_version === VERSION)
    .map((m) => m.metadata.agent as unknown as Agent);
  const plans = messages
    .filter((m) => m.metadata.orchestrator_version === "orchestrator-v1")
    .map((m) => m.metadata.plan as unknown as ExecutionPlan);
  return agents.map((agent) => {
    const missions = plans.filter((p) => agent.missions.includes(p.id));
    let parent = agent.parent_id,
      ancestorTerminated = false;
    for (let n = 0; parent && n < 4; n++) {
      const record = agents.find((a) => a.id === parent);
      ancestorTerminated ||= !!record?.terminated_at;
      parent = record?.parent_id ?? null;
    }
    const actionIds = new Set(
      actions
        .filter(
          (a) =>
            a.metadata.agent_id === agent.id || a.id === agent.source_action_id,
        )
        .map((a) => a.id),
    );
    const metrics = calls.filter(
      (c) => c.action_id && actionIds.has(c.action_id),
    );
    const sum = (values: (number | null)[]) =>
      values.some((v) => v !== null)
        ? values.reduce<number>((n, v) => n + (v ?? 0), 0)
        : null;
    return {
      agent,
      missions,
      usage: {
        available: includeUsage,
        calls: metrics.length,
        input_tokens: sum(metrics.map((c) => c.input_tokens)),
        output_tokens: sum(metrics.map((c) => c.output_tokens)),
        estimated_cost_usd: sum(metrics.map((c) => c.estimated_cost_usd)),
        unknown_cost_calls: metrics.filter((c) => c.estimated_cost_usd === null)
          .length,
      },
      status: ancestorTerminated
        ? "TERMINATED"
        : agentStatus(
            agent,
            missions,
            actions.find((a) => a.id === agent.source_action_id)?.status,
          ),
    };
  });
}

/** Profiles and reservations use existing owner messages/CAS; existing missions own execution and recovery. */
export class AgentRuntimeService implements AgentRuntime {
  constructor(
    private repo: Repository,
    private actions: ActionService,
    private requests: ActionRequestService,
    private missions: MissionEngine,
    private coordinator: OrchestratorService,
    private board: BoardMeetingService,
    readonly models: AgentModelRegistry,
  ) {}
  private async row(id: string) {
    const row = required(await this.repo.get("messages", id), "Agent");
    if (row.metadata.agent_version !== VERSION)
      throw new AppError("Agent not found", 404);
    return { row, agent: structuredClone(row.metadata.agent) as Agent };
  }
  private async chain(id: string) {
    const rows: { row: Message; agent: Agent }[] = [];
    let current: string | null = id;
    while (current) {
      if (rows.length >= 4 || rows.some((r) => r.agent.id === current))
        throw new AppError("Agent ancestry limit reached", 409);
      const item = await this.row(current);
      rows.push(item);
      current = item.agent.parent_id;
    }
    return rows;
  }
  private ensureAlive(rows: { agent: Agent }[]) {
    if (rows.some((r) => r.agent.terminated_at))
      throw new AppError("Agent or parent is terminated", 403);
  }
  private patch(row: Message, agent: Agent): Mutation {
    return {
      kind: "update",
      table: "messages",
      id: row.id,
      expected_updated_at: row.updated_at,
      data: { metadata: { ...row.metadata, agent } },
    };
  }
  private async event(agent: Agent, state: string, missionId?: string) {
    await new NexusEventBus(this.repo).record({
      type: `agent.${state}`,
      source: { kind: "backend", name: "AgentRuntime" },
      correlation_id: agent.id,
      mission_id: missionId ?? null,
      visibility: "ambient",
      payload: {
        record_id: agent.id,
        agent_id: agent.id,
        parent_agent_id: agent.parent_id,
        label: agent.name,
        state,
        terminal: ["terminated", "completed", "failed"].includes(state),
      },
    });
  }
  async list() {
    for (const tool of ["conversation.read", "activity.read"])
      await this.actions.run(tool, null, async () => true);
    let includeUsage = false;
    try {
      await this.actions.run("roi.read", null, async () => true);
      includeUsage = true;
    } catch {
      /* Cost visibility remains permission-gated. */
    }
    return readAgentViews(this.repo, includeUsage);
  }
  async create(
    raw: Parameters<AgentRuntime["create"]>[0],
    actionId: string,
  ): Promise<Agent> {
    const input = agentInput.parse(raw);
    this.models.resolve(input.model);
    const existing = await this.repo.get("messages", actionId);
    if (existing) {
      const saved = (await this.row(actionId)).agent;
      const savedSpec = Object.fromEntries(
        Object.keys(input).map((k) => [k, saved[k as keyof Agent]]),
      );
      if (!isDeepStrictEqual(savedSpec, input))
        throw new AppError(
          "Agent identity belongs to different configuration",
          409,
        );
      return saved;
    }
    // No arbitrary execution framework: only existing registered, reviewed internal domains in v1.
    const supported = new Set([
      "mission.agent",
      "agent.delegate",
      "create_task",
      "update_task",
      "update_project_status",
      "task.inspect",
      "mock.fetch_project_summary",
      "mock.create_note",
      "mock.draft_message",
    ]);
    for (const tool of input.tool_access) {
      if (!supported.has(tool) || !getToolDefinition(tool))
        throw new AppError(
          "Unsupported agent tool; external domains are not enabled for workers",
          400,
        );
      if (
        tool === "mission.agent"
          ? !input.capabilities.includes("analyze")
          : tool === "agent.delegate"
            ? !input.capabilities.includes("delegate")
            : !input.capabilities.includes("tools")
      )
        throw new AppError("Tool requires its matching agent capability", 400);
    }
    const ancestors = input.parent_id ? await this.chain(input.parent_id) : [];
    this.ensureAlive(ancestors);
    if (ancestors.length >= 3)
      throw new AppError("Maximum child-worker depth reached", 400);
    for (const { agent: parent } of ancestors) {
      if (
        !parent.capabilities.includes("delegate") ||
        parent.children.length >= parent.budgets.children
      )
        throw new AppError(
          "Parent delegation capability or child budget exhausted",
          403,
        );
      if (
        input.permission_level > parent.permission_level ||
        input.tool_access.some((t) => !parent.tool_access.includes(t)) ||
        input.capabilities.some((c) => !parent.capabilities.includes(c)) ||
        (input.memory_scope === "mission" && parent.memory_scope === "none") ||
        input.model !== parent.model ||
        Object.keys(input.budgets).some(
          (k) =>
            input.budgets[k as keyof typeof input.budgets] >
            parent.budgets[k as keyof typeof input.budgets],
        )
      )
        throw new AppError(
          "Child scope, model and budgets must not exceed its parent",
          403,
        );
    }
    const scoped = agentExecution.getStore();
    if (scoped && scoped.id !== input.parent_id)
      throw new AppError("Worker may create only its own child", 403);
    const created = new Date().toISOString();
    const agent: Agent = {
      ...input,
      version: 1,
      id: actionId,
      user_id: this.repo.userId,
      created_at: created,
      terminated_at: null,
      termination_reason: null,
      children: [],
      missions: [],
      run_keys: [],
      assignments: {},
      dispatch_keys: [],
      model_keys: [],
      source_action_id: null,
    };
    const mutations: Mutation[] = [
      {
        kind: "insert",
        table: "conversations",
        id: actionId,
        data: {
          title: `Agent · ${agent.name}`,
          metadata: { agent_version: VERSION },
        },
      },
      {
        kind: "insert",
        table: "messages",
        id: actionId,
        data: {
          conversation_id: actionId,
          role: "system",
          content: agent.purpose,
          metadata: { agent_version: VERSION, agent },
        },
      },
    ];
    for (const parent of ancestors) {
      parent.agent.children.push(agent.id);
      mutations.push(this.patch(parent.row, parent.agent));
    }
    await this.repo.batch(mutations);
    await this.event(agent, input.parent_id ? "child_created" : "created");
    return agent;
  }
  async submit(
    id: string,
    objective: string,
    key: string,
    spec?: PlanSpec,
  ): Promise<ExecutionPlan> {
    const rows = await this.chain(id);
    this.ensureAlive(rows);
    const agent = rows[0].agent;
    if (
      agent.lifetime === "ephemeral" &&
      agent.run_keys.length &&
      !agent.run_keys.includes(key)
    )
      throw new AppError("Ephemeral workers accept one assignment", 409);
    const existing = agent.assignments[key];
    if (existing) return this.coordinator.inspect(existing);
    if (agent.run_keys.includes(key)) {
      const receipt = (await this.repo.list("actions")).find(
        (a) =>
          a.tool_name === "mission.create" &&
          a.status === "succeeded" &&
          (a.metadata.request_envelope as Record<string, unknown> | undefined)
            ?.request_key === `agent-assignment:${id}:${key}`,
      );
      const recovered = receipt?.output.result as unknown as
        ExecutionPlan | undefined;
      if (recovered?.id && recovered.mission?.agent_id === id) {
        if (!agent.missions.includes(recovered.id))
          agent.missions.push(recovered.id);
        agent.assignments[key] = recovered.id;
        await this.repo.batch([this.patch(rows[0].row, agent)]);
        return this.coordinator.inspect(recovered.id);
      }
      throw new AppError(
        "Assignment reservation has no successful receipt; inspect the failed action before retrying with a new key",
        409,
      );
    }
    const planned = spec ?? {
      title: objective.slice(0, 160),
      questions: [],
      steps: [
        {
          id: "analysis",
          title: agent.purpose.slice(0, 160),
          tool: "mission.agent",
          input: { role: agent.specialization, objective },
          depends_on: [],
          critical: true,
          missing: [],
          source_action_from: null,
          verification: null,
        },
      ],
    };
    for (const step of planned.steps)
      for (const tool of [step.tool, step.verification?.tool].filter(Boolean))
        if (!agent.tool_access.includes(tool!))
          throw new AppError("Mission exceeds assigned agent tool access", 403);
    for (const row of rows) {
      if (row.agent.run_keys.length >= row.agent.budgets.runs)
        throw new AppError("Agent run budget exhausted", 403);
      row.agent.run_keys.push(key);
    }
    rows[0].agent.assignments[key] = null;
    await this.repo.batch(rows.map((r) => this.patch(r.row, r.agent)));
    // ARY creates the durable assignment. Domain work is later dispatched under the agent ceiling.
    const result = await agentAssignment.run(id, () =>
      agentExecution.exit(() =>
        this.requests.request({
          tool: "mission.create",
          input: {
            goal: objective,
            spec: planned,
            options: { step_timeout_ms: agent.budgets.timeout_ms },
          },
          request_key: `agent-assignment:${id}:${key}`,
          reason: `Assign reviewed work to ${agent.name}`,
        }),
      ),
    );
    const plan = result.result as unknown as ExecutionPlan;
    if (plan.mission?.agent_id !== id)
      throw new AppError("Assignment identity mismatch", 409);
    const fresh = await this.row(id);
    fresh.agent.missions.push(plan.id);
    fresh.agent.assignments[key] = plan.id;
    await this.repo.batch([this.patch(fresh.row, fresh.agent)]);
    await this.event(fresh.agent, "delegated", plan.id);
    // Preserve the READY / explicit-start boundary. Submission never runs a model or domain effect.
    return plan;
  }
  async delegate(
    parentId: string,
    raw: Parameters<AgentRuntime["create"]>[0],
    objective: string,
    key: string,
  ) {
    const input = agentInput.parse({
      ...raw,
      parent_id: parentId,
      lifetime: "ephemeral",
    });
    const parent = (await this.chain(parentId))[0].agent;
    if (!parent.capabilities.includes("delegate"))
      throw new AppError("Agent cannot delegate", 403);
    const agent = await this.create(input, key);
    return { agent, mission: await this.submit(agent.id, objective, key) };
  }
  async terminate(id: string, reason: string) {
    const { row, agent } = await this.row(id);
    if (!agent.terminated_at) {
      agent.terminated_at = new Date().toISOString();
      agent.termination_reason = reason;
      await this.repo.batch([this.patch(row, agent)]);
    }
    for (const target of [id, ...agent.children]) {
      for (const controller of controllers.get(
        `${this.repo.userId}:${target}`,
      ) ?? [])
        controller.abort();
      const child = await this.row(target);
      for (const mission of child.agent.missions)
        await this.coordinator.requestControl(mission, "cancel");
    }
    await this.event(agent, "terminated");
  }
  async dispatch<T>(
    plan: ExecutionPlan,
    tool: string,
    key: string,
    work: () => Promise<T>,
  ): Promise<T> {
    const id = plan.mission?.agent_id;
    if (!id) return work();
    let rows = await this.chain(id);
    for (let attempt = 0; ; attempt++) {
      this.ensureAlive(rows);
      for (const row of rows) {
        const a = row.agent;
        if (!a.tool_access.includes(tool))
          throw new AppError("Agent tool access denied", 403);
        if (!a.dispatch_keys.includes(key)) {
          if (a.dispatch_keys.length >= a.budgets.tool_calls)
            throw new AppError("Agent tool-call budget exhausted", 403);
          a.dispatch_keys.push(key);
        }
        if (tool === "mission.agent" && !a.model_keys.includes(key)) {
          if (a.model_keys.length >= a.budgets.model_calls)
            throw new AppError("Agent model-call budget exhausted", 403);
          a.model_keys.push(key);
        }
      }
      try {
        await this.repo.batch(rows.map((r) => this.patch(r.row, r.agent)));
        break;
      } catch (error) {
        if (
          !(error instanceof AppError) ||
          error.status !== 409 ||
          attempt >= 4
        )
          throw error;
        rows = await this.chain(id);
      }
    }
    const a = rows[0].agent;
    return agentExecution.run(
      {
        id,
        userId: this.repo.userId,
        permissionLevel: a.permission_level,
        tools: [
          ...a.tool_access,
          "conversation.read",
          "entity.read",
          "activity.read",
          ...(a.memory_scope === "mission" ? ["memory.read"] : []),
        ],
        check: async () => this.ensureAlive(await this.chain(id)),
      },
      work,
    );
  }
  async submission(
    role: Agent["specialization"],
    objective: string,
    missionId: string,
    actionId: string,
  ): Promise<Json> {
    await assertMissionLease(this.repo, missionId);
    const plan = required(await this.repo.get("messages", missionId), "Mission")
      .metadata.plan as unknown as ExecutionPlan;
    let id = plan.mission?.agent_id;
    if (!id) {
      const worker = await this.create(
        {
          name: `${role} worker`,
          purpose: `Mission advisory assignment: ${objective}`,
          specialization: role,
          lifetime: "ephemeral",
          budgets: {
            runs: 1,
            tool_calls: 1,
            model_calls: 1,
            children: 0,
            timeout_ms: 30000,
          },
        },
        actionId,
      );
      id = worker.id;
      const { row, agent } = await this.row(id);
      agent.source_action_id = actionId;
      agent.missions = [missionId];
      agent.run_keys = [actionId];
      agent.assignments[actionId] = missionId;
      agent.dispatch_keys = [actionId];
      agent.model_keys = [actionId];
      await this.repo.batch([this.patch(row, agent)]);
      await this.event(agent, "delegated", missionId);
    }
    const rows = await this.chain(id);
    this.ensureAlive(rows);
    const agent = rows[0].agent;
    if (
      !agent.capabilities.includes("analyze") ||
      role !== agent.specialization
    )
      throw new AppError("Submission does not match agent specialization", 403);
    const controller = new AbortController(),
      controllerKey = `${this.repo.userId}:${id}`;
    const set = controllers.get(controllerKey) ?? new Set<AbortController>();
    set.add(controller);
    controllers.set(controllerKey, set);
    try {
      await this.event(agent, "running", missionId);
      const signal = AbortSignal.any([
        controller.signal,
        AbortSignal.timeout(agent.budgets.timeout_ms),
      ]);
      const result = await agentExecution.run(
        {
          id,
          userId: this.repo.userId,
          permissionLevel: agent.permission_level,
          tools: [
            ...agent.tool_access,
            "conversation.read",
            "entity.read",
            "activity.read",
            ...(agent.memory_scope === "mission" ? ["memory.read"] : []),
          ],
          check: async () => this.ensureAlive(await this.chain(id!)),
        },
        () =>
          this.board.submitMission(role, objective, missionId, {
            model: this.models.resolve(agent.model),
            signal,
            memoryIds: agent.memory_scope === "none" ? [] : plan.memory_ids,
          }),
      );
      signal.throwIfAborted();
      this.ensureAlive(await this.chain(id));
      await assertMissionLease(this.repo, missionId);
      await this.event(agent, "completed", missionId);
      return { ...result, agent_id: id, parent_agent_id: agent.parent_id };
    } catch (e) {
      await this.event(agent, "failed", missionId);
      throw e;
    } finally {
      set.delete(controller);
      if (!set.size) controllers.delete(controllerKey);
    }
  }
}
