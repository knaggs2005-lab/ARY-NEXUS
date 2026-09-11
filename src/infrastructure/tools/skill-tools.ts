import { digest } from "../../services/permission-service";
import { z } from "zod";
import { skillDefinition, automationDefinition } from "../../domain/skills";
import type { ToolRegistry } from "../../domain/tool-registry";
import type { SkillService } from "../../services/skill-service";
export function registerSkillTools(
  registry: ToolRegistry,
  service: SkillService,
) {
  registry.register("skill.save", {
    inputSchema: z
      .object({
        definition: skillDefinition,
        id: z.uuid().optional(),
        revision: z.number().int().nonnegative().optional(),
      })
      .strict(),
    execute: (i, c) => service.save(i.definition, c, i.id, i.revision),
  });
  registry.register("skill.propose", {
    inputSchema: z.object({ goal: z.string().min(3).max(2000) }).strict(),
    execute: (i, c) => service.proposal(i.goal, c),
  });
  registry.register("skill.approve", {
    inputSchema: z
      .object({
        id: z.uuid(),
        version: z.number().int().positive(),
        hash: z.string().min(16).max(128),
      })
      .strict(),
    execute: (i, c) => service.approve(i.id, i.version, i.hash, c),
  });
  registry.register("skill.launch", {
    inputSchema: z
      .object({
        id: z.uuid(),
        version: z.number().int().positive(),
        inputs: z.record(
          z.string(),
          z.union([z.string().max(2000), z.number().finite(), z.boolean()]),
        ),
      })
      .strict(),
    execute: (i, c) =>
      service.launch(
        i.id,
        i.version,
        i.inputs,
        `skill-launch:${digest([c.userId, c.requestKey])}`,
      ),
  });
  registry.register("automation.save", {
    inputSchema: automationDefinition,
    execute: (i, c) => service.saveAutomation(i, c),
  });
  registry.register("automation.enable", {
    inputSchema: z
      .object({
        id: z.uuid(),
        revision: z.number().int().positive(),
        enabled: z.boolean(),
      })
      .strict(),
    execute: (i, c) => service.enable(i.id, i.revision, i.enabled, c),
  });
  registry.register("automation.fire", {
    inputSchema: z
      .object({
        id: z.uuid(),
        invocation: z.string().regex(/^[a-zA-Z0-9_-]{8,50}$/),
      })
      .strict(),
    execute: (i) => service.fire(i.id, i.invocation),
  });
}
