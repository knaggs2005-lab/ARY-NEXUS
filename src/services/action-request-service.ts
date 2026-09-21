import { EntityService } from "./entity-service";
import { validateCommunicationRequest } from "./communication-planning-service";
import { actionCancellation } from "./action-cancellation";
import type { PerceptionService } from "./perception-service";
import { registerPerceptionTools } from "../infrastructure/tools/perception-tools";
import { StudioService } from "./studio-service";
import { registerStudioTools } from "../infrastructure/tools/studio-tools";
import { registerDesignTools } from "../infrastructure/tools/design-tools";
import { Cinema4DDesignTool } from "../infrastructure/design/bridge";
import type { DesignTool } from "../domain/design-tool";
import { registerEditTools } from "../infrastructure/tools/edit-tools";
import { callInput } from "../domain/phone";
import type { PremiereProvider } from "../domain/premiere";
import { UxpPremiereProvider } from "../infrastructure/premiere/bridge";
import { registerPremiereTools } from "../infrastructure/tools/premiere-tools";
import { PhoneService } from "./phone-service";
import { TwilioPhoneProvider } from "../infrastructure/phone/twilio-phone";
import { registerPhoneTools } from "../infrastructure/tools/phone-tools";
import type { DesktopProvider } from "../domain/desktop";
import { MacDesktopProvider } from "../infrastructure/desktop/mac-desktop";
import { assertDesktopAccess } from "../infrastructure/desktop/security";
import { registerDesktopTools } from "../infrastructure/tools/desktop-tools";
import { registerFinanceTools } from "../infrastructure/tools/finance-tools";
import { financeImport, financeQuery } from "../domain/finance";
import { financialLinks } from "./finance-service";
import { registerGmailTools } from "../infrastructure/tools/gmail-tools";
import type { GmailService } from "./gmail-service";
import { registerCalendarTools } from "../infrastructure/tools/calendar-tools";
import { z } from "zod";
import { registerUpdateProjectStatus } from "../infrastructure/tools/update-project-status";
import { projectUpdateInput } from "../domain/project-actions";
import { registerUpdateTask } from "../infrastructure/tools/update-task";
import { taskUpdateInput } from "../domain/task-actions";
import { registerCreateTask } from "../infrastructure/tools/create-task";
import type { Mutation } from "../domain/repository";
import type { Repository } from "../domain/repository";
import { ToolRegistry } from "../domain/tool-registry";
import { AppError, required } from "../domain/validation";
import { createMockToolRegistry } from "../infrastructure/tools/mock-tools";
import type { MemoryService } from "./memory-service";
import { digest } from "./permission-service";
import { ActionService } from "./action-service";
import { actionTelemetryContext } from "./action-telemetry-context";

export const actionRequestInput = z
  .object({
    tool: z.string().trim().min(1).max(120),
    input: z.record(z.string(), z.unknown()).default({}),
    product_entity_id: z.uuid().nullable().default(null),
    conversation_id: z.uuid().nullable().default(null),
    source_message_id: z.uuid().nullable().optional(),
    source_action_id: z.uuid().optional(),
    reason: z
      .string()
      .trim()
      .min(1)
      .max(1000)
      .default("User requested this action."),
    related_entity_ids: z.array(z.uuid()).max(20).default([]),
    related_memory_ids: z.array(z.uuid()).max(20).default([]),
    request_key: z.string().trim().min(8).max(128).optional(),
  })
  .strict();

// JSONB may reorder object keys; approval/retry fingerprints must survive queue persistence.
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}

