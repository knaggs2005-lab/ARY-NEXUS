import { z } from "zod";
import { ToolRegistry } from "../../domain/tool-registry";
import { AppError } from "../../domain/validation";

/** No repository, provider, filesystem, or network access. Only ActionService writes audit records. */
export function createMockToolRegistry() {
  const registry = new ToolRegistry();
  const message = z.string().trim().min(1).max(500);
  registry.register("mock.observe", {
    inputSchema: z.object({}).strict(),
    execute: async () => ({
      simulated: true,
      summary: "Synthetic workspace: two open example tasks.",
      open_tasks: 2,
    }),
  });
  registry.register("mock.recommend", {
    inputSchema: z.object({ message }).strict(),
    execute: async ({ message }) => ({
      simulated: true,
      recommendation: `Review this example next: ${message}`,
    }),
  });
  registry.register("mock.draft", {
    inputSchema: z.object({ message }).strict(),
    execute: async ({ message }) => ({
      simulated: true,
      draft: { title: message, status: "draft" },
      saved: false,
    }),
  });
  registry.register("mock.execute", {
    inputSchema: z
      .object({ message, simulate_failure: z.boolean().default(false) })
      .strict(),
    execute: async ({ message, simulate_failure }) => {
      if (simulate_failure)
        throw new AppError(
          "Simulated tool failure; no external changes were made",
          422,
        );
      return {
        simulated: true,
        summary: `Simulated completion: ${message}`,
        external_changes: false,
      };
    },
  });
  const text = z.string().trim().min(1).max(2000);
  registry.register("mock.create_task", {
    inputSchema: z.object({ title: text, project_id: z.uuid() }).strict(),
    execute: async (input) => ({
      simulated: true,
      saved: false,
      task: { ...input, status: "pending" },
    }),
  });
  registry.register("mock.update_task", {
    inputSchema: z
      .object({
        task_id: z.uuid(),
        status: z.enum(["pending", "in_progress", "completed", "cancelled"]),
      })
      .strict(),
    execute: async (input) => ({
      simulated: true,
      saved: false,
      proposed_update: input,
    }),
  });
  registry.register("mock.update_project_status", {
    inputSchema: z
      .object({
        project_id: z.uuid(),
        status: z.enum(["active", "paused", "completed"]),
      })
      .strict(),
    execute: async (input) => ({
      simulated: true,
      saved: false,
      proposed_update: input,
    }),
  });
  registry.register("mock.draft_message", {
    inputSchema: z.object({ recipient: text, message: text }).strict(),
    execute: async (input) => ({ simulated: true, sent: false, draft: input }),
  });
  registry.register("mock.create_note", {
    inputSchema: z.object({ title: text, content: text }).strict(),
    execute: async (input) => ({ simulated: true, saved: false, note: input }),
  });
  registry.register("mock.fetch_project_summary", {
    inputSchema: z.object({ project_id: z.uuid() }).strict(),
    execute: async ({ project_id }) => ({
      simulated: true,
      project_id,
      summary:
        "Synthetic project summary: one example milestone pending. This is not live project data.",
    }),
  });
  return registry;
}
