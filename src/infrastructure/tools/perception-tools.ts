import { z } from "zod";
import { perceptionSources, perceptionInput } from "../../domain/perception";
import type { ToolRegistry } from "../../domain/tool-registry";
import type { PerceptionService } from "../../services/perception-service";
import type { ActionService } from "../../services/action-service";
import { AppError } from "../../domain/validation";
export function registerPerceptionTools(
  registry: ToolRegistry,
  service: PerceptionService,
  actions: ActionService,
) {
  for (const source of perceptionSources)
    registry.register(`perception.capture_${source}`, {
      inputSchema: z
        .object({ source_id: z.string().trim().min(1).max(200) })
        .strict(),
      execute: async (input, c) =>
        service.grant(source, input.source_id, [...c.productIds]),
    });
  registry.register("perception.clear", {
    inputSchema: z.object({ ids: z.array(z.uuid()).max(12) }).strict(),
    execute: async (input) => service.clear(input.ids),
  });
  registry.register("perception.analyze", {
    inputSchema: perceptionInput,
    execute: async (input, c) => {
      const inherited = await service.scope(input.frames);
      if (inherited.some((id) => !c.productIds.includes(id)))
        throw new AppError(
          "Use the original source's project scope for visual analysis",
          403,
        );
      await actions.run(
        "perception.stage",
        c.conversationId,
        async () => true,
        {},
        { productIds: inherited },
      );
      return service.analyze(input);
    },
  });
  return registry;
}
