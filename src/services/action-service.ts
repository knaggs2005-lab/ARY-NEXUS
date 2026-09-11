import { capabilityExplanation } from "../domain/permission-classes";
import {
  actionCancellation,
  registerActionCancellation,
} from "./action-cancellation";
import { NexusEventBus } from "./nexus-event-bus";
import { agentExecution } from "./agent-context";
import type { PresenceEvent } from "../domain/presence";
import { reportPresence } from "./presence-telemetry";
import { actionTelemetryContext } from "./action-telemetry-context";
import type { Repository } from "../domain/repository";
import type { Json, Action } from "../domain/models";
import { AppError } from "../domain/validation";
import { getToolDefinition, type ActionContext } from "../domain/permissions";
import { PermissionService, digest } from "./permission-service";
export class ApprovalRequiredError extends AppError {
  constructor(
    readonly actionId: string,
    readonly tool: string,
  ) {
    super(`Approval required for ${tool}`, 409);
  }
}
/** All effectful work must pass through this server-owned gate. Never accept callbacks from the model or client. */
export class ActionService {
  readonly permissions: PermissionService;
  constructor(
    private repository: Repository,
    private context: ActionContext = { workspace: "ary-nexus", productIds: [] },
  ) {
    this.permissions = new PermissionService(repository);
  }
  async run<T>(
    tool: string,
    conversationId: string | null,
    operation: () => Promise<T>,
    input: Json = {},
    overrides: Partial<
      Pick<ActionContext, "productIds" | "approvalId" | "request">
    > = {},
    audit?: {
      result: (result: T) => Json;
      outcome?: (result: T) =>
        | {
            status: "success" | "failure" | "pending";
            summary: string;
            metadata: Json;
          }
        | undefined;
      metadata?: Json;
      validate?: () => Promise<void>;
      requestKey?: string;
      replay?: (action: Action) => T;
      mutations?: () => import("../domain/repository").Mutation[];
    },
  ) {
    const context = {
      ...this.context,
      ...overrides,
      productIds: [
        ...new Set([
          ...this.context.productIds,
          ...(overrides.productIds ?? []),
        ]),
      ].sort(),
    };
    const report = async (event: PresenceEvent) => {
      reportPresence(event);
      if (!["brain.respond", "memory.extract"].includes(tool)) {
        const bus = new NexusEventBus(this.repository);
        await bus.presence(
          event,
          conversationId ?? event.operation,
          context.productIds[0] ?? null,
          typeof input.plan_id === "string" &&
            /^[0-9a-f-]{36}$/i.test(input.plan_id)
            ? input.plan_id
            : null,
        );
        const domain = tool.startsWith("browser.")
          ? "browser"
          : /^(computer|control)\./.test(tool)
            ? "computer"
            : tool.startsWith("desktop.")
              ? tool.includes("website")
                ? "browser"
                : "computer"
              : tool.startsWith("skill.")
                ? "skill"
                : tool.startsWith("automation.")
                  ? "automation"
                  : tool.startsWith("studio.")
                    ? "device"
                    : null;
        if (domain)
          await bus.record({
            type: `${domain}.${event.terminal ? "result" : "executing"}`,
            source: { kind: "backend", name: "ActionService" },
            correlation_id: conversationId ?? event.operation,
            visibility: "systems",
            payload: {
              action_id: event.operation,
              tool,
              state: event.state,
              terminal: event.terminal,
            },
          });
      }
    };
    let validationError: AppError | null = null;
    try {
      await agentExecution.getStore()?.check();
      await audit?.validate?.();
      if (audit?.requestKey)
        await this.repository.ensureActionExecutionKeys?.();
    } catch (error) {
      validationError =
        error instanceof AppError
          ? error
          : new AppError("Invalid action request", 400);
    }
    const decision = await this.permissions.resolve(tool, context);
    const fingerprint = digest([
      this.repository.userId,
      tool,
      conversationId,
      context.workspace,
      context.productIds,
      context.request ?? null,
      input,
      ...(agentExecution.getStore() ? [agentExecution.getStore()!.id] : []),
    ]);
    // A replay returns an existing result; it never consumes another approval or invokes the tool.
    const replay = async (previous: Action): Promise<T> => {
      const matches = previous.metadata.fingerprint === fingerprint;
      const success = matches && previous.status === "succeeded";
      const error = !matches
        ? "Idempotency key belongs to different inputs"
        : previous.status === "requested"
          ? "Action is already running; retry this key later"
          : "Previous attempt failed; inspect it and use a new key to retry";
      const attempt = await this.repository.insert("actions", {
        conversation_id: conversationId,
        tool_name: tool,
        action_type: getToolDefinition(tool)?.actionType ?? "unregistered",
        permission_level: decision.level,
        approval_required: false,
        workspace: context.workspace,
        product_entity_ids: context.productIds,
        status: success ? "succeeded" : "blocked",
        input,
        output: success ? previous.output : {},
        error: success ? null : error,
        metadata: {
          ...audit?.metadata,
          ...(agentExecution.getStore()
            ? { agent_id: agentExecution.getStore()!.id }
            : {}),
          replay_of: previous.id,
          permission_reason: "Idempotent retry; no tool execution",
          fingerprint,
          requesting_agent:
            audit?.metadata?.requesting_agent ?? "authenticated_user",
          requested_key: audit?.requestKey,
        },
      });
      await this.repository.insert("outcomes", {
        action_id: attempt.id,
        goal_id: null,
        status: success ? "success" : "failure",
        summary: success
          ? "Returned a previous result; no new execution"
          : error,
        metrics: {},
        metadata: { replay_of: previous.id },
      });
      if (!success) throw new AppError(error, 409);
      return audit!.replay!(previous);
    };
    if (
      audit?.requestKey &&
      audit.replay &&
      !validationError &&
      (decision.allowed || decision.approvalRequired)
    ) {
      const previous = (await this.repository.list("actions")).find(
        (a) => a.metadata.execution_key === audit.requestKey,
      );
      if (previous) return replay(previous);
    }
    const approvalId =
      context.approvalId ??
      (decision.approvalRequired
        ? (await this.repository.list("action_approvals")).find(
            (a) =>
              a.decision === "approved" &&
              !a.consumed_at &&
              a.fingerprint === fingerprint &&
              a.policy_hash === decision.policyHash &&
              Date.parse(a.expires_at) > Date.now(),
          )?.id
        : undefined);
    const approvalUsed =
      !validationError && decision.approvalRequired && approvalId
        ? await this.repository.consumeApproval(
            approvalId,
            fingerprint,
            decision.policyHash,
          )
        : false;
    const allowed = !validationError && (decision.allowed || approvalUsed);
    const actionData = {
      conversation_id: conversationId,
      tool_name: tool,
      action_type: getToolDefinition(tool)?.actionType ?? "unregistered",
      permission_level: decision.level,
      approval_required: !validationError && decision.approvalRequired,
      workspace: context.workspace,
      product_entity_ids: context.productIds,
      status: validationError
        ? decision.level === 0
          ? "blocked"
          : "failed"
        : allowed
          ? "requested"
          : decision.approvalRequired
            ? "approval_required"
            : "blocked",
      input: { ...input, request: context.request ?? null },
      output: {},
      error: validationError?.message ?? null,
      metadata: {
        ...audit?.metadata,
        ...(agentExecution.getStore()
          ? { agent_id: agentExecution.getStore()!.id }
          : {}),
        requesting_agent: audit?.metadata?.requesting_agent ?? "ary",
        ...(allowed && audit?.requestKey
          ? { execution_key: audit.requestKey }
          : {}),
        permission_explanation: capabilityExplanation(
          tool,
          getToolDefinition(tool),
        ),
        telemetry_scope: "action-v1",
        permission_reason: decision.reason,
        matched_policy_ids: decision.matchedPolicyIds,
        policy_hash: decision.policyHash,
        fingerprint,
        approval_id: approvalUsed ? approvalId : null,
      },
    } satisfies import("../domain/models").NewRecord<Action>;
    let action: Action;
    try {
      action = await this.repository.insert("actions", actionData);
    } catch (error) {
      if (
        audit?.requestKey &&
        audit.replay &&
        error instanceof AppError &&
        error.status === 409
      ) {
        const previous = (await this.repository.list("actions")).find(
          (a) => a.metadata.execution_key === audit.requestKey,
        );
        if (previous) return replay(previous);
      }
      throw error;
    }
    if (validationError) {
      await report({
        operation: action.id,
        state: "error",
        label: `${tool}: invalid request`,
        terminal: true,
      });
      await this.repository.insert("outcomes", {
        action_id: action.id,
        goal_id: null,
        status: "failure",
        summary: `${tool} rejected before approval: ${validationError.message}`,
        metrics: {},
        metadata: {},
      });
      throw validationError;
    }
    if (!allowed) {
      await report({
        operation: action.id,
        state: decision.approvalRequired ? "approval" : "error",
        label: `${tool}: ${decision.approvalRequired ? "approval required" : "blocked"}`,
        terminal: true,
      });
      await this.repository.insert("outcomes", {
        action_id: action.id,
        goal_id: null,
        status: decision.approvalRequired ? "pending" : "failure",
        summary: decision.approvalRequired
          ? `${tool} awaits approval`
          : `${tool} blocked by permission policy`,
        metrics: {},
        metadata: {},
      });
      if (decision.approvalRequired)
        throw new ApprovalRequiredError(action.id, tool);
      throw new AppError(
        `Action ${tool} is not permitted: ${decision.reason}`,
        403,
      );
    }
    const cancellation = registerActionCancellation(this.repository.userId);
    let timer: ReturnType<typeof setInterval> | null = null;
    const checkAuthority = async () => {
      const latest = await this.permissions.resolve(tool, context);
      if (
        latest.policyHash !== decision.policyHash ||
        !(latest.allowed || (latest.approvalRequired && approvalUsed))
      )
        throw new AppError(
          "Permissions changed before execution or commit; review and retry",
          403,
        );
      if (cancellation.controller.signal.aborted && decision.mode !== "observe")
        throw new AppError("Emergency stop requested before commit", 403);
    };
    try {
      let polling = false;
      const initialStop = await this.permissions.emergencyStatus();
      timer =
        decision.mode !== "observe" &&
        ![
          "phone.cancel",
          "agent.terminate",
          "browser.close",
          "worker.cancel",
        ].includes(tool)
          ? setInterval(() => {
              if (polling) return;
              polling = true;
              void this.permissions
                .emergencyStatus()
                .then((state) => {
                  if (state.active || state.revision !== initialStop.revision)
                    cancellation.controller.abort(
                      new Error("Emergency stop requested"),
                    );
                })
                .catch(() =>
                  cancellation.controller.abort(
                    new Error("Cannot verify emergency state"),
                  ),
                )
                .finally(() => {
                  polling = false;
                });
            }, 1000)
          : null;
      timer?.unref();
      await report({
        operation: action.id,
        state: tool.startsWith("orchestrator.") ? "mission" : "acting",
        label: `${tool}: executing`,
      });
      await checkAuthority();
      const result = await actionCancellation.run(
        cancellation.controller.signal,
        () => actionTelemetryContext.run(action.id, operation),
      );
      const mutations = audit?.mutations?.() ?? [];
      // Only staged internal writes can be rolled back. Record completed external receipts honestly.
      if (mutations.length) await checkAuthority();
      const outcome = audit?.outcome?.(result);
      await this.repository.batch([
        ...mutations,
        {
          kind: "update",
          table: "actions",
          id: action.id,
          data: {
            status: "succeeded",
            output: audit ? audit.result(result) : { completed: true },
          },
        },
        {
          kind: "insert",
          table: "outcomes",
          data: {
            action_id: action.id,
            goal_id: null,
            status: "success",
            summary: `${tool} completed`,
            metrics: {},
            ...outcome,
            metadata: {
              ...outcome?.metadata,
              ...(cancellation.controller.signal.aborted
                ? {
                    cancellation_requested: true,
                    cancellation_note:
                      "An effect completed despite the stop request; receipt retained.",
                  }
                : {}),
            },
          },
        },
      ]);
      await report({
        operation: action.id,
        state: "complete",
        label: `${tool}: result recorded`,
        terminal: true,
      });
      return result;
    } catch (error) {
      await report({
        operation: action.id,
        state: "error",
        label: `${tool}: failed`,
        terminal: true,
      });
      await this.repository.update("actions", action.id, {
        status: "failed",
        error:
          error instanceof AppError
            ? error.message
            : "Operation failed; inspect server logs",
      });
      await this.repository.insert("outcomes", {
        action_id: action.id,
        goal_id: null,
        status: "failure",
        summary: `${tool} failed`,
        metrics: {},
        metadata: {},
      });
      throw error;
    } finally {
      if (timer) clearInterval(timer);
      cancellation.release();
    }
  }
}