export function createActionToolRegistry(
  repository: Repository,
  gmail?: GmailService,
  actions?: ActionService,
  desktop: DesktopProvider = new MacDesktopProvider(repository.userId, () =>
    assertDesktopAccess(repository.userId, false),
  ),
  phone: PhoneService = new PhoneService(repository, new TwilioPhoneProvider()),
  premiere: PremiereProvider = new UxpPremiereProvider(repository.userId),
  design: DesignTool = new Cinema4DDesignTool(repository.userId),
  studio: StudioService = new StudioService(repository.userId),
  perception?: PerceptionService,
) {
  const registry = registerPremiereTools(
    registerPhoneTools(
      registerDesktopTools(
        registerFinanceTools(
          registerGmailTools(
            registerCalendarTools(
              registerUpdateProjectStatus(
                registerUpdateTask(
                  registerCreateTask(
                    process.env.NODE_ENV === "production"
                      ? new ToolRegistry()
                      : createMockToolRegistry(),
                    repository,
                  ),
                  repository,
                ),
                repository,
              ),
              repository,
            ),
            repository,
            gmail,
          ),
          repository,
          actions,
        ),
        desktop,
      ),
      phone,
    ),
    premiere,
    actions ?? new ActionService(repository),
  );
  if (perception)
    registerPerceptionTools(
      registry,
      perception,
      actions ?? new ActionService(repository),
    );
  registerStudioTools(
    registry,
    repository,
    actions ?? new ActionService(repository),
    studio,
  );
  return registerEditTools(
    registerDesignTools(
      registry,
      design,
      actions ?? new ActionService(repository),
    ),
    repository,
    actions ?? new ActionService(repository),
    premiere,
  );
}
/** Client requests name capabilities; they cannot supply handlers, authority, or tenant identity. */
export class ActionRequestService {
  constructor(
    private readonly repository: Repository,
    private readonly actions: ActionService,
    private readonly tools: ToolRegistry = createActionToolRegistry(
      repository,
      undefined,
      actions,
    ),
    private readonly memories?: Pick<MemoryService, "createMemory">,
    private readonly requestingAgent:
      "authenticated_user" | "ary_orchestrator" = "authenticated_user",
  ) {}

  async catalog() {
    return Promise.all(
      this.tools.describe().map(async (tool) => ({
        ...tool,
        permission: await this.actions.permissions.resolve(tool.name, {
          workspace: "ary-nexus",
          productIds: [],
        }),
      })),
    );
  }

