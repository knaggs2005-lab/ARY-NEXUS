import { z } from "zod";
import { agentInput, type AgentRuntime } from "../../domain/agent";
import type { ToolRegistry } from "../../domain/tool-registry";
import { planSpec } from "../../domain/orchestration";
import { required } from "../../domain/validation";
export function registerAgentTools(
  registry: ToolRegistry,
  runtime: AgentRuntime,
) {
  registry.register("agent.create", {
    inputSchema: agentInput,
    execute: async (input, context) => ({
      agent: await runtime.create(
        input,
        required(context.actionId ?? null, "Action identity"),
      ),
    }),
  });
  registry.register("agent.submit", {
    inputSchema: z
      .object({
        agent_id: z.uuid(),
        objective: z.string().trim().min(3).max(1500),
        spec: planSpec.optional(),
      })
      .strict(),
    execute: async (input, context) => ({
      mission: await runtime.submit(
        input.agent_id,
        input.objective,
        required(context.actionId ?? null, "Action identity"),
        input.spec,
      ),
    }),
  });
  registry.register("agent.delegate", {
    inputSchema: z
      .object({
        parent_id: z.uuid(),
        child: agentInput.omit({ parent_id: true, lifetime: true }),
        objective: z.string().trim().min(3).max(1500),
      })
      .strict(),
    execute: async (input, context) => ({
      ...(await runtime.delegate(
        input.parent_id,
        input.child,
        input.objective,
        required(context.actionId ?? null, "Action identity"),
      )),
    }),
  });
  registry.register("agent.terminate", {
    inputSchema: z
      .object({ agent_id: z.uuid(), reason: z.string().trim().min(3).max(500) })
      .strict(),
    execute: async (input) => {
      await runtime.terminate(input.agent_id, input.reason);
      return {
        agent_id: input.agent_id,
        terminated: true,
        in_flight_effects:
          "Cancellation stops future dispatch; existing external effects cannot be undone.",
      };
    },
  });
}
