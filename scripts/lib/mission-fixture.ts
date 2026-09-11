import { AgentRuntimeService } from "../../src/services/agent-runtime-service";
import { AgentModelRegistry } from "../../src/domain/agent-models";
import { registerAgentTools } from "../../src/infrastructure/tools/agent-tools";
/** Disposable acceptance fixture: no external adapters, no credentials or live model. */
import { LocalRepository } from "../../src/infrastructure/repositories/local";
import { ActionService } from "../../src/services/action-service";
import { createActionToolRegistry } from "../../src/services/action-request-service";
import { OrchestratorService } from "../../src/services/orchestrator-service";
import { CheckpointMissionEngine } from "../../src/services/checkpoint-mission-engine";
import { registerOrchestratorTools } from "../../src/infrastructure/tools/orchestrator-tools";
import { registerMissionTools } from "../../src/infrastructure/tools/mission-tools";
import { BoardMeetingService } from "../../src/services/board-meeting-service";
import { EntityService } from "../../src/services/entity-service";
import { MemoryService } from "../../src/services/memory-service";
import {
  MockLanguageModel,
  LocalEmbeddingProvider,
} from "../../src/infrastructure/providers/local";
export function missionFixture(
  file: string,
  user: string,
  enableAgents = false,
  studio?: import("../../src/services/studio-service").StudioService,
) {
  const repo = new LocalRepository(user, file),
    actions = new ActionService(repo),
    tools = createActionToolRegistry(
      repo,
      undefined,
      actions,
      undefined,
      undefined,
      undefined,
      undefined,
      studio,
    );
  const entities = new EntityService(repo),
    memories = new MemoryService(repo, new LocalEmbeddingProvider()),
    model = new MockLanguageModel();
  const coordinator = new OrchestratorService(
      repo,
      actions,
      tools,
      memories,
      entities,
      model,
    ),
    engine = new CheckpointMissionEngine(repo, coordinator);
  registerOrchestratorTools(tools, coordinator, repo, actions);
  const board = new BoardMeetingService(repo, memories, model, actions);
  const agents = new AgentRuntimeService(
    repo,
    actions,
    coordinator.requests,
    engine,
    coordinator,
    board,
    new AgentModelRegistry(new Map([["configured", model]])),
  );
  if (enableAgents) {
    coordinator.agentDispatch = agents.dispatch.bind(agents);
    registerAgentTools(tools, agents);
  }
  registerMissionTools(
    tools,
    engine,
    board,
    repo,
    enableAgents ? agents : undefined,
  );
  return {
    agents,
    repo,
    actions,
    tools,
    coordinator,
    engine,
    entities,
    memories,
    model,
  };
}
