import { randomUUID } from "node:crypto";
import type { Repository, Mutation } from "../../domain/repository";
import type { ToolRegistry } from "../../domain/tool-registry";
import { taskCreationInput } from "../../domain/task-actions";
import { AppError, required } from "../../domain/validation";

/** Stage only. ActionService commits this task and its successful action/outcome together. */
export function registerCreateTask(registry: ToolRegistry, repo: Repository) {
  return registry.register("create_task", {
    inputSchema: taskCreationInput,
    execute: async (input, context) => {
      if (!context.stage || !context.actionId)
        throw new AppError(
          "Task creation requires the transactional action pipeline",
          500,
        );
      const project = required(
        await repo.get("entities", input.project_id),
        "Project",
      );
      if (!["project", "product", "company"].includes(project.entity_type))
        throw new AppError(
          "Related project must be a project, product or company",
        );
      const checks: Mutation[] = [
        {
          kind: "check",
          table: "entities",
          id: project.id,
          expected_updated_at: project.updated_at,
        },
      ];
      for (const id of context.entityIds ?? []) {
        const entity = required(
          await repo.get("entities", id),
          "Related entity",
        );
        checks.push({
          kind: "check",
          table: "entities",
          id,
          expected_updated_at: entity.updated_at,
        });
      }
      for (const id of context.memoryIds ?? []) {
        const memory = required(
          await repo.get("memories", id),
          "Related memory",
        );
        checks.push({
          kind: "check",
          table: "memories",
          id,
          expected_updated_at: memory.updated_at,
        });
      }
      if (context.sourceMessageId) {
        const message = required(
          await repo.get("messages", context.sourceMessageId),
          "Source message",
        );
        if (
          message.role !== "user" ||
          message.conversation_id !== context.conversationId
        )
          throw new AppError(
            "Source must be a user message from this conversation",
          );
        checks.push({
          kind: "check",
          table: "messages",
          id: message.id,
          expected_updated_at: message.updated_at,
        });
      }
      const id = randomUUID();
      context.stage([
        ...checks,
        {
          kind: "insert",
          table: "tasks",
          id,
          data: {
            title: input.title,
            description: input.description,
            status: input.status,
            priority: input.priority,
            due_at: input.due_date ? `${input.due_date}T23:59:59.000Z` : null,
            entity_id: project.id,
            goal_id: null,
            metadata: {
              workspace: "ary-nexus",
              action_id: context.actionId,
              requesting_user_id: repo.userId,
              requesting_agent: context.agentId ?? "authenticated_user",
              source_conversation_id: context.conversationId,
              source_message_id: context.sourceMessageId ?? null,
              ...(context.sourceActionId
                ? { source_action_id: context.sourceActionId }
                : {}),
              related_entity_ids: [
                ...new Set([project.id, ...(context.entityIds ?? [])]),
              ],
              related_memory_ids: context.memoryIds ?? [],
              reason: context.reason ?? "User requested task creation",
              due_date: input.due_date,
            },
          },
        },
      ]);
      return {
        simulated: false,
        task_id: id,
        title: input.title,
        description: input.description,
        status: input.status,
        priority: input.priority,
        due_date: input.due_date,
        project_id: project.id,
        project_name: project.name,
      };
    },
  });
}
