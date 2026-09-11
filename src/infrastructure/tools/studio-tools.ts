import { NexusEventBus } from "../../services/nexus-event-bus";
import { missionExecution } from "../../services/mission-execution-context";
import { studioMissionSpec } from "../../domain/studio-mission";
import { z } from "zod";
import type { ToolRegistry } from "../../domain/tool-registry";
import type { Repository } from "../../domain/repository";
import type { StudioPlan } from "../../domain/studio";
import type { StudioService } from "../../services/studio-service";
import { ActionService } from "../../services/action-service";
import { isDeepStrictEqual } from "node:util";
import { digest } from "../../services/permission-service";
import { AppError } from "../../domain/validation";
export function registerStudioTools(
  registry: ToolRegistry,
  repo: Repository,
  actions: ActionService,
  studio: StudioService,
) {
  registry.register("studio.inspect", {
    inputSchema: z
      .object({
        scene: z
          .string()
          .regex(/^[a-zA-Z0-9_-]{1,80}$/)
          .optional(),
      })
      .strict(),
    execute: async (input, c) => {
      const inventory = await studio.inspect(input.scene);
      const bus = new NexusEventBus(repo);
      for (const observation of inventory.observations) {
        const device = inventory.devices.find(
          (d) => d.id === observation.device_id,
        );
        await bus.record({
          type: "device.observed",
          source: { kind: "backend", name: "StudioTool" },
          correlation_id: c.actionId,
          mission_id: missionExecution.getStore()?.id ?? null,
          related_entity_id: device?.entity_id ?? null,
          visibility: "systems",
          severity: observation.status === "unavailable" ? "warning" : "info",
          payload: {
            device_id: observation.device_id,
            action_id: c.actionId,
            status: observation.status,
            reason_code: observation.recovery,
            label: device?.name ?? observation.device_id,
          },
        });
      }
      return { ...inventory };
    },
  });
  registry.register("studio.plan_scene", {
    inputSchema: z
      .object({ scene: z.string().trim().min(1).max(100) })
      .strict(),
    execute: async (input, c) => {
      const plan = await actions.run(
        "studio.inspect",
        c.conversationId,
        () => studio.plan(input.scene),
        { scene: input.scene },
        { productIds: [...c.productIds] },
      );
      return {
        plan,
        mission_spec: studioMissionSpec(plan.scene_id),
        request: {
          tool: "studio.execute_scene",
          input: { plan_action_id: c.actionId!, plan },
          source_action_id: c.actionId!,
          related_entity_ids: c.entityIds ?? [],
          conversation_id: c.conversationId,
        },
      };
    },
  });
  registry.register("studio.execute_scene", {
    inputSchema: z
      .object({
        plan_action_id: z.uuid(),
        plan: z.record(z.string(), z.unknown()),
      })
      .strict(),
    execute: async (input, c) => {
      const source = await repo.get("actions", input.plan_action_id);
      const saved = (source?.output.result as { plan?: StudioPlan } | undefined)
        ?.plan;
      if (
        !source ||
        source.tool_name !== "studio.plan_scene" ||
        source.status !== "succeeded" ||
        !saved ||
        !isDeepStrictEqual(saved, input.plan) ||
        c.sourceActionId !== source.id
      )
        throw new AppError("An unchanged owned studio plan is required", 409);
      if (!c.actionId) throw new AppError("Audited action required");
      let expectedPolicies: string | undefined;
      const report = await studio.execute(saved, c.actionId, async () => {
        const hashes: string[] = [];
        const scope = {
          workspace: "ary-nexus",
          productIds: [
            ...new Set([...c.productIds, ...(source.product_entity_ids ?? [])]),
          ],
        };
        for (const name of [
          "studio.inspect",
          "studio.plan_scene",
          "studio.execute_scene",
        ]) {
          const p = await actions.permissions.resolve(name, scope);
          hashes.push(p.policyHash);
          if (!(
            p.allowed ||
            (name === "studio.execute_scene" && p.approvalRequired)
          ))
            throw new AppError(`Studio permission changed: ${name}`, 403);
        }
        const hash = digest(hashes);
        if (expectedPolicies && expectedPolicies !== hash)
          throw new AppError(
            "Studio policies changed during execution; review a new plan",
            403,
          );
        expectedPolicies = hash;
      });
      await new NexusEventBus(repo).record({
        type: "device.readiness",
        source: { kind: "backend", name: "StudioTool" },
        correlation_id: c.actionId,
        mission_id: missionExecution.getStore()?.id ?? null,
        visibility: "systems",
        severity: report.readiness?.status === "ready" ? "info" : "warning",
        payload: {
          action_id: c.actionId,
          status: report.readiness?.status ?? "unverified",
          label: saved.scene_name,
          count:
            report.readiness?.checks.filter(
              (check) => check.status === "matched",
            ).length ?? 0,
        },
      });
      return { ...report };
    },
  });
  return registry;
}
