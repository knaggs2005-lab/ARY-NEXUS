import type { ActionService } from "../../services/action-service";
import { z } from "zod";
import type { ToolRegistry } from "../../domain/tool-registry";
import type { NexusMemoryService } from "../../services/nexus-memory-service";
import {
  captureMemoryInput,
  classifyMemoryInput,
  consolidateInput,
  forgetInput,
  knowledgeInput,
} from "../../domain/nexus-memory";
export function registerMemoryTools(
  registry: ToolRegistry,
  service: NexusMemoryService,
  actions: ActionService,
) {
  registry.register("memory.inspect", {
    inputSchema: z.object({ id: z.uuid() }).strict(),
    execute: (i) =>
      actions.run("memory.read", null, () => service.inspect(i.id)),
  });
  registry.register("knowledge.search", {
    inputSchema: z.object({ query: z.string().max(200) }).strict(),
    execute: async (i) =>
      actions.run("knowledge.read", null, async () => ({
        documents: await service.knowledge(i.query),
        namespace: "KNOWLEDGE",
        method: "bounded lexical relevance; not independently verified facts",
      })),
  });
  registry.register("memory.classify", {
    inputSchema: classifyMemoryInput,
    execute: (i, c) => service.classify(i, c),
  });
  registry.register("memory.capture", {
    inputSchema: captureMemoryInput,
    execute: (i, c) => service.capture(i, c),
  });
  registry.register("memory.consolidate", {
    inputSchema: consolidateInput,
    execute: (i, c) => service.consolidate(i, c),
  });
  registry.register("memory.forget", {
    inputSchema: forgetInput,
    execute: (i, c) => service.forget(i, c),
  });
  registry.register("memory.delete_record", {
    inputSchema: forgetInput,
    execute: (i, c) => service.forget(i, c, true),
  });
  registry.register("knowledge.archive", {
    inputSchema: forgetInput,
    execute: (i, c) => service.archiveKnowledge(i, c),
  });
  registry.register("knowledge.capture", {
    inputSchema: knowledgeInput,
    execute: (i, c) => service.captureKnowledge(i, c),
  });
}
