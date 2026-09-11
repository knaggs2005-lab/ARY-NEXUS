import { orchestrationControlRecord } from "./orchestration-control";
import type { ExecutionPlan } from "../domain/orchestration";
import {
  capabilityClasses,
  emergencyScope,
} from "../domain/permission-classes";
import { abortOwnerActions, stopOwnerControl } from "./action-cancellation";
import { createHash } from "node:crypto";
import { agentExecution } from "./agent-context";
import type { Repository } from "../domain/repository";
import { AppError, required } from "../domain/validation";
import {
  policyInput,
  toolRegistry,
  getToolDefinition,
  type ActionContext,
  type PermissionPolicy,
  type PermissionDecision,
  type PermissionLevel,
} from "../domain/permissions";
export const digest = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export class PermissionService {
  constructor(private repo: Repository) {}
  async ownerAction<T>(
    tool: string,
    input: Record<string, unknown>,
    operation: () => Promise<T>,
  ) {
    const requester = agentExecution.getStore();
    const action = await this.repo.insert("actions", {
      tool_name: tool,
      action_type: "permissions",
      conversation_id: null,
      permission_level: requester ? 0 : 5,
      approval_required: false,
      workspace: "ary-nexus",
      product_entity_ids: [],
      status: requester ? "blocked" : "requested",
      input,
      output: {},
      error: null,
      metadata: {
        requesting_agent: requester?.id ?? "authenticated_user",
        ...(requester ? { agent_id: requester.id } : {}),
        reason:
          typeof input.reason === "string"
            ? input.reason
            : "Owner permission administration",
        permission_reason: requester
          ? "Agent denied owner-only permission administration"
          : "Authenticated owner control plane; recovery cannot be disabled by data-plane policies.",
      },
    });
    if (requester) {
      await this.repo.insert("outcomes", {
        action_id: action.id,
        goal_id: null,
        status: "failure",
        summary: "Agent attempted owner-only permission administration",
        metrics: {},
        metadata: {},
      });
      throw new AppError(
        "Only the authenticated owner can administer permissions",
        403,
      );
    }
    try {
      const result = await operation();
      await this.repo.update("actions", action.id, {
        status: "succeeded",
        output: { completed: true },
      });
      return result;
    } catch (error) {
      await this.repo.update("actions", action.id, {
        status: "failed",
        error:
          error instanceof AppError
            ? error.message
            : "Permission change failed",
      });
      throw error;
    }
  }
  async currentPolicies() {
    const all = await this.repo.list("permission_policies");
    const superseded = new Set(all.map((p) => p.parent_id));
    return all.filter((p) => !superseded.has(p.id));
  }
  async savePolicy(raw: unknown) {
    const input = policyInput.parse(raw);
    if (input.subject_user_id && input.subject_user_id !== this.repo.userId)
      throw new AppError(
        "You can only manage permissions for your own account",
        403,
      );
    if (input.tool && !getToolDefinition(input.tool))
      throw new AppError("Only registered tools can receive policies");
    if (
      input.action_type &&
      !Object.values(toolRegistry).some(
        (t) => t.actionType === input.action_type,
      )
    )
      throw new AppError("Unknown action type");
    if (input.product_entity_id) {
      const entity = required(
        await this.repo.get("entities", input.product_entity_id),
        "Scope entity",
      );
      if (!["company", "project", "product"].includes(entity.entity_type))
        throw new AppError("Scope must be a company, project or product");
    }
    if (input.subject_agent_id) {
      const agent = await this.repo.get("messages", input.subject_agent_id);
      if (!agent || agent.metadata.agent_version !== "agent-v1")
        throw new AppError(
          "Permission agent must be an owned registered agent",
          403,
        );
    }
    const scope_key = digest([
      input.tool,
      input.action_type,
      input.workspace,
      input.product_entity_id,
      input.subject_user_id,
      ...(input.permission_class || input.subject_agent_id
        ? [input.permission_class ?? null, input.subject_agent_id ?? null]
        : []),
    ]);
    const existing = (await this.currentPolicies()).find(
      (p) => p.scope_key === scope_key,
    );
    if ((existing?.id ?? null) !== input.parent_id)
      throw new AppError("Policy changed; reload and retry", 409);
    return this.repo.insert("permission_policies", {
      ...input,
      level: (input.behavior === "deny"
        ? 0
        : input.behavior
          ? 5
          : input.level) as PermissionLevel,
      scope_key,
    });
  }
  async resolve(
    tool: string,
    context: ActionContext,
  ): Promise<PermissionDecision> {
    const definition = getToolDefinition(tool);
    const policies = await this.currentPolicies();
    const emergency = policies.find((p) => p.scope_key === emergencyScope);
    const agent = agentExecution.getStore();
    const classes = capabilityClasses(tool, definition);
    const stopped =
      emergency?.enabled &&
      definition?.mode !== "observe" &&
      ![
        "phone.cancel",
        "agent.terminate",
        "browser.close",
        "worker.cancel",
      ].includes(tool);
    const matched = policies
      .filter(
        (p) =>
          p.scope_key !== emergencyScope &&
          p.enabled &&
          (!p.permission_class || classes.includes(p.permission_class)) &&
          (!p.subject_agent_id ||
            (agent?.userId === this.repo.userId &&
              p.subject_agent_id === agent.id)) &&
          (!p.tool ||
            p.tool === tool ||
            p.tool === definition?.permissionParent) &&
          (!p.action_type || p.action_type === definition?.actionType) &&
          (!p.workspace || p.workspace === context.workspace) &&
          (!p.subject_user_id || p.subject_user_id === this.repo.userId) &&
          (!p.product_entity_id ||
            context.productIds.includes(p.product_entity_id)),
      )
      .sort((a, b) => a.id.localeCompare(b.id));
    const baseLevel = (
      definition && !stopped
        ? matched.length
          ? Math.min(...matched.map((p) => p.level))
          : definition.defaultLevel
        : 0
    ) as PermissionLevel;
    const scope = agent;
    const level = (
      scope
        ? scope.userId === this.repo.userId && scope.tools.includes(tool)
          ? Math.min(baseLevel, scope.permissionLevel)
          : 0
        : baseLevel
    ) as PermissionLevel;
    const mode = definition?.mode ?? "execute";
    const requiredLevel = { observe: 1, recommend: 2, draft: 3, execute: 5 }[
      mode
    ];
    const approvalRequired = Boolean(
      definition &&
      (mode === "execute"
        ? level >= 4 &&
          (level === 4 ||
            definition.alwaysRequiresApproval ||
            matched.some((p) => p.behavior === "ask_every_time"))
        : level >= requiredLevel &&
          (definition.alwaysRequiresApproval ||
            matched.some((p) => p.behavior === "ask_every_time"))),
    );
    return {
      level,
      mode,
      allowed:
        Boolean(definition) && level >= requiredLevel && !approvalRequired,
      approvalRequired,
      matchedPolicyIds: matched.map((p) => p.id),
      policyHash: digest([
        tool,
        definition ?? null,
        context.workspace,
        [...context.productIds].sort(),
        matched.map((p) => [
          p.id,
          p.level,
          ...(p.behavior ? [p.behavior] : []),
        ]),
        ...(emergency ? [[emergency.id, emergency.enabled]] : []),
        ...(scope
          ? [[scope.id, scope.permissionLevel, [...scope.tools].sort()]]
          : []),
      ]),
      reason: stopped
        ? "Emergency stop is active; new non-read work is blocked"
        : matched.some((p) => p.behavior === "ask_every_time") &&
            approvalRequired
          ? `Ask every time: exact one-use approval required at level ${level}`
          : scope
            ? `Agent ${scope.id} ceiling and owner policy: level ${level}`
            : !definition
              ? "Unknown tool: no registered capability"
              : matched.length
                ? `Most restrictive of ${matched.length} matching policies: level ${level}`
                : `Registered capability default: level ${level}`,
    };
  }
  async emergencyStatus() {
    const policy = (await this.currentPolicies()).find(
      (p) => p.scope_key === emergencyScope,
    );
    return {
      active: policy?.enabled ?? false,
      revision: policy?.id ?? null,
      reason: policy?.reason ?? null,
      updated_at: policy?.created_at ?? null,
    };
  }
  private async pausePlans() {
    const messages = await this.repo.list("messages");
    const plans = messages
      .filter((m) => m.metadata.orchestrator_version === "orchestrator-v1")
      .map((m) => m.metadata.plan as unknown as ExecutionPlan)
      .filter((p) => p && !["complete", "stopped"].includes(p.status));
    // Preserve the coordinator's own durable pause format and resume semantics.
    for (const plan of plans)
      await this.repo.insert(
        "messages",
        orchestrationControlRecord(plan, "pause", messages),
      );
  }
  async setEmergencyStop(
    active: boolean,
    reason: string,
    revision: string | null,
  ) {
    if (agentExecution.getStore())
      throw new AppError(
        "Only the authenticated owner can change emergency stop",
        403,
      );
    if (!reason.trim() || reason.length > 1000)
      throw new AppError("A reason is required");
    const current = await this.emergencyStatus();
    if (current.revision !== revision)
      throw new AppError("Emergency state changed; reload and retry", 409);
    // Reconcile pauses before clearing the latch; failed recovery stays stopped.
    if (!active && current.active) await this.pausePlans();
    if (current.active !== active)
      await this.repo.insert("permission_policies", {
        scope_key: emergencyScope,
        parent_id: current.revision,
        enabled: active,
        tool: null,
        action_type: null,
        workspace: null,
        product_entity_id: null,
        subject_user_id: null,
        level: 0,
        reason: reason.trim(),
      });
    if (active) {
      abortOwnerActions(this.repo.userId);
      await this.pausePlans();
      await stopOwnerControl(this.repo.userId);
    }
    return this.emergencyStatus();
  }
  async review(
    actionId: string,
    decision: "approved" | "rejected",
    reason: string,
  ) {
    const action = required(await this.repo.get("actions", actionId), "Action");
    if (action.status !== "approval_required")
      throw new AppError("This action is not awaiting approval", 409);
    if (!reason.trim() || reason.length > 1000)
      throw new AppError("A review reason is required");
    const metadata = action.metadata;
    return this.repo.insert("action_approvals", {
      action_id: action.id,
      decision,
      reason: reason.trim(),
      fingerprint: String(metadata.fingerprint),
      policy_hash: String(metadata.policy_hash),
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      consumed_at: null,
    });
  }
}
