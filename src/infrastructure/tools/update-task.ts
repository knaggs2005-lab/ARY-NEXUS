import type { Repository, Mutation } from "../../domain/repository";
import type { ToolRegistry } from "../../domain/tool-registry";
import {
  taskUpdateInput,
  taskSnapshot,
  changedTask,
  taskDifferences,
} from "../../domain/task-actions";
import { AppError, required } from "../../domain/validation";

export function registerUpdateTask(registry: ToolRegistry, repo: Repository) {
  return registry.register("update_task", {
    inputSchema: taskUpdateInput,
    execute: async (input, context) => {
      if (!context.stage || !context.actionId)
        throw new AppError(
          "Task updates require the transactional action pipeline",
          500,
        );
      const task = required(await repo.get("tasks", input.task_id), "Task");
      const before = taskSnapshot(task);
      if (
        task.updated_at !== input.expected_updated_at ||
        taskDifferences(before, input.before).length
      )
        throw new AppError(
          "Task changed since review. Refresh it and submit a new proposal",
          409,
        );
      const after = changedTask(before, input.changes);
      const fields = taskDifferences(before, after);
      if (!fields.length)
        throw new AppError("The task already has these values", 400);
      const checks: Mutation[] = [];
      let projectName = "Unlinked";
      for (const id of new Set([
        ...(context.entityIds ?? []),
        ...before.related_entity_ids,
        ...after.related_entity_ids,
        ...[before.entity_id, after.entity_id].filter(
          (id): id is string => !!id,
        ),
      ])) {
        const entity = required(
          await repo.get("entities", id),
          "Related entity",
        );
        if (id === after.entity_id) {
          if (!["project", "company", "product"].includes(entity.entity_type))
            throw new AppError(
              "Project link must be a project, company or product",
            );
          projectName = entity.name;
        }
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
        const source = required(
          await repo.get("messages", context.sourceMessageId),
          "Source message",
        );
        if (
          source.role !== "user" ||
          source.conversation_id !== context.conversationId
        )
          throw new AppError("Source must belong to this conversation");
        checks.push({
          kind: "check",
          table: "messages",
          id: source.id,
          expected_updated_at: source.updated_at,
        });
      }
      const { related_entity_ids, ...columns } = after;
      context.stage([
        ...checks,
        {
          kind: "update",
          table: "tasks",
          id: task.id,
          expected_updated_at: input.expected_updated_at,
          data: {
            ...columns,
            metadata: {
              ...task.metadata,
              related_entity_ids,
              ...(input.changes.due_date !== undefined
                ? { due_date: input.changes.due_date }
                : {}),
              last_update_action_id: context.actionId,
              last_update_source_message_id: context.sourceMessageId ?? null,
              last_update_conversation_id: context.conversationId,
              last_update_user_id: repo.userId,
            },
          },
        },
      ]);
      return {
        simulated: false,
        operation: "update_task",
        task_id: task.id,
        title: after.title,
        project_id: after.entity_id,
        project_name: projectName,
        before,
        after,
        changed_fields: fields,
      };
    },
  });
}
