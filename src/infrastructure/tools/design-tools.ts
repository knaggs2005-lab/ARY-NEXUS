import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  designArguments,
  designExecution,
  designVerbs,
  validateDesignPlan,
  type DesignTool,
} from "../../domain/design-tool";
import type { ToolRegistry } from "../../domain/tool-registry";
import type { ActionService } from "../../services/action-service";
export function registerDesignTools(
  registry: ToolRegistry,
  provider: DesignTool,
  actions: ActionService,
) {
  registry.register("design.inspect", {
    inputSchema: z.object({}).strict(),
    preflight: () => provider.assertAvailable(),
    execute: async () => ({ ...(await provider.inspect()) }),
  });
  registry.register("design.plan", {
    inputSchema: z
      .object({
        verb: z.enum(designVerbs),
        args: z.record(z.string(), z.unknown()),
      })
      .strict(),
    preflight: () => provider.assertAvailable(),
    execute: async (input, context) => {
      const state = await actions.run(
        "design.inspect",
        context.conversationId,
        () => provider.inspect(),
        {},
        { productIds: [...context.productIds] },
      );
      const args = designArguments[input.verb].parse(input.args);
      return {
        plan: validateDesignPlan(input.verb, args, state),
        state,
        request: {
          tool: `design.${input.verb}`,
          input: {
            operation_id: randomUUID(),
            expected_revision: state.revision,
            args,
          },
        },
      };
    },
  });
  for (const verb of designVerbs)
    registry.register(`design.${verb}`, {
      inputSchema: designExecution
        .extend({ args: designArguments[verb] })
        .strict(),
      preflight: () => provider.assertAvailable(),
      execute: (input, context) => {
        if (!context.actionId) throw Error("An audited action is required");
        return provider.execute(verb, input, context.actionId);
      },
    });
  return registry;
}
