import { randomUUID } from "node:crypto";
import { z } from "zod";
import { editPlanInput, type EditPlan } from "../../domain/edit-plan";
import { EditIntelligenceService } from "../../services/edit-intelligence-service";
import type { ToolRegistry } from "../../domain/tool-registry";
import type { Repository } from "../../domain/repository";
import type { ActionService } from "../../services/action-service";
import {
  validatePremierePlan,
  type PremiereProvider,
} from "../../domain/premiere";
export function registerEditTools(
  registry: ToolRegistry,
  repo: Repository,
  actions: ActionService,
  premiere: PremiereProvider,
) {
  registry.register("edit.plan", {
    inputSchema: editPlanInput,
    execute: async (input) => ({
      ...new EditIntelligenceService().createPlan(input),
    }),
  });
  registry.register("edit.prepare_marker", {
    inputSchema: z
      .object({
        plan_action_id: z.uuid(),
        recommendation_id: z.string().min(1).max(100),
        premiere_project_id: z.string().min(1).max(200),
        sequence_id: z.string().min(1).max(200),
        sequence_seconds: z.number().min(0).max(86400),
        mapping_note: z.string().trim().min(10).max(1000),
      })
      .strict(),
    execute: async (input, context) => {
      // Owner-scoped source and its original product permissions remain authoritative.
      const source = await repo.get("actions", input.plan_action_id);
      if (
        !source ||
        source.tool_name !== "edit.plan" ||
        source.status !== "succeeded"
      )
        throw Error("An owned successful edit plan is required");
      const scope = {
        productIds: [
          ...new Set([
            ...context.productIds,
            ...(source.product_entity_ids ?? []),
          ]),
        ],
      };
      await actions.run(
        "activity.read",
        context.conversationId,
        async () => true,
        {},
        scope,
      );
      await actions.run(
        "edit.plan",
        context.conversationId,
        async () => true,
        {},
        scope,
      );
      const plan = source.output.result as unknown as EditPlan;
      if (plan?.version !== "edit-rules-v1")
        throw Error("Unsupported edit plan version");
      const rec = plan.recommendations.find(
        (r) => r.id === input.recommendation_id && r.kind === "marker",
      );
      if (!rec) throw Error("Choose an existing marker recommendation");
      return actions.run(
        "premiere.plan",
        context.conversationId,
        async () => {
          premiere.assertAvailable();
          const state = await actions.run(
            "premiere.inspect",
            context.conversationId,
            () => premiere.inspect(),
            {},
            scope,
          );
          if (
            state.project_id !== input.premiere_project_id ||
            state.sequence_id !== input.sequence_id
          )
            throw Error(
              "Open the reviewed destination project and sequence first",
            );
          const args = {
            markers: [
              {
                name: `Ary ${rec.id}`,
                seconds: input.sequence_seconds,
                comments:
                  `Edit plan ${plan.id}; action ${source.id}; source ${rec.source_clip} ${rec.timecode.in}–${rec.timecode.out}; hash ${rec.evidence.source_hash}; ${input.mapping_note}; ${rec.reason}`.slice(
                    0,
                    2000,
                  ),
              },
            ],
          };
          return {
            plan: validatePremierePlan("create_markers", args, state),
            state,
            request: {
              tool: "premiere.create_markers",
              input: {
                operation_id: randomUUID(),
                expected_revision: state.revision,
                args,
              },
            },
            source_action_id: source.id,
            product_entity_ids: scope.productIds,
            recommendation_id: rec.id,
          };
        },
        { plan_action_id: source.id, recommendation_id: rec.id },
        scope,
      );
    },
  });
  return registry;
}