  private async validateReferences(
    request: ReturnType<typeof actionRequestInput.parse>,
  ) {
    const entityIds = new Set(request.related_entity_ids);
    if (request.tool.startsWith("communications.")) {
      if (typeof request.input.project_id === "string")
        entityIds.add(request.input.project_id);
      if (
        request.tool === "communications.plan" &&
        typeof request.input.contact === "string"
      ) {
        const contact = await new EntityService(this.repository).findEntity(
          request.input.contact,
        );
        if (contact) entityIds.add(contact.id);
      }
      if (
        request.tool === "communications.debrief" &&
        typeof request.input.source_action_id === "string"
      ) {
        const source = required(
          await this.repository.get("actions", request.input.source_action_id),
          "Communication source",
        );
        for (const id of [
          ...(source.product_entity_ids ?? []),
          ...((source.metadata.related_entity_ids as string[]) ?? []),
        ])
          entityIds.add(id);
      }
    }

    if (request.tool.startsWith("worker.")) {
      if (typeof request.input.project === "string")
        entityIds.add(request.input.project);
      if (typeof request.input.job_id === "string") {
        const source = required(
          await this.repository.get("messages", request.input.job_id),
          "Delegated job",
        );
        if (source.metadata.worker_version !== "delegated-job-v1")
          throw new AppError("Invalid delegated job", 404);
        const project = (source.metadata.job as { project?: string | null })
          .project;
        if (project) entityIds.add(project);
      }
    }
    // A deleted memory no longer has join rows. Preserve the committed scope on replay;
    // ActionService still compares the complete original request fingerprint before returning anything.
    if (request.tool === "memory.delete_record" && request.request_key) {
      const receipt = (await this.repository.list("actions")).find(
        (a) =>
          a.tool_name === request.tool &&
          a.metadata.execution_key === request.request_key &&
          a.status === "succeeded",
      );
      for (const id of receipt?.product_entity_ids ?? []) entityIds.add(id);
    }
    if (
      request.tool.startsWith("memory.") ||
      request.tool.startsWith("knowledge.")
    ) {
      if (Array.isArray(request.input.entity_ids))
        for (const id of request.input.entity_ids)
          if (typeof id === "string") entityIds.add(id);
      const ids = new Set<string>();
      if (
        typeof request.input.id === "string" &&
        request.tool.startsWith("memory.")
      )
        ids.add(request.input.id);
      if (Array.isArray(request.input.sources))
        for (const source of request.input.sources)
          if (
            source &&
            typeof source === "object" &&
            typeof source.id === "string"
          )
            ids.add(source.id);
      if (ids.size)
        for (const link of await this.repository.list("memory_entities"))
          if (ids.has(link.memory_id)) entityIds.add(link.entity_id);
    }
    if (
      [
        "orchestrator.advance",
        "orchestrator.remember",
        "orchestrator.replan",
        "orchestrator.review_steps",
      ].includes(request.tool) &&
      typeof request.input.plan_id === "string"
    ) {
      const message = required(
        await this.repository.get("messages", request.input.plan_id),
        "Plan",
      );
      if (message.metadata.orchestrator_version !== "orchestrator-v1")
        throw new AppError("Not an execution plan", 404);
      const ids = (message.metadata.plan as { entity_ids?: unknown })
        ?.entity_ids;
      if (Array.isArray(ids))
        for (const id of ids) if (typeof id === "string") entityIds.add(id);
    }

    if (
      ["mission.control", "mission.submit", "mission.tick"].includes(
        request.tool,
      ) &&
      typeof request.input.mission_id === "string"
    ) {
      const message = required(
        await this.repository.get("messages", request.input.mission_id),
        "Mission",
      );
      const plan = message.metadata
        .plan as unknown as import("../domain/orchestration").ExecutionPlan;
      if (!plan?.mission) throw new AppError("Not a durable mission", 404);
      for (const id of plan.entity_ids) entityIds.add(id);
    }
    if (
      request.tool === "task.inspect" &&
      typeof request.input.task_id === "string"
    ) {
      const task = required(
        await this.repository.get("tasks", request.input.task_id),
        "Task",
      );
      if (task.entity_id) entityIds.add(task.entity_id);
    }
    if (
      request.tool === "perception.analyze" &&
      typeof request.input.related_action_id === "string"
    ) {
      const source = required(
        await this.repository.get("actions", request.input.related_action_id),
        "Visual evidence action",
      );
      for (const id of source.product_entity_ids ?? []) entityIds.add(id);
    }
    if (request.tool === "phone.initiate") {
      const parsed = callInput.safeParse(request.input);
      if (parsed.success) {
        for (const id of parsed.data.entity_ids) entityIds.add(id);
        if (parsed.data.contact_entity_id)
          entityIds.add(parsed.data.contact_entity_id);
      }
    }
    if (
      ["phone.refresh", "phone.cancel"].includes(request.tool) &&
      typeof request.input.call_action_id === "string"
    ) {
      const call = required(
        await this.repository.get("actions", request.input.call_action_id),
        "Call action",
      );
      if (call.tool_name !== "phone.initiate" || call.status !== "succeeded")
        throw new AppError("Use a completed call-initiation action", 400);
      for (const id of (call.metadata.related_entity_ids as string[]) ?? [])
        entityIds.add(id);
    }
    if (request.tool === "studio.execute_scene") {
      const source = required(
        await this.repository.get(
          "actions",
          String(request.input.plan_action_id),
        ),
        "Studio plan",
      );
      if (
        source.tool_name !== "studio.plan_scene" ||
        source.status !== "succeeded" ||
        request.source_action_id !== source.id
      )
        throw new AppError(
          "Use an owned studio plan with its source action",
          400,
        );
      for (const id of [
        ...(source.product_entity_ids ?? []),
        ...((source.metadata.related_entity_ids as string[]) ?? []),
      ])
        entityIds.add(id);
    } else if (
      request.source_action_id &&
      ["edit.prepare_marker", "premiere.create_markers"].includes(request.tool)
    ) {
      const source = required(
        await this.repository.get("actions", request.source_action_id),
        "Edit plan action",
      );
      if (source.tool_name !== "edit.plan" || source.status !== "succeeded")
        throw new AppError("Use an owned successful edit plan", 400);
      if (
        request.tool === "edit.prepare_marker" &&
        request.input.plan_action_id !== source.id
      )
        throw new AppError("Edit source action mismatch", 400);
      for (const id of [
        ...(source.product_entity_ids ?? []),
        ...((source.metadata.related_entity_ids as string[]) ?? []),
      ])
        entityIds.add(id);
    } else if (request.source_action_id) {
      const communicationLinks = await validateCommunicationRequest(
        this.repository,
        this.actions,
        request.source_action_id,
        request.tool,
        request.input,
      );
      if (communicationLinks) {
        for (const id of communicationLinks) entityIds.add(id);
      } else {
        if (request.tool !== "create_task")
          throw new AppError(
            "Source action linkage is currently available for follow-up tasks only",
            400,
          );
        const source = required(
          await this.repository.get("actions", request.source_action_id),
          "Source action",
        );
        if (
          !["phone.initiate", "phone.refresh", "phone.cancel"].includes(
            source.tool_name,
          ) ||
          source.status !== "succeeded"
        )
          throw new AppError("Follow-up requires a recorded call result", 400);
        for (const id of (source.metadata.related_entity_ids as string[]) ?? [])
          entityIds.add(id);
      }
    }
    if (request.tool === "finance.import" || request.tool === "finance.read") {
      const query =
        request.tool === "finance.read"
          ? financeQuery.parse(request.input)
          : null;
      const entries =
        request.tool === "finance.import"
          ? [financeImport.parse(request.input)]
          : (await this.repository.list("finance_snapshots")).filter(
              (r) => !query?.account_key || r.account_key === query.account_key,
            );
      for (const entry of entries) {
        const links = financialLinks(entry);
        for (const id of links.entityIds) entityIds.add(id);
        for (const id of links.goalIds) {
          const goal = required(
            await this.repository.get("goals", id),
            "Financial goal",
          );
          if (goal.entity_id) entityIds.add(goal.entity_id);
        }
      }
    }
    if (
      request.tool === "gmail.send" &&
      typeof request.input.draft_action_id === "string"
    ) {
      const draft = required(
        await this.repository.get("actions", request.input.draft_action_id),
        "Mail draft",
      );
      const result = draft.output.result as Record<string, unknown>;
      if (
        draft.status !== "succeeded" ||
        draft.tool_name !== "gmail.draft" ||
        result.connection_id !== request.input.connection_id ||
        result.from_account !== request.input.from_account ||
        result.source_thread_id !== request.input.source_thread_id
      )
        throw new AppError(
          "Send must refer to a completed draft from this Gmail connection and conversation",
          409,
        );
      for (const id of (result.related_entity_ids as string[]) || [])
        entityIds.add(id);
    }
    if (
      request.tool === "gmail.evidence" &&
      typeof request.input.analysis_action_id === "string"
    ) {
      const source = required(
        await this.repository.get("actions", request.input.analysis_action_id),
        "Mail analysis",
      );
      if (
        source.status !== "succeeded" ||
        source.tool_name !== "gmail.summarize"
      )
        throw new AppError("Use a completed Gmail summary", 409);
      const result = source.output.result as {
        thread?: { entities?: { id: string }[] };
      };
      for (const entity of result.thread?.entities || [])
        entityIds.add(entity.id);
    }
    if (request.tool === "update_project_status") {
      const parsed = projectUpdateInput.safeParse(request.input);
      if (parsed.success) {
        for (const id of [
          ...parsed.data.before.blocker_entity_ids,
          ...(parsed.data.changes.blocker_entity_ids ?? []),
        ])
          entityIds.add(id);
        for (const id of new Set([
          ...parsed.data.before.goal_ids,
          ...(parsed.data.changes.goal_ids ?? []),
        ])) {
          const goal = required(
            await this.repository.get("goals", id),
            "Linked goal",
          );
          if (goal.entity_id && goal.entity_id !== parsed.data.project_id)
            throw new AppError("Goal already belongs to another entity", 409);
        }
      }
    }
    if (request.tool === "update_task") {
      const parsed = taskUpdateInput.safeParse(request.input);
      if (parsed.success) {
        const { before, changes } = parsed.data;
        for (const id of [
          ...before.related_entity_ids,
          ...(changes.related_entity_ids ?? []),
          before.entity_id,
          changes.project_id,
        ])
          if (id) entityIds.add(id);
      }
    }
    if (request.product_entity_id) entityIds.add(request.product_entity_id);
    if (
      typeof request.input.project_id === "string" &&
      z.uuid().safeParse(request.input.project_id).success
    )
      entityIds.add(request.input.project_id);
    if (
      typeof request.input.task_id === "string" &&
      z.uuid().safeParse(request.input.task_id).success
    ) {
      const task = required(
        await this.repository.get("tasks", request.input.task_id),
        "Task",
      );
      if (task.entity_id && request.tool !== "update_task")
        entityIds.add(task.entity_id);
    }
    for (const id of request.related_memory_ids) {
      required(await this.repository.get("memories", id), "Related memory");
      for (const link of await this.repository.list("memory_entities", {
        memory_id: id,
      }))
        entityIds.add(link.entity_id);
    }
    const productIds: string[] = [];
    for (const id of entityIds) {
      const entity = required(
        await this.repository.get("entities", id),
        "Related entity",
      );
      if (["company", "project", "product"].includes(entity.entity_type))
        productIds.push(id);
      else if (
        id === request.product_entity_id ||
        id === request.input.project_id
      )
        throw new AppError("Scope must be a company, project or product");
    }
    // Match the existing HTTP boundary's current one-hop product scope when
    // the same real request originates inside Chat (which has no product in its HTTP body).
    if (
      ["create_task", "update_task", "update_project_status"].includes(
        request.tool,
      )
    ) {
      const roots = new Set(productIds);
      const neighbors = new Set<string>();
      for (const edge of await this.repository.list("relationships")) {
        if (
          !edge.valid_to &&
          (roots.has(edge.source_entity_id) || roots.has(edge.target_entity_id))
        ) {
          neighbors.add(edge.source_entity_id);
          neighbors.add(edge.target_entity_id);
        }
      }
      for (const id of neighbors) {
        const entity = await this.repository.get("entities", id);
        if (
          entity &&
          ["company", "project", "product"].includes(entity.entity_type) &&
          !roots.has(id)
        )
          productIds.push(id);
      }
    }
    if (request.conversation_id)
      required(
        await this.repository.get("conversations", request.conversation_id),
        "Conversation",
      );
    return { entityIds: [...entityIds].sort(), productIds: productIds.sort() };
  }

