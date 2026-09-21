import { SelfDevelopmentService } from "../services/self-development-service";
import { GitDevelopmentWorkspace } from "../infrastructure/development/workspace";
import { registerDevelopmentTools } from "../infrastructure/tools/development-tools";
import { homedir } from "node:os";
import { OpenAIRealtimeSessionProvider } from "../infrastructure/providers/openai-realtime";
import { OpenAIRealtimeWebSocketTransport } from "../infrastructure/providers/openai-realtime-transport";
import { AgentProviderRegistry } from "../domain/agent-provider";
import { HermesAgentProvider } from "../infrastructure/agents/hermes-agent-provider";
import { DelegatedJobService } from "../services/delegated-job-service";
import { registerWorkerTools } from "../infrastructure/tools/worker-tools";
import { registerCommunicationTools } from "../infrastructure/tools/communication-tools";
import { CommunicationPlanningService } from "../services/communication-planning-service";
import {
  createModelRouter,
  guardedEmbeddings,
  localEndpoint,
} from "../infrastructure/providers/model-router-config";
import { OutcomeEngine } from "../services/outcome-engine";
import { registerOutcomeTools } from "../infrastructure/tools/outcome-tools";
import { SkillService } from "../services/skill-service";
import { registerSkillTools } from "../infrastructure/tools/skill-tools";
import { registerControlTools } from "../infrastructure/tools/control-tools";
import { PlaywrightBrowser } from "../infrastructure/control/playwright-browser";
import { MacAccessibility } from "../infrastructure/control/mac-accessibility";
import { ControlFiles } from "../infrastructure/control/files";
import {
  assertControlAccess,
  controlOrigins,
} from "../infrastructure/control/security";
import { OpenAIVisualControl } from "../infrastructure/providers/openai-visual-control";
import { GoogleCalendarProvider } from "../infrastructure/calendar/google-calendar";
import { McpAdapter } from "../infrastructure/mcp/adapter";
import { mcpConfiguration } from "../infrastructure/mcp/config";
import { ToolDiscoveryService } from "../services/tool-discovery-service";
import { CheckpointMissionEngine } from "../services/checkpoint-mission-engine";
import { registerMissionTools } from "../infrastructure/tools/mission-tools";
import { registerMemoryTools } from "../infrastructure/tools/memory-tools";
import { NexusMemoryService } from "../services/nexus-memory-service";
import { registerAgentTools } from "../infrastructure/tools/agent-tools";
import { AgentRuntimeService } from "../services/agent-runtime-service";
import { AgentModelRegistry } from "../domain/agent-models";
import { NexusEventBus } from "../services/nexus-event-bus";
import { OrchestrationConversationService } from "../services/orchestration-conversation-service";
import { OrchestratorService } from "../services/orchestrator-service";
import { registerOrchestratorTools } from "../infrastructure/tools/orchestrator-tools";
import { PerceptionService } from "../services/perception-service";
import { OpenAIVisionProvider } from "../infrastructure/providers/openai-vision";
import { StudioConversationService } from "../services/studio-conversation-service";
import { StudioService } from "../services/studio-service";
import { Cinema4DDesignTool } from "../infrastructure/design/bridge";
import { PhoneService } from "../services/phone-service";
import { UxpPremiereProvider } from "../infrastructure/premiere/bridge";
import { TwilioPhoneProvider } from "../infrastructure/phone/twilio-phone";
import { MacDesktopProvider } from "../infrastructure/desktop/mac-desktop";
import { assertDesktopAccess } from "../infrastructure/desktop/security";
import { createActionToolRegistry } from "../services/action-request-service";
import { GmailService } from "../services/gmail-service";
import { GoogleGmailProvider } from "../infrastructure/gmail/google-gmail";
import { ProviderMailIntelligence } from "../infrastructure/gmail/mail-intelligence";
import { BoardMeetingService } from "../services/board-meeting-service";
import { RoiService } from "../services/roi-service";
import { actionTelemetryContext } from "../services/action-telemetry-context";
import { actionContext } from "./action-context";
import type { ActionContext } from "../domain/permissions";
import { VoiceService } from "../services/voice-service";
import {
  OpenAISpeechToText,
  OpenAITextToSpeech,
} from "../infrastructure/providers/openai-voice";
import { GraphQueryService } from "../services/graph-query-service";
import { ReflectionService } from "../services/reflection-service";
import {
  OpenAIResponsesProvider,
  OpenAIEmbeddingProvider,
  OPENAI_REASONING_MODEL,
} from "../infrastructure/providers/openai";
import { consoleTelemetry, type Telemetry } from "../domain/telemetry";
import { ReembeddingService } from "../services/reembedding-service";
import { MemoryReconciliationService } from "../services/memory-reconciliation-service";
import { createClient } from "@supabase/supabase-js";
import { resolve } from "node:path";
import { LocalRepository } from "../infrastructure/repositories/local";
import { SupabaseRepository } from "../infrastructure/repositories/supabase";
import {
  LocalEmbeddingProvider,
  MockLanguageModel,
} from "../infrastructure/providers/local";
import {
  CompatibleEmbeddings,
  CompatibleLanguageModel,
} from "../infrastructure/providers/compatible";
import { MemoryService } from "../services/memory-service";
import { EntityService } from "../services/entity-service";
import { ActionService } from "../services/action-service";
import { AryBrainService } from "../services/ary-brain-service";
import type { Repository } from "../domain/repository";
import { AppError } from "../domain/validation";
import { seed } from "../infrastructure/seed";
export const DEMO_USER = "00000000-0000-4000-8000-000000000001";
export function isDemo() {
  return (
    process.env.ARY_STORAGE === "demo" && process.env.NODE_ENV !== "production"
  );
}
function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new AppError(`Server configuration missing: ${name}`, 503);
  return value;
}
export function services(
  repository: Repository,
  actionScope?: ActionContext,
  requestSignal?: AbortSignal,
) {
  const embeddingMode = process.env.ARY_EMBEDDING_PROVIDER ?? "openai";
  const llmMode = process.env.ARY_LLM_PROVIDER ?? "openai";
  if (
    !["local", "compatible", "openai"].includes(embeddingMode) ||
    !["mock", "compatible", "openai"].includes(llmMode)
  )
    throw new AppError("Unknown model provider configuration", 503);
  const events = new NexusEventBus(repository);
  const telemetry: Telemetry = async (metric) => {
    await consoleTelemetry(metric);
    if (["transcribe", "speak"].includes(metric.operation))
      await events.record({
        type: `voice.${metric.operation}_${metric.status}`,
        source: { kind: "backend", name: "VoiceService" },
        correlation_id: actionTelemetryContext.getStore() ?? null,
        severity: metric.status === "failed" ? "warning" : "info",
        payload: {
          model: metric.model,
          status: metric.status,
          duration_ms: metric.latency_ms,
        },
      });
    try {
      await repository.insert("model_calls", {
        ...metric,
        action_id: actionTelemetryContext.getStore() ?? null,
      });
    } catch {
      console.warn(
        "Ary model metric could not be persisted; aggregate metric remains in server logs",
      );
    }
  };
  const configuredEmbeddings =
    embeddingMode === "openai"
      ? new OpenAIEmbeddingProvider(telemetry)
      : embeddingMode === "compatible"
        ? new CompatibleEmbeddings({
            baseUrl: requiredEnv("EMBEDDING_BASE_URL"),
            model: requiredEnv("EMBEDDING_MODEL"),
            apiKey: process.env.EMBEDDING_API_KEY,
          })
        : new LocalEmbeddingProvider();
  const configuredLlm =
    llmMode === "openai"
      ? new OpenAIResponsesProvider(
          telemetry,
          process.env.OPENAI_REASONING_MODEL || OPENAI_REASONING_MODEL,
        )
      : llmMode === "compatible"
        ? new CompatibleLanguageModel({
            baseUrl: requiredEnv("LLM_BASE_URL"),
            model: requiredEnv("LLM_MODEL"),
            apiKey: process.env.LLM_API_KEY,
          })
        : new MockLanguageModel();
  const routingEnabled =
    process.env.ARY_MODEL_ROUTER_ENABLED !== "false" && llmMode !== "mock";
  const onRoute = async (
    trace: import("../domain/model-router").RoutingTrace,
  ) => {
    await events.record({
      type: "model.routed",
      source: { kind: "backend", name: "ModelRouter" },
      correlation_id: actionTelemetryContext.getStore() ?? null,
      visibility: "systems",
      severity: trace.degraded ? "warning" : "info",
      payload: {
        model: trace.attempts.at(-1)?.model ?? "unavailable",
        provider: trace.attempts.at(-1)?.provider ?? "local-evidence",
        state: trace.degraded ? "degraded" : "available",
        label: trace.reason.slice(0, 240),
        reason_code: trace.task,
        duration_ms: trace.latency_ms,
        count: trace.attempts.length,
      },
    });
  };
  const llm = routingEnabled
    ? createModelRouter(
        configuredLlm,
        llmMode,
        telemetry,
        onRoute,
        requestSignal,
      )
    : configuredLlm;
  const embeddings = routingEnabled
    ? guardedEmbeddings(
        configuredEmbeddings,
        embeddingMode === "local" ||
          (embeddingMode === "compatible" &&
            process.env.ARY_EMBEDDING_LOCATION === "local" &&
            localEndpoint(requiredEnv("EMBEDDING_BASE_URL"))),
        requestSignal,
      )
    : configuredEmbeddings;
  const memories = new MemoryService(repository, embeddings);
  const entities = new EntityService(repository);
  const actions = new ActionService(repository, actionScope);
  const reflection = new ReflectionService(repository, memories);
  const phone = new PhoneService(repository, new TwilioPhoneProvider());
  const visionMode =
    process.env.ARY_VISION_PROVIDER ||
    (llmMode === "openai" ? "openai" : "disabled");
  const perception = new PerceptionService(
    repository,
    actions,
    visionMode === "openai"
      ? new OpenAIVisionProvider(telemetry)
      : {
          model: "disabled",
          async analyze() {
            throw new AppError(
              "Vision provider is disabled or unconfigured",
              503,
            );
          },
        },
    undefined,
    requestSignal,
  );
  const actionTools = createActionToolRegistry(
    repository,
    new GmailService(
      repository,
      actions,
      new GoogleGmailProvider(repository.userId),
      new ProviderMailIntelligence(llm),
      memories,
    ),
    actions,
    new MacDesktopProvider(repository.userId, () =>
      assertDesktopAccess(
        repository.userId,
        actionScope?.desktopAuthorized === true,
      ),
    ),
    phone,
    new UxpPremiereProvider(
      repository.userId,
      () => actionScope?.desktopAuthorized === true,
    ),
    new Cinema4DDesignTool(
      repository.userId,
      () => actionScope?.desktopAuthorized === true,
    ),
    new StudioService(
      repository.userId,
      () => actionScope?.desktopAuthorized === true,
    ),
    perception,
  );
  registerCommunicationTools(
    actionTools,
    new CommunicationPlanningService(repository, actions, llm),
  );
  const controlGuard = () => {
    assertControlAccess(
      repository.userId,
      actionScope?.desktopAuthorized === true,
    );
    controlOrigins();
  };
  const transferFiles = new ControlFiles(
    process.env.ARY_CONTROL_TRANSFER_DIR ?? "",
  );
  registerControlTools(
    actionTools,
    new PlaywrightBrowser(
      repository.userId,
      controlGuard,
      (process.env.ARY_BROWSER_ALLOWED_ORIGINS ?? "")
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean),
      transferFiles,
    ),
    new MacAccessibility(
      repository.userId,
      controlGuard,
      (process.env.ARY_CONTROL_ALLOWED_APPS ?? "")
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean),
      visionMode === "openai"
        ? new OpenAIVisualControl(telemetry)
        : {
            async propose() {
              throw new AppError("Vision provider is disabled", 503);
            },
          },
    ),
    transferFiles,
    controlGuard,
    actions.permissions,
  );
  const mcpConfig = mcpConfiguration(repository.userId);
  const mcp = new McpAdapter(
    mcpConfig.servers,
    repository.userId,
    actionScope?.desktopAuthorized === true,
    undefined,
    mcpConfig.error,
  );
  mcp.register(actionTools);
  const toolDiscovery = new ToolDiscoveryService(
    repository,
    actions,
    actionTools,
    embeddings,
    mcp,
    async (origin, name) => {
      if (name.startsWith("gmail."))
        return new GoogleGmailProvider(repository.userId).status();
      if (name.startsWith("google_calendar."))
        return new GoogleCalendarProvider(repository.userId).status();
      if (/^(browser|computer|control)\./.test(name))
        return {
          configured:
            process.platform === "darwin" &&
            process.env.ARY_DIGITAL_CONTROL_ENABLED === "true" &&
            process.env.ARY_DESKTOP_BRIDGE_ENABLED === "true" &&
            process.env.ARY_STORAGE === "supabase" &&
            process.env.ARY_DESKTOP_USER_ID === repository.userId &&
            Boolean(
              name.startsWith("browser.")
                ? process.env.ARY_BROWSER_ALLOWED_ORIGINS
                : name.startsWith("computer.")
                  ? process.env.ARY_CONTROL_ALLOWED_APPS
                  : process.env.ARY_CONTROL_TRANSFER_DIR,
            ),
          connected: false,
        };
      if (name.startsWith("desktop."))
        return {
          configured:
            process.platform === "darwin" &&
            process.env.ARY_DESKTOP_BRIDGE_ENABLED === "true",
          connected: false,
        };
      return null;
    },
  );
  const orchestrator = new OrchestratorService(
    repository,
    actions,
    actionTools,
    memories,
    entities,
    llm,
  );
  orchestrator.discoverCapabilities = async (goal) =>
    (await toolDiscovery.search({ query: goal, limit: 8 })).matches.map(
      (m) => m.tool,
    );
  registerOrchestratorTools(actionTools, orchestrator, repository, actions);
  const board = new BoardMeetingService(repository, memories, llm, actions);
  const missions = new CheckpointMissionEngine(repository, orchestrator);
  const agentModels = new Map([["configured", llm]]);
  if (llmMode === "openai")
    for (const name of (process.env.ARY_AGENT_OPENAI_MODELS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => /^[a-zA-Z0-9._:-]{1,100}$/.test(s))
      .slice(0, 5))
      agentModels.set(
        name,
        routingEnabled
          ? createModelRouter(
              new OpenAIResponsesProvider(telemetry, name),
              "openai",
              telemetry,
              onRoute,
              requestSignal,
              true,
            )
          : new OpenAIResponsesProvider(telemetry, name),
      );
  const agents = new AgentRuntimeService(
    repository,
    actions,
    orchestrator.requests,
    missions,
    orchestrator,
    board,
    new AgentModelRegistry(agentModels),
  );
  orchestrator.agentDispatch = agents.dispatch.bind(agents);
  registerMissionTools(actionTools, missions, board, repository, agents);
  registerAgentTools(actionTools, agents);
  const workerProviders = new AgentProviderRegistry().register(
    new HermesAgentProvider(),
  );
  const workers = new DelegatedJobService(
    repository,
    workerProviders,
    orchestrator.requests,
  );
  registerWorkerTools(actionTools, workers);
  const outcomeEngine = new OutcomeEngine(repository);
  registerOutcomeTools(actionTools, outcomeEngine, actions);
  const skills = new SkillService(repository, actionTools, orchestrator);
  registerSkillTools(actionTools, skills);
  let development: SelfDevelopmentService | undefined;
  if (process.env.ARY_SELF_DEVELOPMENT_ENABLED === "true") {
    development = new SelfDevelopmentService(
      repository,
      missions,
      new GitDevelopmentWorkspace(
        process.cwd(),
        resolve(homedir(), ".ary-development", "workspaces"),
        resolve(process.cwd(), "node_modules"),
      ),
      llm,
    );
    registerDevelopmentTools(actionTools, development, () =>
      assertDesktopAccess(
        repository.userId,
        actionScope?.desktopAuthorized === true,
      ),
    );
  }
  const memorySystem = new NexusMemoryService(repository, memories);
  registerMemoryTools(actionTools, memorySystem, actions);
  return {
    development,
    workers,
    outcomeEngine,
    skills,
    toolDiscovery,
    memorySystem,
    agents,
    missions,
    orchestrator,
    phone,
    actionTools,
    perception,
    realtimeVoice: new OpenAIRealtimeSessionProvider(
      process.env.OPENAI_API_KEY && process.env.OPENAI_REALTIME_MODEL
        ? () =>
            new OpenAIRealtimeWebSocketTransport(
              process.env.OPENAI_API_KEY!,
              process.env.OPENAI_REALTIME_MODEL!,
            )
        : undefined,
    ),
    voice: () => {
      if (
        (process.env.ARY_STT_PROVIDER ?? "openai") !== "openai" ||
        (process.env.ARY_TTS_PROVIDER ?? "openai") !== "openai"
      )
        throw new AppError("Voice provider is disabled or not configured", 503);
      return new VoiceService(
        new OpenAISpeechToText(),
        new OpenAITextToSpeech(),
        telemetry,
      );
    },
    board,
    reflection,
    roi: new RoiService(repository),
    graph: new GraphQueryService(repository),
    repository,
    reembedding: new ReembeddingService(repository, embeddings),
    reconciliation: new MemoryReconciliationService(
      repository,
      memories,
      entities,
      llm,
    ),
    memories,
    entities,
    actions,
    brain: new AryBrainService(
      repository,
      memories,
      entities,
      llm,
      actions,
      process.env.ARY_REFLECTION_ENABLED === "false" ? undefined : reflection,
      new StudioConversationService(repository, actions, actionTools),
      new OrchestrationConversationService(repository, orchestrator),
      async (query) =>
        (await toolDiscovery.search({ query, limit: 5 })).matches.map((m) => ({
          name: m.tool.name,
          description: m.tool.description,
          availability: m.tool.availability.state,
          permission_level: m.tool.permission.level,
          approval_required:
            m.tool.always_requires_approval ||
            m.tool.permission.approvalRequired,
        })),
    ),
    provider: llm.name,
    embeddingModel: embeddings.modelId,
  };
}
const globals = globalThis as typeof globalThis & {
  arySeedPromise?: Promise<void>;
};
export async function context(request: Request) {
  if (isDemo()) {
    // Demo is intentionally localhost-only and shares one development identity.
    const host = new URL(request.url).hostname;
    if (!["localhost", "127.0.0.1", "[::1]"].includes(host))
      throw new AppError("Demo mode is localhost-only", 403);
    const repo = new LocalRepository(DEMO_USER, resolve(".data/demo.json"));
    const result = services(
      repo,
      await actionContext(request, repo),
      request.signal,
    );
    globals.arySeedPromise ??= seed(
      result.repository,
      result.entities,
      result.memories,
    ).catch((error) => {
      globals.arySeedPromise = undefined;
      throw error;
    });
    await globals.arySeedPromise;
    return result;
  }
  if (process.env.ARY_STORAGE !== "supabase")
    throw new AppError(
      "Configure ARY_STORAGE=supabase, or enable the local demo in development",
      503,
    );
  const token = request.headers
    .get("authorization")
    ?.match(/^Bearer (.+)$/i)?.[1];
  if (!token) throw new AppError("Sign in to continue", 401);
  const client = createClient(
    requiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
  const {
    data: { user },
    error,
  } = await client.auth.getUser(token);
  if (error || !user) throw new AppError("Invalid or expired session", 401);
  const { error: profileError } = await client
    .from("users")
    .upsert({ id: user.id }, { onConflict: "id", ignoreDuplicates: true });
  if (profileError)
    throw new AppError(
      "Could not initialize user profile; apply database migrations",
      503,
    );
  const repo = new SupabaseRepository(user.id, client);
  return services(repo, await actionContext(request, repo), request.signal);
}
