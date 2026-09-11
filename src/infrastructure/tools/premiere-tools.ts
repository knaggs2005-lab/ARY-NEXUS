import {
  PremiereMediaAnalysis,
  analysisInput,
  executionAnalysisInput,
} from "../premiere/media-analysis";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  premiereArguments,
  premiereVerbs,
  premierePlanInput,
  premiereExecution,
  validatePremierePlan,
  type PremiereProvider,
} from "../../domain/premiere";
import type { ToolRegistry } from "../../domain/tool-registry";
import { ActionService } from "../../services/action-service";
import { AppError } from "../../domain/validation";
export function registerPremiereTools(
  registry: ToolRegistry,
  provider: PremiereProvider,
  actions: ActionService,
  media = new PremiereMediaAnalysis(provider),
) {
  registry.register("premiere.inspect", {
    inputSchema: z.object({}).strict(),
    preflight: () => provider.assertAvailable(),
    execute: async () => ({ ...(await provider.inspect()) }),
  });
  registry.register("premiere.read_timeline", {
    inputSchema: z.object({}).strict(),
    preflight: () => provider.assertAvailable(),
    execute: async () => {
      const s = await provider.inspect();
      return {
        project_id: s.project_id,
        sequence_id: s.sequence_id,
        revision: s.revision,
        complete: s.complete,
        ticks_per_second: s.ticks_per_second ?? "254016000000",
        timebase: s.timebase ?? null,
        clips: s.clips,
      };
    },
  });
  registry.register("premiere.find_clips", {
    inputSchema: z
      .object({
        query: z.string().trim().min(1).max(200),
        limit: z.number().int().min(1).max(100).default(30),
      })
      .strict(),
    preflight: () => provider.assertAvailable(),
    execute: async (input) => {
      const s = await provider.inspect(),
        q = input.query.toLocaleLowerCase();
      const matches = [
        ...s.items
          .filter((i) => i.kind === "media")
          .map((i) => ({ ...i, source: "project" })),
        ...s.clips.map((c) => ({ ...c, source: "timeline" })),
      ].filter((i) => i.name.toLocaleLowerCase().includes(q));
      return {
        revision: s.revision,
        complete: s.complete,
        matches: matches.slice(0, input.limit),
        has_more: matches.length > input.limit,
      };
    },
  });
  registry.register("premiere.prepare_analysis", {
    inputSchema: analysisInput,
    preflight: () => provider.assertAvailable(),
    execute: (input) => media.prepare(input),
  });
  registry.register("premiere.analyze_media", {
    inputSchema: executionAnalysisInput,
    preflight: () => provider.assertAvailable(),
    execute: (input, context) => {
      if (!context.actionId)
        throw new AppError(
          "Media analysis requires an audited approved action",
          403,
        );
      return media.analyze(input);
    },
  });
  registry.register("premiere.plan", {
    inputSchema: premierePlanInput,
    preflight: () => provider.assertAvailable(),
    execute: async (input) => {
      const state = await actions.run("premiere.inspect", null, () =>
        provider.inspect(),
      );
      const args = premiereArguments[input.verb].parse(input.args);
      const plan = validatePremierePlan(input.verb, args, state);
      return {
        plan,
        state,
        request: {
          tool: `premiere.${input.verb}`,
          input: {
            operation_id: randomUUID(),
            expected_revision: state.revision,
            args,
          },
        },
      };
    },
  });
  for (const verb of premiereVerbs)
    registry.register(`premiere.${verb}`, {
      inputSchema: premiereExecution
        .extend({ args: premiereArguments[verb] })
        .strict(),
      preflight: () => provider.assertAvailable(),
      execute: (input, context) => {
        if (!context.actionId)
          throw new AppError(
            "Premiere execution requires an audited action",
            403,
          );
        return provider.execute(verb, input, context.actionId);
      },
    });
  return registry;
}
