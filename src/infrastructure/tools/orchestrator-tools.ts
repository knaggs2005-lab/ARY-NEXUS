import { taskSnapshot } from "../../domain/task-actions";
import { z } from "zod";
import { planSpec } from "../../domain/orchestration";
import type { ToolRegistry } from "../../domain/tool-registry";
import type { OrchestratorService } from "../../services/orchestrator-service";
import type { Repository } from "../../domain/repository";
import type { ActionService } from "../../services/action-service";
import { required } from "../../domain/validation";
export function registerOrchestratorTools(
  registry: ToolRegistry,
  service: OrchestratorService,
  repo: Repository,
  actions: ActionService,
) {
  registry.register("orchestrator.plan", {
    inputSchema: z
      .object({
        goal: z.string().trim().min(3).max(2000),
        spec: planSpec.optional(),
      })
      .strict(),
    execute: async (input) => ({
      ...(await service.create(input.goal, input.spec)),
    }),
  });
  registry.register("orchestrator.advance", {
    inputSchema: z
      .object({
        plan_id: z.uuid(),
        revision: z.number().int().min(0),
        step_id: z.string().max(40).optional(),
        command: z.enum([
          "advance",
          "resume",
          "pause",
          "stop",
          "cancel",
          "skip",
          "retry",
          "recover",
        ]),
      })
      .strict(),
    execute: async (input) => ({
      ...(await service.command(
        input.plan_id,
        input.command,
        input.revision,
        input.step_id,
      )),
    }),
  });
  registry.register("orchestrator.remember", {
    inputSchema: z
      .object({
        plan_id: z.uuid(),
        revision: z.number().int().min(0),
        summary: z.string().min(1).max(1500),
      })
      .strict(),
    execute: (input) =>
      service.remember(input.plan_id, input.revision, input.summary),
  });
  registry.register("orchestrator.replan", {
    inputSchema: z
      .object({
        plan_id: z.uuid(),
        revision: z.number().int().min(0),
        spec: planSpec,
        reason: z.string().trim().min(3).max(1000),
      })
      .strict(),
    execute: async (i) => ({
      ...(await service.replan(i.plan_id, i.revision, i.spec, i.reason)),
    }),
  });
  registry.register("orchestrator.review_steps", {
    inputSchema: z
      .object({
        plan_id: z.uuid(),
        revision: z.number().int().min(0),
        decision: z.enum(["approved", "rejected"]),
        reason: z.string().min(3).max(1000),
        items: z
          .array(
            z
              .object({
                step_id: z.string(),
                action_id: z.uuid(),
                fingerprint: z.string(),
                policy_hash: z.string(),
                tool: z.string(),
                input: z.record(z.string(), z.unknown()),
              })
              .strict(),
          )
          .min(1)
          .max(3),
      })
      .strict(),
    execute: (i) =>
      service.reviewSteps(i.plan_id, i.revision, i.items, i.decision, i.reason),
  });
  registry.register("task.inspect", {
    inputSchema: z.object({ task_id: z.uuid() }).strict(),
    execute: (input, context) =>
      actions.run(
        "activity.read",
        null,
        async () => {
          const task = required(await repo.get("tasks", input.task_id), "Task");
          return {
            before: taskSnapshot(task),
            task_id: task.id,
            title: task.title,
            status: task.status,
            priority: task.priority,
            description: task.description,
            entity_id: task.entity_id,
            updated_at: task.updated_at,
          };
        },
        {},
        { productIds: [...context.productIds] },
      ),
  });
  return registry;
}