  async request(raw: unknown, revisionOf?: string) {
    const request = actionRequestInput.parse(canonical(raw));
    // Keep foreign identifiers out of action FKs; invalid envelopes are HTTP errors before dispatch.
    const { entityIds, productIds } = await this.validateReferences(request);
    const envelope = canonical(request) as typeof request;
    const staged: Mutation[] = [];
    const simulated =
      !request.tool.startsWith("mcp.") &&
      !request.tool.startsWith("google_calendar.") &&
      !request.tool.startsWith("gmail.") &&
      !request.tool.startsWith("finance.") &&
      !request.tool.startsWith("desktop.") &&
      !request.tool.startsWith("browser.") &&
      !request.tool.startsWith("computer.") &&
      !request.tool.startsWith("control.") &&
      !request.tool.startsWith("phone.") &&
      !request.tool.startsWith("premiere.") &&
      !request.tool.startsWith("design.") &&
      !request.tool.startsWith("studio.") &&
      !request.tool.startsWith("perception.") &&
      !request.tool.startsWith("orchestrator.") &&
      !request.tool.startsWith("mission.") &&
      !request.tool.startsWith("agent.") &&
      !request.tool.startsWith("worker.") &&
      !request.tool.startsWith("development.") &&
      !request.tool.startsWith("memory.") &&
      !request.tool.startsWith("outcome.") &&
      !request.tool.startsWith("skill.") &&
      !request.tool.startsWith("automation.") &&
      !request.tool.startsWith("knowledge.") &&
      !request.tool.startsWith("communications.") &&
      request.tool !== "task.inspect" &&
      !request.tool.startsWith("edit.") &&
      !["create_task", "update_task", "update_project_status"].includes(
        request.tool,
      );
    return this.actions.run(
      request.tool,
      request.conversation_id,
      async () => ({
        action_id: actionTelemetryContext.getStore()!,
        tool: request.tool,
        result: await this.tools.execute(request.tool, request.input, {
          signal: actionCancellation.getStore(),
          userId: this.repository.userId,
          productIds,
          conversationId: request.conversation_id,
          actionId: actionTelemetryContext.getStore(),
          requestKey: request.request_key,
          agentId: agentExecution.getStore()?.id,
          sourceMessageId: request.source_message_id,
          sourceActionId: request.source_action_id,
          entityIds,
          memoryIds: request.related_memory_ids,
          reason: request.reason,
          stage: (mutations) => staged.push(...mutations),
        }),
      }),
      // Reason and references are part of the exact approved request, not merely display labels.
      { ...request.input, action_request: envelope },
      {
        productIds,
        request: {
          method: "POST",
          path: "/api/actions/request",
          body_hash: digest(envelope),
        },
      },
      {
        result: ({ result }) => ({ completed: true, result }),
        mutations: () => staged,
        outcome: ({ result }) =>
          request.tool.startsWith("development.")
            ? {
                status:
                  result.passed === false || result.ready === false
                    ? "failure"
                    : "success",
                summary: `${request.tool}: ${String(result.phase ?? "evidence recorded")}; no merge performed`,
                metadata: { run_id: result.run_id ?? null, merged: false },
              }
            : request.tool.startsWith("worker.") && result.job
              ? {
                  status:
                    (result.job as { status: string }).status === "COMPLETED"
                      ? "success"
                      : ["FAILED", "TIMED_OUT", "CANCELLED"].includes(
                            (result.job as { status: string }).status,
                          )
                        ? "failure"
                        : "pending",
                  summary: `Delegated job ${(result.job as { id: string }).id}: ${(result.job as { status: string }).status}`,
                  metadata: {
                    job_id: (result.job as { id: string }).id,
                    provider: (result.job as { provider: string }).provider,
                  },
                }
              : request.tool === "studio.execute_scene"
                ? {
                    status:
                      result.status === "success"
                        ? (result.readiness as { status?: string } | undefined)
                            ?.status === "not_ready"
                          ? "failure"
                          : (
                                result.readiness as
                                  { status?: string } | undefined
                              )?.status === "unverified"
                            ? "pending"
                            : "success"
                        : result.status === "uncertain"
                          ? "pending"
                          : "failure",
                    summary: `Studio scene ${String(result.scene_id)}: ${String(result.status)}`,
                    metadata: {
                      studio_status: result.status,
                      plan_id: result.plan_id,
                      device_results: result.steps,
                      readiness: result.readiness ?? null,
                    },
                  }
                : undefined,
        validate: async () => {
          this.tools.validate(request.tool, request.input);
          await this.tools.prepare(request.tool);
          if (
            (request.tool.startsWith("mcp.") ||
              request.tool.startsWith("desktop.") ||
              request.tool.startsWith("browser.") ||
              request.tool.startsWith("computer.") ||
              request.tool.startsWith("control.") ||
              request.tool.startsWith("phone.") ||
              request.tool.startsWith("studio.") ||
              request.tool.startsWith("perception.") ||
              request.tool.startsWith("orchestrator.") ||
              request.tool.startsWith("mission.") ||
              request.tool.startsWith("agent.") ||
              request.tool.startsWith("worker.") ||
              request.tool.startsWith("development.") ||
              request.tool.startsWith("memory.") ||
              request.tool.startsWith("knowledge.") ||
              request.tool.startsWith("outcome.") ||
              request.tool.startsWith("skill.") ||
              request.tool.startsWith("automation.") ||
              request.tool.startsWith("communications.")) &&
            !request.request_key
          )
            throw new AppError(
              "This action requires an idempotency request key",
              400,
            );
          if (
            [
              "google_calendar.create",
              "google_calendar.update",
              "finance.import",
              "gmail.send",
              "gmail.evidence",
            ].includes(request.tool) &&
            !request.request_key
          )
            throw new AppError(
              "External writes and evidence capture require a request key",
              400,
            );
          if (
            ["create_task", "update_task", "update_project_status"].includes(
              request.tool,
            ) &&
            !request.request_key
          )
            throw new AppError("Real internal actions require a request key");
          if (request.source_message_id) {
            const source = required(
              await this.repository.get("messages", request.source_message_id),
              "Source message",
            );
            if (
              source.role !== "user" ||
              source.conversation_id !== request.conversation_id
            )
              throw new AppError(
                "Source must be a user message from this conversation",
              );
          }
        },
        requestKey: request.request_key,
        replay: (action) => ({
          action_id: action.id,
          tool: action.tool_name,
          result: action.output.result as Record<string, unknown>,
        }),
        metadata: {
          request_envelope: envelope,
          reason: request.reason,
          requesting_agent:
            agentExecution.getStore()?.id ?? this.requestingAgent,
          ...(agentExecution.getStore()
            ? { agent_id: agentExecution.getStore()!.id }
            : {}),
          related_entity_ids: entityIds,
          related_memory_ids: request.related_memory_ids,
          revision_of: revisionOf ?? null,
          model_cost_usd: null,
          model_cost_reason:
            request.tool.startsWith("mission.") ||
            request.tool === "skill.propose" ||
            request.tool === "communications.debrief" ||
            request.tool === "development.review"
              ? "Any model usage is recorded by the existing model_calls telemetry and advisory result metrics"
              : "No model call in tool execution",
          source_message_id: request.source_message_id,
          ...(request.source_action_id
            ? { source_action_id: request.source_action_id }
            : {}),
          simulated,
          external:
            request.tool.startsWith("google_calendar.") ||
            request.tool.startsWith("gmail.") ||
            request.tool.startsWith("desktop.") ||
            request.tool.startsWith("browser.") ||
            request.tool.startsWith("computer.") ||
            request.tool.startsWith("control.") ||
            request.tool.startsWith("phone.") ||
            request.tool.startsWith("worker.") ||
            request.tool.startsWith("development."),
        },
      },
    );
  }

