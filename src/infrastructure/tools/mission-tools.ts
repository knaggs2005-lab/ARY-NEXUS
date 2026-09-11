import { agentAssignment } from "../../services/agent-context";
import { z } from "zod";
import {
  missionOptions,
  submissionInput,
  type MissionEngine,
} from "../../domain/mission";
import { planSpec } from "../../domain/orchestration";
import { boardRoles } from "../../domain/board";
import type { ToolRegistry } from "../../domain/tool-registry";
import type { BoardMeetingService } from "../../services/board-meeting-service";
import {
  missionExecution,
  assertMissionLease,
} from "../../services/mission-execution-context";
import type { Repository } from "../../domain/repository";
import { AppError } from "../../domain/validation";
import type { AgentRuntime } from "../../domain/agent";
export function registerMissionTools(
  registry: ToolRegistry,
  engine: MissionEngine,
  board: BoardMeetingService,
  repo: Repository,
  agents?: AgentRuntime,
) {
  registry.register("mission.create", {
    inputSchema: z
      .object({
        goal: z.string().trim().min(3).max(2000),
        spec: planSpec.optional(),
        options: missionOptions.optional(),
      })
      .strict(),
    execute: async (i) => ({
      ...(await engine.create(
        i.goal,
        i.spec,
        i.options,
        agentAssignment.getStore(),
      )),
    }),
  });
  registry.register("mission.control", {
    inputSchema: z
      .object({
        mission_id: z.uuid(),
        revision: z.number().int().min(0),
        command: z.enum([
          "plan",
          "start",
          "pause",
          "resume",
          "cancel",
          "checkpoint",
          "retry",
        ]),
      })
      .strict(),
    execute: async (i) => ({
      ...(await engine.control(i.mission_id, i.command, i.revision)),
    }),
  });
  registry.register("mission.submit", {
    inputSchema: z
      .object({ mission_id: z.uuid(), submission: submissionInput })
      .strict(),
    execute: async (i) => ({
      ...(await engine.submit(i.mission_id, i.submission)),
    }),
  });
  registry.register("mission.tick", {
    inputSchema: z.object({ mission_id: z.uuid() }).strict(),
    execute: async (i) => ({ ...(await engine.tick(i.mission_id)) }),
  });
  registry.register("mission.agent", {
    inputSchema: z
      .object({
        role: z.enum(boardRoles),
        objective: z.string().trim().min(3).max(1500),
      })
      .strict(),
    execute: async (i, context) => {
      const scope = missionExecution.getStore();
      if (!scope)
        throw new AppError(
          "Role submissions require an active mission step",
          409,
        );
      await assertMissionLease(repo, scope.id);
      if (agents) {
        if (!context.actionId)
          throw new AppError(
            "Agent submission requires its action receipt",
            409,
          );
        return agents.submission(
          i.role,
          i.objective,
          scope.id,
          context.actionId,
        );
      }
      return board.submitMission(i.role, i.objective, scope.id);
    },
  });
}
