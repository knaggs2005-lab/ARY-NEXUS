import type { ToolRegistry } from "../../domain/tool-registry";
import type { CommunicationPlanningService } from "../../services/communication-planning-service";
import {
  communicationPlanInput,
  communicationDebriefInput,
} from "../../domain/communication-plan";
export function registerCommunicationTools(
  registry: ToolRegistry,
  service: CommunicationPlanningService,
) {
  registry.register("communications.plan", {
    inputSchema: communicationPlanInput,
    execute: (i, c) => service.plan(i, c),
  });
  registry.register("communications.debrief", {
    inputSchema: communicationDebriefInput,
    execute: (i, c) => service.debrief(i, c),
  });
}