  async revise(id: string, raw: unknown) {
    const previous = required(
      await this.repository.get("actions", id),
      "Action",
    );
    if (
      previous.status !== "approval_required" ||
      !previous.metadata.request_envelope
    )
      throw new AppError("Only pending action requests can be modified", 409);
    const request = actionRequestInput.parse(raw);
    this.tools.validate(request.tool, request.input);
    await this.validateReferences(request);
    if (
      !request.request_key ||
      request.request_key ===
        (previous.metadata.request_envelope as Record<string, unknown>)
          .request_key
    )
      throw new AppError("A modified request needs a new request key", 400);
    await this.actions.permissions.ownerAction(
      "permissions.review",
      {
        action_id: id,
        decision: "rejected",
        reason: "Replaced by an edited request",
      },
      () =>
        this.actions.permissions.review(
          id,
          "rejected",
          "Replaced by an edited request; original inputs retained.",
        ),
    );
    return this.request(request, id);
  }

  /** Explicit owner review of an action's memory proposal; no existing fact is rewritten. */
  async remember(id: string) {
    const action = required(await this.repository.get("actions", id), "Action");
    if (action.tool_name.startsWith("development."))
      throw new AppError(
        "Use reviewed Outcome memory for engineering results",
        403,
      );
    if (
      action.status !== "succeeded" ||
      !action.metadata.request_envelope ||
      !action.output.result
    )
      throw new AppError(
        "Only completed action results can be remembered",
        400,
      );
    if (
      action.tool_name.startsWith("design.") ||
      action.tool_name.startsWith("studio.") ||
      action.tool_name.startsWith("perception.") ||
      action.tool_name.startsWith("orchestrator.") ||
      action.tool_name === "task.inspect" ||
      action.tool_name.startsWith("edit.") ||
      action.tool_name.startsWith("premiere.")
    )
      throw new AppError(
        "Creative transcripts and edit decisions remain in source-attributed action history; they are not internal-task memories",
        403,
      );
    if (action.tool_name.startsWith("phone."))
      throw new AppError(
        "Call scripts/transcripts stay in source-attributed call history; they are not automatically permanent memory",
        403,
      );
    if (/^(desktop|browser|computer|control)\./.test(action.tool_name))
      throw new AppError(
        "Desktop content stays in the reviewed action audit; it is not copied to general memory",
        403,
      );
    if (action.tool_name.startsWith("finance."))
      throw new AppError(
        "Financial source records remain in Finance; they cannot be copied into general memory",
        403,
      );
    if (action.tool_name.startsWith("gmail."))
      throw new AppError(
        "Use reviewed Gmail evidence candidates; full email actions cannot be copied into memory",
        403,
      );
    if (!this.memories)
      throw new AppError("Memory service is unavailable", 503);
    const workerJob = action.tool_name.startsWith("worker.")
      ? (
          action.output.result as {
            job?: import("../domain/agent-provider").DelegatedJob;
          }
        ).job
      : null;
    if (
      action.tool_name.startsWith("worker.") &&
      (!workerJob || workerJob.status !== "COMPLETED" || !workerJob.result)
    )
      throw new AppError(
        "Only reviewed completed worker outcomes can be remembered",
        409,
      );
    const simulated = action.metadata.simulated !== false;
    const content = workerJob
      ? `Reviewed delegated ${workerJob.provider} job ${workerJob.id}. Objective: ${workerJob.objective}. Worker-reported result (not independently verified): ${workerJob.result!.summary}`
      : simulated
        ? `Simulation record only — no real task, project or message was changed. Tool ${action.tool_name} returned: ${JSON.stringify(action.output.result)}`
        : action.tool_name.startsWith("google_calendar.")
          ? `Reviewed Google Calendar action ${action.id}: ${JSON.stringify(action.output.result)}`
          : action.tool_name === "update_project_status"
            ? `Updated an internal project. Action ${action.id} committed: ${JSON.stringify(action.output.result)}`
            : `${action.tool_name === "update_task" ? "Updated" : "Created"} an internal task. Action ${action.id} committed: ${JSON.stringify(action.output.result)}`;
    return this.actions.run(
      "memory.create",
      action.conversation_id,
      async () => ({
        memory_id: (
          await this.memories!.createMemory({
            memory_type: "episodic",
            content,
            summary: `Reviewed ${simulated ? "simulation" : "action"}: ${action.tool_name}`,
            importance_score: 0.2,
            confidence_score: 1,
            metadata: {
              origin: "manual",
              action_id: action.id,
              simulated,
              related_memory_ids: action.metadata.related_memory_ids ?? [],
              related_entity_ids: action.metadata.related_entity_ids ?? [],
            },
          })
        ).id,
      }),
      { action_id: id, content },
      {
        productIds: action.product_entity_ids ?? [],
        request: {
          method: "POST",
          path: `/api/actions/${id}/remember`,
          body_hash: digest([id, content]),
        },
      },
      {
        result: (result) => ({ completed: true, result }),
        requestKey: `action-memory:${id}`,
        replay: (previous) => previous.output.result as { memory_id: string },
        metadata: {
          requesting_agent:
            agentExecution.getStore()?.id ?? this.requestingAgent,
          source_action_id: id,
          reason: "Owner accepted the episodic memory proposal",
        },
      },
    );
  }
}
import { agentExecution } from "./agent-context";
