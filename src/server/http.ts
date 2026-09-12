import { NexusIntelligenceService } from "../services/nexus-intelligence-service";
import { NexusMapService } from "../services/nexus-map-service";
import { MissionControlService } from "../services/mission-control-service";
import { authorizeEventRead, nexusEventStream } from "./nexus-event-stream";
import { eventQuery } from "../domain/nexus-events";
import { NexusEventBus } from "../services/nexus-event-bus";
import { presenceTelemetry } from "../services/presence-telemetry";
import { presenceResponse } from "./presence-stream";
import { MAX_FRAME_BYTES } from "../infrastructure/perception/frame-store";
import {
  authorizeDesignBridge,
  DesignBridge,
} from "../infrastructure/design/bridge";
import { gmailOAuth, gmailRedirect } from "../infrastructure/gmail/google-auth";
import { CommunicationsService } from "../services/communications-service";
import {
  authorizePremiereBridge,
  PremiereBridge,
} from "../infrastructure/premiere/bridge";
import { GoogleGmailProvider } from "../infrastructure/gmail/google-gmail";
import { calendarOAuthResponse } from "./calendar-oauth";
import {
  GoogleCalendarOAuth,
  GoogleCalendarProvider,
} from "../infrastructure/calendar/google-calendar";
import { boardRequest } from "../domain/board";
import { PriorityService } from "../services/priority-service";
import { ApprovalRequiredError } from "../services/action-service";
import { ActionRequestService } from "../services/action-request-service";
import { permissionLevels, toolRegistry } from "../domain/permissions";
import { graphSample } from "../infrastructure/graph-sample";
import { queryLocalGraph } from "../infrastructure/repositories/local-graph";
import { graphQuerySchema } from "../domain/brain-graph";
import { isCurrentMemory } from "../services/memory-service";
import { z } from "zod";
import { context, isDemo } from "./context";
import { AppError, chatInput, required } from "../domain/validation";
import { withoutEmbedding } from "../domain/models";
import { transcriptionResponse } from "./voice-stream";
import {
  realtimeVoiceRelayFor,
  REALTIME_MAX_BATCH_BYTES,
  type RealtimeVoiceRelayService,
} from "../services/realtime-voice-relay-service";
const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
async function body(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new AppError("JSON body is required");
  let size = 0;
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 65536) {
      await reader.cancel();
      throw new AppError("Request body exceeds 64 KB", 413);
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new AppError("Invalid JSON body");
  }
}
async function binaryBody(request: Request, maxBytes: number) {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  let size = 0;
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new AppError("Realtime audio batch exceeds 14,400 bytes", 413);
    }
    chunks.push(value);
  }
  return new Uint8Array(Buffer.concat(chunks));
}
export async function handle(
  request: Request,
  path: string[],
  schedule?: (work: () => Promise<void>) => void,
  dependencies?: { realtimeRelay?: RealtimeVoiceRelayService },
) {
  try {
    const url = new URL(request.url);
    const method = request.method;
    const route = path.join("/");
    if (method !== "GET") {
      const origin = request.headers.get("origin");
      const expectedOrigin = new URL(request.url);
      // Next can normalize the internal URL to localhost. Use the received Host
      // for the browser-facing authority, without trusting forwarded headers.
      expectedOrigin.host = request.headers.get("host") ?? url.host;
      if (origin && origin !== expectedOrigin.origin)
        throw new AppError("Cross-origin writes are not allowed", 403);
    }
    if (route === "desktop/health" && method === "GET")
      return json({
        application: "ary-nexus",
        protocol: 1,
        liveUpdates: process.env.NODE_ENV === "development",
      });
    if (route === "config" && method === "GET")
      return json({
        mode: isDemo() ? "demo" : "supabase",
        configured:
          isDemo() ||
          Boolean(
            process.env.NEXT_PUBLIC_SUPABASE_URL &&
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
          ),
      });
    if (path[0] === "reflection" && process.env.NODE_ENV === "production")
      throw new AppError("Endpoint not found", 404);
    if (route === "brain-graph/sample" && process.env.NODE_ENV === "production")
      throw new AppError("Endpoint not found", 404);
    if (
      method === "GET" &&
      ["calendar/oauth/launch", "calendar/oauth/callback"].includes(route)
    )
      return await calendarOAuthResponse(request, route);
    if (
      method === "GET" &&
      ["gmail/oauth/launch", "gmail/oauth/callback"].includes(route)
    )
      return await calendarOAuthResponse(request, route, {
        oauth: gmailOAuth(),
        redirect: gmailRedirect(),
        path: "gmail",
        label: "Gmail",
      });
    if (
      route === "premiere/bridge/poll" ||
      route === "premiere/bridge/result"
    ) {
      authorizePremiereBridge(request);
      const bridge = new PremiereBridge(process.env.ARY_PREMIERE_USER_ID!);
      const input = await body(request);
      return json(
        route.endsWith("/poll")
          ? await bridge.poll(input)
          : await bridge.complete(input),
      );
    }
    if (["design/bridge/poll", "design/bridge/result"].includes(route)) {
      authorizeDesignBridge(request);
      const bridge = new DesignBridge(process.env.ARY_DESIGN_USER_ID!);
      const input = await body(request);
      return json(
        route.endsWith("/poll")
          ? await bridge.poll(input)
          : await bridge.complete(input),
      );
    }
    const {
      workers,
      outcomeEngine,
      skills,
      toolDiscovery,
      actionTools,
      memorySystem,
      agents,
      orchestrator,
      perception,
      phone,
      board,
      roi,
      voice,
      reflection,
      graph: graphQuery,
      repository,
      reembedding,
      reconciliation,
      memories,
      entities,
      actions,
      brain,
      realtimeVoice,
      provider,
      embeddingModel,
    } = await context(request);
    const realtimeRelay = () =>
      dependencies?.realtimeRelay ??
      realtimeVoiceRelayFor(repository.userId, realtimeVoice);
    if (
      route.startsWith("realtime/session") &&
      process.env.NODE_ENV === "production"
    )
      throw new AppError("Realtime relay is unavailable in production", 404);
    if (route === "realtime/session/start" && method === "POST") {
      const input = z
        .object({ conversation_id: z.uuid() })
        .strict()
        .parse(await body(request));
      required(
        await repository.get("conversations", input.conversation_id),
        "Conversation",
      );
      return json(
        await realtimeRelay().start(repository.userId, input.conversation_id),
        201,
      );
    }
    if (
      path[0] === "realtime" &&
      path[1] === "session" &&
      path.length === 4 &&
      path[3] === "audio" &&
      method === "POST"
    ) {
      const relayId = z.uuid().parse(path[2]);
      const audio = await binaryBody(request, REALTIME_MAX_BATCH_BYTES);
      return json(
        await realtimeRelay().append(repository.userId, relayId, audio),
      );
    }
    if (
      path[0] === "realtime" &&
      path[1] === "session" &&
      path.length === 4 &&
      path[3] === "status" &&
      method === "GET"
    ) {
      const relayId = z.uuid().parse(path[2]);
      return json(
        required(
          realtimeRelay().status(
            repository.userId,
            relayId,
            url.searchParams.get("include_closed") === "1",
          ),
          "Realtime relay",
        ),
      );
    }
    if (
      path[0] === "realtime" &&
      path[1] === "session" &&
      path.length === 4 &&
      path[3] === "stop" &&
      method === "POST"
    ) {
      const relayId = z.uuid().parse(path[2]);
      return json(await realtimeRelay().stop(repository.userId, relayId));
    }
    if (route === "workers/hermes/diagnostics" && method === "GET") {
      if (process.env.NODE_ENV === "production")
        throw new AppError("Not found", 404);
      return json(
        await actions.run("worker.read", null, () =>
          workers.diagnostics("hermes"),
        ),
      );
    }
    if (route === "outcome-engine" && method === "GET") {
      return json(
        await actions.run("outcome.read", null, async () => {
          for (const name of [
            "activity.read",
            "conversation.read",
            "entity.read",
            "skill.read",
          ])
            await actions.run(name, null, async () => true);
          let costs = false;
          try {
            await actions.run("roi.read", null, async () => true);
            costs = true;
          } catch (error) {
            if (!(error instanceof AppError && error.status === 403))
              throw error;
          }
          return outcomeEngine.report(costs);
        }),
      );
    }
    if (route === "skills" && method === "GET")
      return json(
        await actions.run("skill.read", null, async () => ({
          skills: await skills.list(),
          automations: await skills.automations(),
        })),
      );
    if (route === "memory-system" && method === "GET")
      return json(
        await actions.run("memory.read", null, () => memorySystem.list()),
      );
    if (path[0] === "memory-system" && path.length === 2 && method === "GET")
      return json(
        await actions.run("memory.read", null, () =>
          memorySystem.inspect(z.uuid().parse(path[1])),
        ),
      );
    if (path[0] === "knowledge" && path.length === 2 && method === "GET")
      return json(
        await actions.run("knowledge.read", null, () =>
          memorySystem.inspectKnowledge(z.uuid().parse(path[1])),
        ),
      );
    if (route === "knowledge" && method === "GET")
      return json(
        await actions.run("knowledge.read", null, () =>
          memorySystem.knowledge(
            (url.searchParams.get("q") ?? "").slice(0, 200),
          ),
        ),
      );
    if (route === "agents" && method === "GET")
      return json({
        agents: await agents.list(),
        models: agents.models.list(),
      });
    if (route === "nexus-map/intelligence" && method === "GET")
      return json(
        await new NexusIntelligenceService(repository, actions, memories).query(
          Object.fromEntries(url.searchParams),
        ),
      );
    if (route === "nexus-map" && method === "GET")
      return json(
        await new NexusMapService(
          repository,
          actions,
          new ActionRequestService(repository, actions, actionTools),
        ).query(Object.fromEntries(url.searchParams)),
      );
    if (route === "events" && method === "GET") {
      await authorizeEventRead(repository);
      const query = eventQuery.parse(Object.fromEntries(url.searchParams));
      return json(await repository.readEvents(query));
    }
    if (route === "events/stream" && method === "GET")
      return nexusEventStream(repository, request);
    if (route === "orchestrator/plans" && method === "GET")
      return json(await orchestrator.history());
    if (
      path[0] === "orchestrator" &&
      path[1] === "plans" &&
      path.length === 3 &&
      method === "GET"
    )
      return json(
        await new MissionControlService(
          repository,
          orchestrator,
          actions,
        ).inspect(z.uuid().parse(path[2])),
      );
    if (route === "perception/frames" && method === "POST") {
      const expected = new URL(request.url);
      expected.host = request.headers.get("host") ?? url.host;
      if (request.headers.get("origin") !== expected.origin)
        throw new AppError("Explicit same-origin capture upload required", 403);
      const grant = z.uuid().parse(request.headers.get("x-ary-capture-grant"));
      const reader = request.body?.getReader();
      if (!reader) throw new AppError("Image required");
      const chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_FRAME_BYTES) {
          await reader.cancel();
          throw new AppError("Image exceeds 3 MB", 413);
        }
        chunks.push(value);
      }
      return json(await perception.stage(grant, Buffer.concat(chunks)), 201);
    }
    if (route === "communications" && method === "GET") {
      const input = z
        .object({
          entity_id: z.uuid().optional(),
          offset: z.coerce.number().int().min(0).default(0),
          limit: z.coerce.number().int().min(1).max(100).default(50),
        })
        .strict()
        .parse(Object.fromEntries(url.searchParams));
      return json(
        await new CommunicationsService(repository, actions).read(input),
      );
    }
    if (route === "calls/config" && method === "GET")
      return json(
        await actions.run("phone.read", null, async () =>
          phone.configuration(),
        ),
      );
    if (route === "gmail/status" && method === "GET")
      return json(await new GoogleGmailProvider(repository.userId).status());
    if (route === "gmail/connect" && method === "POST") {
      if (isDemo()) throw new AppError("Sign in before connecting Gmail", 403);
      const input = z
        .object({ write: z.boolean().default(false) })
        .strict()
        .parse(await body(request));
      return json(
        await actions.permissions.ownerAction(
          "gmail.connect",
          { write: input.write, reason: "Owner requested Gmail consent" },
          () => gmailOAuth().begin(repository.userId, input.write),
        ),
      );
    }
    if (route === "gmail/disconnect" && method === "POST")
      return json(
        await actions.permissions.ownerAction(
          "gmail.disconnect",
          { reason: "Owner disconnected Gmail" },
          () => gmailOAuth().disconnect(repository.userId),
        ),
      );
    if (route === "calendar/status" && method === "GET")
      return json(await new GoogleCalendarProvider(repository.userId).status());
    if (route === "calendar/connect" && method === "POST") {
      if (isDemo())
        throw new AppError(
          "Sign in with Supabase before connecting a real Google account",
          403,
        );
      const input = z
        .object({ write: z.boolean().default(false) })
        .strict()
        .parse(await body(request));
      return json(
        await actions.permissions.ownerAction(
          "google_calendar.connect",
          {
            write: input.write,
            reason: "Owner requested Google Calendar consent",
          },
          () => new GoogleCalendarOAuth().begin(repository.userId, input.write),
        ),
      );
    }
    if (route === "calendar/disconnect" && method === "POST") {
      const input = z
        .object({ connection_id: z.uuid().optional() })
        .strict()
        .parse(await body(request));
      return json(
        await actions.permissions.ownerAction(
          "google_calendar.disconnect",
          { reason: "Owner disconnected Google Calendar", ...input },
          () =>
            new GoogleCalendarOAuth().disconnect(
              repository.userId,
              input.connection_id,
            ),
        ),
      );
    }
    if (route === "board/meetings" && method === "GET")
      return json(await board.history());
    if (route === "board/meetings" && method === "POST") {
      const input = boardRequest.parse(await body(request));
      const cancellation = new AbortController();
      const signal = AbortSignal.any([request.signal, cancellation.signal]);
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        cancel() {
          cancellation.abort();
        },
        async start(controller) {
          const send = (event: unknown) => {
            try {
              controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
            } catch {
              cancellation.abort();
            }
          };
          try {
            await board.run(input, send, signal);
          } catch (error) {
            send({
              type: "error",
              error:
                error instanceof AppError
                  ? error.message
                  : "Board meeting stopped or failed. Inspect Action history before retrying.",
            });
          } finally {
            try {
              controller.close();
            } catch {
              /* disconnected */
            }
          }
        },
      });
      return new Response(stream, {
        headers: {
          "Content-Type": "application/x-ndjson",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    if (route === "priorities" && method === "GET")
      return json(
        await actions.run("activity.read", null, () =>
          actions.run("entity.read", null, () =>
            actions.run("roi.read", null, () =>
              new PriorityService(repository).report(),
            ),
          ),
        ),
      );
    if (route === "roi" && method === "GET")
      return json(
        await actions.run("roi.read", null, () =>
          roi.report(
            url.searchParams.get("month") ??
              new Date().toISOString().slice(0, 7),
          ),
        ),
      );
    if (["roi/costs", "roi/outcomes"].includes(route) && method === "POST") {
      const input = await body(request);
      return json(
        await actions.run(
          "roi.record",
          null,
          async () =>
            route === "roi/costs"
              ? await roi.recordCost(input)
              : await roi.recordOutcome(input),
          input,
        ),
        201,
      );
    }
    if (route === "actions/request" && method === "POST") {
      const input = await body(request);
      const execute = () =>
        new ActionRequestService(repository, actions, actionTools).request(
          input,
        );
      if (request.headers.get("accept") === "application/x-ary-presence+ndjson")
        return presenceResponse(execute);
      return json(await execute(), 201);
    }
    if (route === "tools/catalog" && method === "GET")
      return json(await toolDiscovery.catalog());
    if (route === "tools/discover" && method === "POST")
      return json(await toolDiscovery.search(await body(request)));
    if (route === "actions/tools" && method === "GET") {
      const catalog = await new ActionRequestService(
        repository,
        actions,
        actionTools,
      ).catalog();
      await new NexusEventBus(repository).record({
        type: "skill.catalog_read",
        source: { kind: "backend", name: "ToolRegistry" },
        severity: "debug",
        payload: { count: catalog.length },
      });
      return json(catalog);
    }
    if (route === "actions/history" && method === "GET") {
      if (url.searchParams.get("category") === "phone")
        await actions.run("phone.read", null, async () => ({
          scope: "call_history",
        }));
      const offset = z.coerce
        .number()
        .int()
        .min(0)
        .parse(url.searchParams.get("offset") ?? 0);
      const [all, approvals, outcomes, calls] = await Promise.all([
        repository.list("actions"),
        repository.list("action_approvals"),
        repository.list("outcomes"),
        repository.list("model_calls"),
      ]);
      const pending = url.searchParams.get("pending") === "true";
      const filtered = all
        .toReversed()
        .filter(
          (action) =>
            url.searchParams.get("category") !== "phone" ||
            (action.tool_name.startsWith("phone.") &&
              action.tool_name !== "phone.read"),
        )
        .filter(
          (action) =>
            !pending ||
            (action.status === "approval_required" &&
              !approvals.some(
                (approval) =>
                  approval.action_id === action.id &&
                  (approval.decision === "rejected" || approval.consumed_at),
              )),
        );
      return json({
        total: filtered.length,
        offset,
        items: filtered.slice(offset, offset + 50).map((action) => ({
          ...action,
          approval:
            approvals.find(
              (a) =>
                a.action_id === action.id ||
                a.id === action.metadata.approval_id,
            ) ?? null,
          outcomes: outcomes.filter((o) => o.action_id === action.id),
          model_calls: calls.filter((c) => c.action_id === action.id),
        })),
      });
    }
    if (path[0] === "actions" && path.length === 3 && method === "POST") {
      const service = new ActionRequestService(
        repository,
        actions,
        actionTools,
        memories,
      );
      const id = z.uuid().parse(path[1]);
      if (path[2] === "revise")
        return json(await service.revise(id, await body(request)), 201);
      if (path[2] === "remember") return json(await service.remember(id), 201);
    }
    // Owner-only control plane: policy recovery remains available even under a no-access data policy.
    if (route === "permissions/emergency-stop" && method === "GET")
      return json(await actions.permissions.emergencyStatus());
    if (route === "permissions/emergency-stop" && method === "POST") {
      const input = z
        .object({
          active: z.boolean(),
          reason: z.string().trim().min(1).max(1000),
          revision: z.uuid().nullable(),
        })
        .strict()
        .parse(await body(request));
      return json(
        await actions.permissions.ownerAction(
          "permissions.emergency_stop",
          input,
          () =>
            actions.permissions.setEmergencyStop(
              input.active,
              input.reason,
              input.revision,
            ),
        ),
      );
    }
    if (route === "permissions" && method === "GET")
      return json({
        agents: (await repository.list("messages"))
          .filter((m) => m.metadata.agent_version === "agent-v1")
          .map((m) => ({
            id: m.id,
            name: (m.metadata.agent as { name?: string })?.name ?? m.id,
          })),
        levels: permissionLevels,
        development: process.env.NODE_ENV !== "production",
        tools: Object.fromEntries(
          Object.entries(toolRegistry).filter(
            ([name]) =>
              process.env.NODE_ENV !== "production" ||
              !name.startsWith("mock."),
          ),
        ),
        user_id: repository.userId,
        workspace: "ary-nexus",
        products: (await repository.list("entities")).filter((e) =>
          ["company", "project", "product"].includes(e.entity_type),
        ),
        policies: await actions.permissions.currentPolicies(),
        history: await repository.list("permission_policies"),
        attempts: (await repository.list("actions")).slice(-100).reverse(),
        approvals: await repository.list("action_approvals"),
      });
    if (route === "permissions/policies" && method === "POST") {
      const input = await body(request);
      return json(
        await actions.permissions.ownerAction("permissions.policy", input, () =>
          actions.permissions.savePolicy(input),
        ),
        201,
      );
    }
    if (
      path[0] === "permissions" &&
      path[1] === "attempts" &&
      path.length === 4 &&
      path[3] === "review" &&
      method === "POST"
    ) {
      const input = z
        .object({
          decision: z.enum(["approved", "rejected"]),
          reason: z.string().trim().min(1).max(1000),
        })
        .strict()
        .parse(await body(request));
      return json(
        await actions.permissions.ownerAction(
          "permissions.review",
          { action_id: path[2], ...input },
          () =>
            actions.permissions.review(
              z.uuid().parse(path[2]),
              input.decision,
              input.reason,
            ),
        ),
        201,
      );
    }
    if (
      path[0] === "permissions" &&
      path[1] === "attempts" &&
      path.length === 3 &&
      method === "GET"
    )
      return json(
        required(
          await repository.get("actions", z.uuid().parse(path[2])),
          "Action",
        ),
      );
    if (route === "voice/config" && method === "GET")
      return json(voice().describe());
    if (route === "voice/transcribe" && method === "POST") {
      const reader = request.body?.getReader();
      if (!reader) throw new AppError("Recording is required");
      const chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 5 * 1024 * 1024) {
          await reader.cancel();
          throw new AppError("Recording exceeds 5 MB", 413);
        }
        chunks.push(value);
      }
      const audio = new Blob([Buffer.concat(chunks)], {
        type: request.headers.get("content-type") ?? "",
      });
      if (request.headers.get("accept") === "application/x-ndjson")
        return await transcriptionResponse(
          actions,
          voice(),
          audio,
          request.signal,
        );
      return json(
        await actions.run("voice.transcribe", null, () =>
          voice().transcribe(audio, request.signal),
        ),
      );
    }
    if (route === "voice/speak" && method === "POST") {
      const { text } = z
        .object({ text: z.string().trim().min(1).max(700) })
        .strict()
        .parse(await body(request));
      const audio = await actions.run("voice.speak", null, () =>
        voice().synthesize(text, request.signal),
      );
      return new Response(audio, {
        headers: {
          "Content-Type": audio.type || "audio/mpeg",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    if (route === "brain-graph/sample" && method === "GET")
      return json({
        sample: true,
        ...queryLocalGraph(
          graphSample(),
          graphQuerySchema.parse(Object.fromEntries(url.searchParams)),
        ),
      });
    if (route === "brain-graph" && method === "GET")
      return json(
        await actions.run("entity.read", null, () =>
          graphQuery.query(Object.fromEntries(url.searchParams)),
        ),
      );
    if (route === "brain-graph/nodes" && method === "GET") {
      const input = Object.fromEntries(url.searchParams);
      if (input.root)
        throw new AppError("Use /api/brain-graph for neighborhoods");
      const result = await actions.run("entity.read", null, () =>
        graphQuery.query(input),
      );
      return json({
        version: result.version,
        nodes: result.nodes,
        meta: result.meta,
      });
    }
    if (route === "reflection" && method === "GET")
      return json(
        await actions.run("activity.read", null, async () => ({
          jobs: (await repository.list("reflection_jobs")).slice(-50).reverse(),
          proposals: (await repository.list("reflection_proposals"))
            .slice(-100)
            .reverse(),
        })),
      );
    if (route === "reflection/run" && method === "POST") {
      const input = z
        .object({ conversation_id: z.uuid() })
        .strict()
        .parse(await body(request));
      const job = await actions.run(
        "reflection.run",
        input.conversation_id,
        () => reflection.enqueueConversation(input.conversation_id),
      );
      if (!schedule)
        throw new AppError("Background scheduler unavailable", 503);
      schedule(async () => {
        await actions
          .run("reflection.run", input.conversation_id, () =>
            reflection.runJob(job.id),
          )
          .catch(() => {});
      });
      return json(job, 202);
    }
    if (
      path[0] === "reflection" &&
      path[1] === "jobs" &&
      path[3] === "retry" &&
      path.length === 4 &&
      method === "POST"
    ) {
      const id = z.uuid().parse(path[2]);
      required(await repository.get("reflection_jobs", id), "Reflection job");
      if (!schedule)
        throw new AppError("Background scheduler unavailable", 503);
      schedule(async () => {
        await actions
          .run("reflection.run", null, () => reflection.runJob(id))
          .catch(() => {});
      });
      return json({ queued: true }, 202);
    }
    if (
      path[0] === "reflection" &&
      path[1] === "proposals" &&
      path.length === 3 &&
      method === "POST"
    ) {
      const input = z
        .object({
          decision: z.enum(["accepted", "rejected"]),
          reason: z.string().trim().min(1).max(2000),
        })
        .strict()
        .parse(await body(request));
      return json(
        await actions.run("reflection.review", null, () =>
          reflection.review(
            z.uuid().parse(path[2]),
            input.decision,
            input.reason,
          ),
        ),
      );
    }
    if (route === "dashboard" && method === "GET") {
      const read = async <T>(
        tool: string,
        work: () => Promise<T[]>,
      ): Promise<T[]> => {
        try {
          return await actions.run(tool, null, work);
        } catch (error) {
          if (error instanceof AppError && error.status === 403) return [];
          throw error;
        }
      };
      if (url.searchParams.get("surface") === "mobile") {
        const [conversations, nodes, tasks, aliases] = await Promise.all([
          read("conversation.read", () => repository.list("conversations")),
          read("entity.read", () => repository.list("entities")),
          read("activity.read", () => repository.list("tasks")),
          read("entity.read", () => repository.list("entity_aliases")),
        ]);
        const visible = nodes.slice(-100);
        return json({
          reflectionDev: false,
          memoryRecords: [],
          memories: [],
          conflicts: [],
          jobs: [],
          graph: {
            nodes: visible.map((n) => ({
              ...n,
              description: "",
              metadata: {},
            })),
            edges: [],
          },
          aliases: aliases
            .filter((a) => visible.some((n) => n.id === a.entity_id))
            .slice(0, 200),
          conversations: conversations.slice(-20).reverse(),
          goals: [],
          decisions: [],
          tasks: tasks
            .slice(-30)
            .map((t) => ({ ...t, description: "", metadata: {} })),
          actions: [],
          outcomes: [],
          mode: isDemo() ? "demo" : "supabase",
          provider,
          embeddingModel,
        });
      }
      const [
        allMemories,
        graph,
        conversations,
        goals,
        decisions,
        tasks,
        logs,
        outcomes,
        conflicts,
        jobs,
        aliases,
      ] = await Promise.all([
        read("memory.read", () => repository.list("memories")),
        actions
          .run("entity.read", null, () => entities.getEntityGraph())
          .catch((error) => {
            if (error instanceof AppError && error.status === 403)
              return { nodes: [], edges: [] };
            throw error;
          }),
        read("conversation.read", () => repository.list("conversations")),
        read("activity.read", () => repository.list("goals")),
        read("activity.read", () => repository.list("decisions")),
        read("activity.read", () => repository.list("tasks")),
        read("activity.read", () => repository.list("actions")),
        read("activity.read", () => repository.list("outcomes")),
        read("memory.read", () => repository.list("memory_conflicts")),
        read("memory.read", () => repository.list("extraction_jobs")),
        read("entity.read", () => repository.list("entity_aliases")),
      ]);
      return json({
        reflectionDev: process.env.NODE_ENV !== "production",
        memoryRecords: allMemories.map(withoutEmbedding),
        conflicts: conflicts
          .filter((c) => c.status === "pending")
          .map((c) => ({
            ...c,
            existing: allMemories.find((m) => m.id === c.existing_memory_id)
              ?.content,
            candidate: allMemories.find((m) => m.id === c.candidate_memory_id)
              ?.content,
          })),
        jobs: jobs.filter((j) => j.status !== "completed"),
        aliases,
        memories: allMemories
          .filter((m) => isCurrentMemory(m))
          .map(withoutEmbedding),
        graph,
        conversations: conversations.reverse(),
        goals,
        decisions,
        tasks,
        actions: logs.slice(-30).reverse(),
        outcomes: outcomes.slice(-30).reverse(),
        mode: isDemo() ? "demo" : "supabase",
        provider,
        embeddingModel,
      });
    }
    if (
      path[0] === "memories" &&
      path[2] === "history" &&
      path.length === 3 &&
      method === "GET"
    )
      return json(
        await actions.run("memory.read", null, () =>
          memories.history(z.uuid().parse(path[1])),
        ),
      );
    if (route === "memory-timeline" && method === "GET")
      return json(
        await actions.run("memory.read", null, () =>
          memories.atTime(
            z.iso
              .datetime({ offset: true })
              .parse(url.searchParams.get("known_at")),
            z.iso
              .datetime({ offset: true })
              .optional()
              .parse(url.searchParams.get("valid_at") ?? undefined),
          ),
        ),
      );
    if (
      path[0] === "entities" &&
      path[2] === "aliases" &&
      path.length === 3 &&
      method === "POST"
    ) {
      const input = z
        .object({ alias: z.string() })
        .strict()
        .parse(await body(request));
      return json(
        await actions.run("entity.alias", null, () =>
          entities.addAlias(z.uuid().parse(path[1]), input.alias),
        ),
        201,
      );
    }
    if (path[0] === "conflicts" && path.length === 2 && method === "POST") {
      const input = z
        .object({
          resolution: z.enum(["replaced", "kept_existing", "kept_both"]),
          effective_at: z.iso
            .datetime({ offset: true })
            .nullable()
            .default(null),
        })
        .strict()
        .parse(await body(request));
      return json(
        await actions.run("memory.reconcile", null, () =>
          reconciliation.resolveConflict(
            z.uuid().parse(path[1]),
            input.resolution,
            input.effective_at,
          ),
        ),
      );
    }
    if (
      path[0] === "extraction-jobs" &&
      path[2] === "retry" &&
      path.length === 3 &&
      method === "POST"
    ) {
      const jobId = z.uuid().parse(path[1]);
      const previous = await repository.get("extraction_jobs", jobId);
      return json(
        await actions.run(
          "memory.extract",
          null,
          () => reconciliation.runJob(jobId),
          {
            extraction_job_id: jobId,
            source_message_id: previous?.source_message_id ?? null,
            previous_status: previous?.status ?? null,
            previous_attempts: previous?.attempts ?? null,
            previous_error: previous?.error ?? null,
          },
        ),
      );
    }
    if (route === "reembed" && method === "POST") {
      const input = z
        .object({
          limit: z.number().int().min(1).max(50).default(10),
          dry_run: z.boolean().default(false),
        })
        .strict()
        .parse(await body(request));
      return json(
        await actions.run("memory.reembed", null, () =>
          reembedding.run(input.limit, input.dry_run),
        ),
      );
    }
    if (route === "model-calls" && method === "GET")
      return json(
        await actions.run("activity.read", null, async () =>
          (await repository.list("model_calls")).slice(-50).reverse(),
        ),
      );
    if (route === "seed" && method === "POST") {
      const { seed } = await import("../infrastructure/seed");
      await actions.run("workspace.seed", null, () =>
        seed(repository, entities, memories),
      );
      return json({ ok: true });
    }
    if (route === "chat" && method === "POST") {
      const input = chatInput.parse(await body(request));
      if (input.conversation_id)
        required(
          await repository.get("conversations", input.conversation_id),
          "Conversation",
        );
      let finish: () => void = () => {};
      const finished = new Promise<void>((resolve) => {
        finish = resolve;
      });
      if (schedule)
        schedule(async () => {
          await finished;
          if (process.env.ARY_REFLECTION_ENABLED !== "false")
            await actions
              .run("reflection.run", null, () => reflection.drain(2))
              .catch(() => {});
        });
      const encoder = new TextEncoder();
      const generation = new AbortController();
      const signal = AbortSignal.any([request.signal, generation.signal]);
      const stream = new ReadableStream({
        cancel() {
          generation.abort();
        },
        async start(controller) {
          // Continue persistence if the browser disconnects; no unawaited background promises.
          let disconnected = false;
          const send = (event: unknown) => {
            if (!disconnected)
              try {
                controller.enqueue(
                  encoder.encode(JSON.stringify(event) + "\n"),
                );
              } catch {
                disconnected = true;
              }
          };
          try {
            await presenceTelemetry.run(
              (event) => {
                if (
                  !event.label.startsWith("brain.respond:") &&
                  !event.label.startsWith("memory.extract:")
                )
                  send({ type: "presence", event });
              },
              async () => {
                for await (const event of brain.respond(input, {
                  signal,
                  onDelta: (text) => send({ type: "delta", text }),
                  onPresence: (event) => send({ type: "presence", event }),
                }))
                  send(event);
              },
            );
          } catch (error) {
            console.error("Brain pipeline failed", error);
            send({
              type: "error",
              error:
                error instanceof AppError
                  ? error.message
                  : "Ary could not complete this response. Check provider settings and try again.",
            });
          } finally {
            try {
              controller.close();
            } catch {
              /* client disconnected */
            }
            finish();
          }
        },
      });
      return new Response(stream, {
        headers: {
          "Content-Type": "application/x-ndjson",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    if (route === "memories" && method === "GET")
      return json(
        await actions.run("memory.read", null, async () =>
          url.searchParams.has("q")
            ? await memories.searchMemories(
                z
                  .string()
                  .max(10000)
                  .parse(url.searchParams.get("q") ?? ""),
              )
            : (await repository.list("memories"))
                .filter((m) => isCurrentMemory(m))
                .map(withoutEmbedding),
        ),
      );
    if (route === "memories" && method === "POST") {
      const data = await body(request);
      return json(
        withoutEmbedding(
          await actions.run("memory.create", null, () =>
            memories.createMemory(data),
          ),
        ),
        201,
      );
    }
    if (path[0] === "memories" && path.length === 2) {
      const id = z.uuid().parse(path[1]);
      if (method === "PATCH") {
        const data = await body(request);
        return json(
          withoutEmbedding(
            await actions.run("memory.update", null, () =>
              memories.updateMemory(id, data),
            ),
          ),
        );
      }
      if (method === "DELETE")
        return json(
          withoutEmbedding(
            await actions.run("memory.archive", null, () =>
              memories.archiveMemory(id),
            ),
          ),
        );
    }
    if (
      path[0] === "memories" &&
      path.length === 3 &&
      path[2] === "entities" &&
      method === "POST"
    ) {
      const id = z.uuid().parse(path[1]);
      const input = z
        .object({ entity_id: z.uuid() })
        .strict()
        .parse(await body(request));
      return json(
        await actions.run("memory.link", null, () =>
          memories.linkMemoryToEntity(id, input.entity_id),
        ),
        201,
      );
    }
    if (route === "entities" && method === "GET")
      return json(
        await actions.run("entity.read", null, () =>
          entities.searchEntities(url.searchParams.get("q") ?? ""),
        ),
      );
    if (route === "entities" && method === "POST") {
      const data = await body(request);
      return json(
        await actions.run("entity.create", null, () =>
          entities.createEntity(data),
        ),
        201,
      );
    }
    if (
      path[0] === "relationships" &&
      path.length === 3 &&
      path[2] === "history" &&
      method === "GET"
    ) {
      const id = z.uuid().parse(path[1]);
      required(await repository.get("relationships", id), "Relationship");
      return json(
        await actions.run("entity.read", null, () =>
          repository.list("relationship_versions", { record_id: id }),
        ),
      );
    }
    if (path[0] === "relationships" && path.length === 2 && method === "DELETE")
      return json(
        await actions.run("entity.link", null, () =>
          entities.endRelationship(z.uuid().parse(path[1])),
        ),
      );
    if (route === "relationships" && method === "GET")
      return json(
        await actions.run("entity.read", null, () =>
          repository.list("relationships"),
        ),
      );
    if (route === "relationships" && method === "POST") {
      const data = await body(request);
      return json(
        await actions.run("entity.link", null, () =>
          entities.linkEntities(data),
        ),
        201,
      );
    }
    if (route === "graph" && method === "GET")
      return json(
        await actions.run("entity.read", null, () =>
          entities.getEntityGraph(
            z
              .uuid()
              .optional()
              .parse(url.searchParams.get("root") ?? undefined),
            z.coerce
              .number()
              .int()
              .min(0)
              .max(5)
              .parse(url.searchParams.get("depth") ?? 2),
          ),
        ),
      );
    if (route === "conversations" && method === "GET")
      return json(
        await actions.run("conversation.read", null, () =>
          repository.list("conversations"),
        ),
      );
    if (
      path[0] === "conversations" &&
      path.length === 3 &&
      path[2] === "messages" &&
      method === "GET"
    ) {
      const id = z.uuid().parse(path[1]);
      required(await repository.get("conversations", id), "Conversation");
      return json(
        await actions.run("conversation.read", id, () =>
          repository.list("messages", { conversation_id: id }),
        ),
      );
    }
    throw new AppError("Endpoint not found", 404);
  } catch (error) {
    if (error instanceof ApprovalRequiredError)
      return json(
        {
          error: error.message,
          code: "approval_required",
          action_id: error.actionId,
          tool: error.tool,
        },
        409,
      );
    if (error instanceof z.ZodError)
      return json({ error: "Validation failed", issues: error.issues }, 400);
    if (error instanceof AppError)
      return json({ error: error.message }, error.status);
    console.error("API failure", error);
    return json({ error: "Internal server error" }, 500);
  }
}
