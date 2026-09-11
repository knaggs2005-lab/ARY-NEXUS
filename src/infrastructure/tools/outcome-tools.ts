import type { ActionService } from "../../services/action-service";
import { z } from "zod";
import { assessmentInput } from "../../domain/outcome-engine";
import type { ToolRegistry } from "../../domain/tool-registry";
import type { OutcomeEngine } from "../../services/outcome-engine";
export function registerOutcomeTools(
  tools: ToolRegistry,
  engine: OutcomeEngine,
  actions: ActionService,
) {
  const guard = async () => {
    for (const name of [
      "activity.read",
      "conversation.read",
      "entity.read",
      "skill.read",
    ]) {
      await actions.run(name, null, async () => true);
    }
  };
  tools.register("outcome.inspect", {
    inputSchema: z.object({ outcome_ids: z.array(z.uuid()).max(20) }).strict(),
    execute: async (i) => {
      await guard();
      const r = await engine.report();
      return {
        rows: r.rows.filter((row) => i.outcome_ids.includes(row.outcome.id)),
        recommendations: r.recommendations.filter((p) =>
          i.outcome_ids.includes(p.outcome_id),
        ),
      };
    },
  });
  tools.register("outcome.assess", {
    inputSchema: assessmentInput,
    execute: async (i, c) => {
      await guard();
      return engine.assess(i, c);
    },
  });
  tools.register("outcome.propose", {
    inputSchema: z
      .object({ outcome_ids: z.array(z.uuid()).min(3).max(8) })
      .strict(),
    execute: async (i, c) => {
      await guard();
      return engine.propose(i.outcome_ids, c);
    },
  });
  tools.register("outcome.review", {
    inputSchema: z
      .object({
        outcome_id: z.uuid(),
        recommendation_id: z.string().min(16).max(128),
        state: z.enum(["accepted", "rejected", "withdrawn"]),
        reason: z.string().trim().min(3).max(2000),
      })
      .strict(),
    execute: async (i, c) => {
      await guard();
      return engine.review(
        i.outcome_id,
        i.recommendation_id,
        i.state,
        i.reason,
        c,
      );
    },
  });
}
