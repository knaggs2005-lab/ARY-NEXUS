import type { Repository, Mutation } from "../../domain/repository";
import type { ToolRegistry } from "../../domain/tool-registry";
import {
  projectUpdateInput,
  projectSnapshot,
  changedProject,
  projectDifferences,
  projectBlockers,
  projectTaskRollup,
} from "../../domain/project-actions";
import { AppError, required } from "../../domain/validation";

export function registerUpdateProjectStatus(
  registry: ToolRegistry,
  repo: Repository,
) {
  return registry.register("update_project_status", {
    inputSchema: projectUpdateInput,
    execute: async (input, context) => {
      if (!context.stage || !context.actionId)
        throw new AppError(
          "Project updates require the transactional action pipeline",
          500,
        );
      const project = required(
        await repo.get("entities", input.project_id),
        "Project",
      );
      if (project.entity_type !== "project")
        throw new AppError("This action requires an existing project entity");
      const [edges, goals, tasks] = await Promise.all([
        repo.list("relationships", {
          target_entity_id: project.id,
          relationship_type: "blocks",
        }),
        repo.list("goals", { entity_id: project.id }),
        repo.list("tasks", { entity_id: project.id }),
      ]);
      const before = projectSnapshot(project, edges, goals);
      if (
        project.updated_at !== input.expected_updated_at ||
        projectDifferences(before, input.before).length
      )
        throw new AppError(
          "Project changed since review. Refresh and submit a new proposal",
          409,
        );
      const after = changedProject(before, input.changes),
        fields = projectDifferences(before, after);
      if (!fields.length)
        throw new AppError("The project already has these values");
      const mutations: Mutation[] = [];
      for (const id of new Set([
        ...(context.entityIds ?? []),
        ...before.blocker_entity_ids,
        ...after.blocker_entity_ids,
      ])) {
        const entity = required(
          await repo.get("entities", id),
          "Related entity",
        );
        if (id === project.id && after.blocker_entity_ids.includes(id))
          throw new AppError("A project cannot block itself");
        mutations.push({
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
        mutations.push({
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
        mutations.push({
          kind: "check",
          table: "messages",
          id: source.id,
          expected_updated_at: source.updated_at,
        });
      }
      const evidence = {
        action_id: context.actionId,
        reason: context.reason ?? "",
        source_message_id: context.sourceMessageId ?? null,
        conversation_id: context.conversationId,
        requesting_user_id: repo.userId,
      };
      const now = new Date().toISOString();
      const blockers = projectBlockers(project.id, edges);
      for (const edge of blockers) {
        mutations.push({
          kind: "check",
          table: "relationships",
          id: edge.id,
          expected_updated_at: edge.updated_at,
        });
        if (!after.blocker_entity_ids.includes(edge.source_entity_id))
          mutations.push({
            kind: "update",
            table: "relationships",
            id: edge.id,
            expected_updated_at: edge.updated_at,
            data: {
              valid_to: now,
              metadata: { ...edge.metadata, ended_by_action: context.actionId },
            },
          });
      }
      for (const id of after.blocker_entity_ids.filter(
        (id) => !before.blocker_entity_ids.includes(id),
      )) {
        // The existing relationship key is unique across history. Reopening it
        // retains its ID and the database's relationship_versions snapshots.
        const prior = edges.find(
          (e) =>
            e.source_entity_id === id &&
            e.target_entity_id === project.id &&
            e.relationship_type === "blocks",
        );
        if (prior?.valid_from && Date.parse(prior.valid_from) > Date.now())
          throw new AppError(
            "A scheduled blocker already exists; review its timing separately",
            409,
          );
        const data = {
          source_entity_id: id,
          target_entity_id: project.id,
          relationship_type: "blocks",
          strength: 1,
          valid_from: now,
          valid_to: null,
          memory_id: null,
          metadata: { ...prior?.metadata, ...evidence },
        };
        mutations.push(
          prior
            ? {
                kind: "update",
                table: "relationships",
                id: prior.id,
                expected_updated_at: prior.updated_at,
                data,
              }
            : { kind: "insert", table: "relationships", data },
        );
      }
      for (const id of new Set([...before.goal_ids, ...after.goal_ids])) {
        const goal = required(await repo.get("goals", id), "Linked goal");
        if (goal.entity_id && goal.entity_id !== project.id)
          throw new AppError(
            "Goal already belongs to another entity; reassignment is not part of this action",
            409,
          );
        mutations.push({
          kind: "check",
          table: "goals",
          id,
          expected_updated_at: goal.updated_at,
        });
        const entityId = after.goal_ids.includes(id) ? project.id : null;
        if (goal.entity_id !== entityId)
          mutations.push({
            kind: "update",
            table: "goals",
            id,
            expected_updated_at: goal.updated_at,
            data: {
              entity_id: entityId,
              metadata: {
                ...goal.metadata,
                last_project_action_id: context.actionId,
              },
            },
          });
      }
      mutations.push({
        kind: "update",
        table: "entities",
        id: project.id,
        expected_updated_at: input.expected_updated_at,
        data: {
          metadata: {
            ...project.metadata,
            ...(input.changes.status !== undefined
              ? { status: after.status }
              : {}),
            ...(input.changes.priority !== undefined
              ? { priority: after.priority }
              : {}),
            ...(input.changes.health !== undefined
              ? { health: after.health }
              : {}),
            ...(input.changes.notes !== undefined
              ? { project_notes: after.notes }
              : {}),
            last_update_action_id: context.actionId,
            last_update_source_message_id: context.sourceMessageId ?? null,
            last_update_conversation_id: context.conversationId,
            last_update_user_id: repo.userId,
          },
        },
      });
      context.stage(mutations);
      return {
        simulated: false,
        operation: "update_project_status",
        project_id: project.id,
        project_name: project.name,
        before,
        after,
        changed_fields: fields,
        task_rollup: projectTaskRollup(project.id, tasks),
        rollup_observed_at: now,
      };
    },
  });
}
