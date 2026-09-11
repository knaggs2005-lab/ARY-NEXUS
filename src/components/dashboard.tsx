"use client";

import { presenceOperation } from "./presence/store";

import dynamic from "next/dynamic";
import type { ShellBridge } from "./spatial/modules";
import { ProjectState } from "./project-state";
import {
  noteKnowledgeCreated,
  clearKnowledgeEvents,
} from "./brain/effects/knowledge-events";
import { CommandPalette } from "./commands/command-palette";
import type { Destination } from "./commands/command-index";

import type { CommunicationSource } from "../domain/communications";
import { ApprovalDialog } from "./approval-dialog";
import { MemorySources } from "./memory-sources";
import { RoutingDetail } from "./models/routing-detail";

import { TaskUpdateCard } from "./task-update-card";
import { TaskProposal } from "./task-proposal";

import { useAryVoice } from "./voice/use-ary-voice";
import { AryPresence } from "./nexus/primitives";
import { AmbientConversation } from "./voice/ambient-conversation";
import { VoiceControls } from "./voice/voice-controls";
import { NexusShell } from "./nexus/nexus-shell";
import { NexusState } from "./nexus/primitives";

const ActivityInspector = dynamic(
  () => import("./events/activity-inspector").then((m) => m.ActivityInspector),
  { loading: () => <NexusState title="Opening workspace…" /> },
);
const OrchestratorPanel = dynamic(
  () =>
    import("./orchestrator/orchestrator-panel").then(
      (m) => m.OrchestratorPanel,
    ),
  { loading: () => <NexusState title="Opening workspace…" /> },
);
const PerceptionPanel = dynamic(
  () => import("./perception/perception-panel").then((m) => m.PerceptionPanel),
  { loading: () => <NexusState title="Opening workspace…" /> },
);
const StudioPanel = dynamic(
  () => import("./studio/studio-panel").then((m) => m.StudioPanel),
  { loading: () => <NexusState title="Opening workspace…" /> },
);
const CallsPanel = dynamic(
  () => import("./calls/calls-panel").then((m) => m.CallsPanel),
  { loading: () => <NexusState title="Opening workspace…" /> },
);
const PremierePanel = dynamic(
  () => import("./creative/premiere-panel").then((m) => m.PremierePanel),
  { loading: () => <NexusState title="Opening workspace…" /> },
);
const CommunicationsHub = dynamic(
  () =>
    import("./communications/communications-hub").then(
      (m) => m.CommunicationsHub,
    ),
  { loading: () => <NexusState title="Opening workspace…" /> },
);
const RoiDashboard = dynamic(
  () => import("./roi-dashboard").then((m) => m.RoiDashboard),
  { loading: () => <NexusState title="Opening workspace…" /> },
);
const ActionCenter = dynamic(
  () => import("./action-center").then((m) => m.ActionCenter),
  { loading: () => <NexusState title="Opening workspace…" /> },
);
const PermissionsPanel = dynamic(
  () => import("./permissions-panel").then((m) => m.PermissionsPanel),
  { loading: () => <NexusState title="Opening workspace…" /> },
);
const ReflectionPanel = dynamic(
  () => import("./reflection-panel").then((m) => m.ReflectionPanel),
  { loading: () => <NexusState title="Opening workspace…" /> },
);

const MobileCompanion = dynamic(() => import("./mobile/mobile-companion"));
const SkillBuilder = dynamic(() => import("./skills/skill-builder"));
import { voiceState } from "./voice/voice-state";
import nexusStyles from "./nexus/nexus.module.css";
const ControlPanel = dynamic(() =>
  import("./control/control-panel").then((m) => m.ControlPanel),
);
const ToolsView = dynamic(() =>
  import("./tools/tools-view").then((m) => m.ToolsView),
);
const NexusMapExperience = dynamic(
  () => import("./atlas/nexus-map").then((m) => m.NexusMapExperience),
  { loading: () => <NexusState title="Opening Brain Graph…" /> },
);
const GmailView = dynamic(() =>
  import("./gmail/gmail-view").then((m) => m.GmailView),
);
const FinanceView = dynamic(() =>
  import("./finance/finance-view").then((m) => m.FinanceView),
);
const CalendarView = dynamic(() =>
  import("./calendar/calendar-view").then((m) => m.CalendarView),
);
const AgentsView = dynamic(() =>
  import("./agents/agents-view").then((m) => m.AgentsView),
);
const BoardView = dynamic(() =>
  import("./board/board-view").then((m) => m.BoardView),
);
const PriorityView = dynamic(
  () => import("./priority/priority-view").then((m) => m.PriorityView),
  {
    loading: () => <p>Reading priority evidence…</p>,
  },
);
const MemorySystemView = dynamic(() =>
  import("./memory-system-view").then((m) => m.MemorySystemView),
);

import { EntityResolutionDebug } from "./entity-resolution-debug";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type {
  Action,
  Conversation,
  Decision,
  Goal,
  Graph,
  Memory,
  MemoryHit,
  Message,
  Outcome,
  Task,
} from "@/domain/models";
import { memoryTypes, entityTypes } from "@/domain/models";
import type { BrainEvent } from "@/services/ary-brain-service";
import { api, authClient } from "./api";
import { KnowledgeReview, type ConflictView } from "./knowledge-review";
import type { EntityAlias, ExtractionJob } from "@/domain/models";

type Tab =
  | "Skills"
  | "Tools"
  | "Computer & Browser"
  | "Automations"
  | "Calls"
  | "Creative"
  | "Studio"
  | "Execution Plans"
  | "Perception"
  | "Communications"
  | "Calendar"
  | "Agent Runtime"
  | "Board"
  | "Priority"
  | "Approvals"
  | "Action history"
  | "Finance"
  | "ROI"
  | "Settings"
  | "Reflection"
  | "Chat"
  | "Memory review"
  | "Memory map"
  | "World map"
  | "Memories"
  | "Entities"
  | "Relationships"
  | "Graph"
  | "Activity";
type MemoryView = Omit<Memory, "embedding">;
interface Data {
  reflectionDev: boolean;
  memories: MemoryView[];
  memoryRecords: MemoryView[];
  conflicts: ConflictView[];
  jobs: ExtractionJob[];
  aliases: EntityAlias[];
  graph: Graph;
  conversations: Conversation[];
  goals: Goal[];
  decisions: Decision[];
  tasks: Task[];
  actions: Action[];
  outcomes: Outcome[];
  mode: string;
  provider: string;
  embeddingModel: string;
}
const titles: Record<Tab, [string, string]> = {
  "Memory map": [
    "Memory, in context.",
    "Evidence, episodes and recorded changes in the shared Nexus map.",
  ],
  "World map": [
    "Your connected world.",
    "People, projects and the outcomes that connect them.",
  ],
  Skills: [
    "Reusable intelligence.",
    "Versioned workflows, explicit review, and the same Ary execution system.",
  ],
  "Computer & Browser": [
    "Controlled digital presence.",
    "Inspect, review and execute through Ary permissions.",
  ],
  Tools: [
    "Connected by intent.",
    "Inspect capabilities and review an action before execution.",
  ],
  Automations: [
    "Work, coordinated.",
    "Existing plans with explicit authority at every step.",
  ],
  "Execution Plans": [
    "One goal. Coordinated action.",
    "Dependency-aware plans, explicit approvals and evidence at every step.",
  ],
  Perception: [
    "Evidence in view.",
    "Explicit images. Clear observations. Bounded visual verification.",
  ],
  Studio: [
    "The room, in concert.",
    "Reviewed scenes. Clear device state. Every change accounted for.",
  ],
  Creative: [
    "A deliberate creative partner.",
    "Premiere operations through existing permissions and reviewed actions.",
  ],
  Calls: [
    "A clear voice. An explicit request.",
    "Reviewed scripts, attributed calls, and deliberate follow-up.",
  ],
  Communications: [
    "Context before correspondence.",
    "Shared communication history, source evidence, and deliberate follow-ups.",
  ],
  Calendar: [
    "Space for what matters.",
    "Calendar context, connected to Nexus and reviewed before change.",
  ],
  "Agent Runtime": [
    "Agent Runtime",
    "Specialized workers. Shared intelligence. Scoped execution.",
  ],
  Board: [
    "One table. One direction.",
    "Six perspectives, shared evidence, one daily plan.",
  ],
  Priority: [
    "Choose what moves you forward.",
    "Evidence, tradeoffs, and a clear next focus.",
  ],
  Approvals: [
    "Review before action.",
    "Inspect, edit, approve, or reject Ary’s proposed requests.",
  ],
  "Action history": [
    "Every attempt, accounted for.",
    "Trace requests, decisions, results, and evidence.",
  ],
  Finance: [
    "Money, with context.",
    "Recorded accounts, source evidence, and clear boundaries.",
  ],
  ROI: [
    "Ary Economics",
    "Costs, outcomes, and contribution backed by evidence.",
  ],
  Settings: [
    "Trust, made explicit.",
    "Control what Ary can observe, propose, prepare, and execute.",
  ],
  Reflection: [
    "Learn with evidence.",
    "Review observations, proposed changes, and the reasons behind each decision.",
  ],
  "Memory review": [
    "Knowledge with evidence.",
    "Review changes, inspect sources, and explore what Ary knew.",
  ],
  Chat: [
    "Think with context.",
    "A conversation connected to your persistent knowledge.",
  ],
  Memories: [
    "A memory that lasts.",
    "Structured knowledge, with importance, confidence, and provenance.",
  ],
  Entities: [
    "Everything has a place.",
    "The people, companies, and projects in Ary’s world.",
  ],
  Relationships: [
    "Context is connected.",
    "Explicit, directed relationships between your entities.",
  ],
  Graph: [
    "See the connections.",
    "Explore the structure of your intelligence workspace.",
  ],
  Activity: [
    "An inspectable system.",
    "Actions, outcomes, and the goals behind the work.",
  ],
};
function percent(n: number) {
  return `${Math.round(n * 100)}%`;
}
function ResponseMetrics({ metadata }: { metadata: Message["metadata"] }) {
  const raw = metadata.model_usage;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const usage = raw as Record<string, unknown>;
  const number = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value)
      ? String(value)
      : "Unknown";
  return (
    <details className="small">
      <summary>Response metrics</summary>
      <p>
        Response latency: {number(metadata.response_latency_ms)} ms · Model
        latency: {number(usage.latency_ms)} ms
        <br />
        Tokens in / out: {number(usage.input_tokens)} /{" "}
        {number(usage.output_tokens)}
        <br />
        Retrieved: {number(usage.retrieval_count)} · Reasoning cost estimate:{" "}
        {typeof usage.estimated_cost_usd === "number"
          ? `$${usage.estimated_cost_usd.toFixed(6)}`
          : "Unknown"}
      </p>
    </details>
  );
}
export function Dashboard({
  shellBridge,
  mobile = false,
}: { shellBridge?: ShellBridge; mobile?: boolean } = {}) {
  const [financeFocusKey, setFinanceFocusKey] = useState<string | null>(null);
  const [calendarFocusId, setCalendarFocusId] = useState<string | null>(null);
  const [calendarFocusAccount, setCalendarFocusAccount] = useState<
    string | null
  >(null);
  const [communicationMode, setCommunicationMode] = useState<"hub" | "gmail">(
    "hub",
  );
  const [mailSource, setMailSource] = useState<
    CommunicationSource | undefined
  >();
  const [contextOpen, setContextOpen] = useState(false);
  const [agentMissionId, setAgentMissionId] = useState<string>();
  const [tab, setTab] = useState<Tab>("Chat");
  const [commandTool, setCommandTool] = useState<{
    name: string;
    revision: number;
  } | null>(null);
  const [commandFocus, setCommandFocus] = useState<{
    id: string;
    revision: number;
  } | null>(null);
  useEffect(() => {
    if (!commandFocus) return;
    const frame = requestAnimationFrame(() => {
      const target = document.getElementById(commandFocus.id);
      target?.scrollIntoView({
        block: "center",
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
      });
      target?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [commandFocus]);
  function navigateCommand(destination: Destination) {
    shellBridge?.onReveal?.();
    setTab(destination.tab as Tab);
    if (destination.recordId)
      setCommandFocus({ id: destination.recordId, revision: Date.now() });
    else if (destination.tab === "Chat")
      setCommandFocus({ id: "chat-input", revision: Date.now() });
    if (destination.tool)
      setCommandTool({ name: destination.tool, revision: Date.now() });
    if (destination.query) {
      setSearch(destination.query);
      void findMemories(undefined, destination.query);
    }
  }
  const [graphFocus, setGraphFocus] = useState<string | undefined>();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [configured, setConfigured] = useState(true);
  const [busy, setBusy] = useState(false);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [voicePreview, setVoicePreview] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [generating, setGenerating] = useState(false);
  const generation = useRef<AbortController | null>(null);
  const accepted = useRef(false);
  const cancelPending = useRef(false);
  const [pendingVoice, setPendingVoice] = useState<string | null>(null);
  const voice = useAryVoice((text, continuous) => {
    if (continuous) {
      setPendingVoice(text);
      return;
    }
    setInput(text);
    setVoicePreview(true);
  }, cancelResponse);
  function cancelResponse() {
    setPendingVoice(null);
    if (generation.current) {
      if (accepted.current) generation.current.abort();
      else {
        cancelPending.current = true;
        setPhase("Cancelling after your message is safely saved…");
      }
    }
    voice.stopSpeaking();
  }
  useEffect(() => () => generation.current?.abort(), []);
  useEffect(() => {
    const stop = () => {
      generation.current?.abort();
      voice.stopSpeaking();
      voice.cancelCapture();
    };
    window.addEventListener("ary:emergency-stop", stop);
    return () => window.removeEventListener("ary:emergency-stop", stop);
  });

  useEffect(() => {
    if (tab !== "Chat" && !voice.isSessionActive()) {
      voice.stopSpeaking();
      voice.cancelCapture();
    }
  }, [tab]);
  useEffect(() => {
    if (shellBridge?.navigation) setTab(shellBridge.navigation.tab);
  }, [shellBridge?.navigation]);
  useEffect(() => {
    if (shellBridge && !shellBridge.active && !voice.isSessionActive()) {
      // The shell only calls existing cleanup methods when hiding the workspace.
      cancelResponse();
      voice.cancelCapture();
    }
  }, [shellBridge?.active]);
  useEffect(() => {
    shellBridge?.onSummary({
      connected: !!data && !needsLogin,
      memories: data?.memories.length ?? 0,
      entities: data?.graph.nodes.length ?? 0,
      projects:
        data?.graph.nodes.filter((e) => e.entity_type === "project").length ??
        0,
      tasks:
        data?.tasks.filter(
          (t) => !["completed", "cancelled"].includes(t.status),
        ).length ?? 0,
      actions: data?.actions.length ?? 0,
      blockedProjects:
        data?.graph.nodes.filter(
          (e) => e.entity_type === "project" && e.metadata.status === "blocked",
        ).length ?? 0,
    });
  }, [data, needsLogin, shellBridge?.onSummary]);
  const [selected, setSelected] = useState<string | null>(null);
  const [phase, setPhase] = useState("");
  const [memoryForm, setMemoryForm] = useState(false);
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<MemoryView[] | null>(null);
  const [searching, setSearching] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  async function refresh() {
    const next: Data = await (
      await api(mobile ? "dashboard?surface=mobile" : "dashboard")
    ).json();
    setData(next);
    return next;
  }
  async function openConversation(id: string) {
    voice.stopSpeaking();
    voice.cancelCapture();
    setVoicePreview(false);
    setInput("");
    setBusy(true);
    setError("");
    try {
      const rows: Message[] = await (
        await api(`conversations/${id}/messages`)
      ).json();
      setMessages(rows);
      setConversationId(id);
      setSelected(rows.findLast((m) => m.role === "assistant")?.id ?? null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    let active = true;
    async function initialize() {
      try {
        const config = await (await api("config")).json();
        if (!active) return;
        setConfigured(config.configured);
        if (
          config.mode === "supabase" &&
          (!authClient || !(await authClient.auth.getSession()).data.session)
        ) {
          setNeedsLogin(true);
          return;
        }
        const next = await refresh();
        if (next.conversations[0] && active)
          await openConversation(next.conversations[0].id);
      } catch (e) {
        if (active) setError((e as Error).message);
      } finally {
        if (active) setLoading(false);
      }
    }
    void initialize();
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages, phase]);
  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      if (!authClient)
        throw new Error("Set the Supabase environment variables first.");
      const { error: authError } = await authClient.auth.signInWithPassword({
        email: String(form.get("email")),
        password: String(form.get("password")),
      });
      if (authError) throw authError;
      setNeedsLogin(false);
      const next = await refresh();
      if (next.conversations[0])
        await openConversation(next.conversations[0].id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!voice.sessionActive) {
      setPendingVoice(null);
      return;
    }
    if (pendingVoice && !busy && voice.capture === "idle") {
      setPendingVoice(null);
      void send(undefined, pendingVoice);
    }
  }, [pendingVoice, busy, voice.capture, voice.sessionActive]);
  async function send(event?: FormEvent, spoken?: string) {
    event?.preventDefault();
    if (
      !(spoken ?? input).trim() ||
      busy ||
      generation.current ||
      voice.capture !== "idle"
    )
      return;
    setError("");
    setNotice("");
    setBusy(true);
    setPhase("Resolving entities and retrieving memories…");
    const activity = presenceOperation("Waiting for Ary");
    const controller = new AbortController();
    generation.current = controller;
    accepted.current = false;
    cancelPending.current = false;
    setGenerating(true);
    setStreamingText("");
    voice.beginResponse();
    const modality = spoken !== undefined || voicePreview ? "voice" : "text";
    setVoicePreview(false);
    const content = (spoken ?? input).trim();
    setInput("");
    const now = new Date().toISOString();
    const optimisticId = crypto.randomUUID();
    setMessages((current) => [
      ...current,
      {
        id: optimisticId,
        user_id: "",
        conversation_id: conversationId ?? "",
        role: "user",
        content,
        metadata: {},
        created_at: now,
        updated_at: now,
      },
    ]);
    try {
      const response = await api("chat", {
        method: "POST",
        signal: controller.signal,
        body: JSON.stringify({
          input: content,
          time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          modality,
          conversation_id: conversationId,
        }),
      });
      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response stream");
      const decoder = new TextDecoder();
      let buffer = "";
      let completed = false;
      let assistantId = "";
      let receivedDeltas = false;
      function consume(line: string) {
        if (!line.trim()) return;
        const event: BrainEvent = JSON.parse(line);
        if (controller.signal.aborted) return;
        if (event.type === "presence") {
          activity.update(event.event);
          setPhase(event.event.label);
        }
        if (event.type === "error") throw new Error(event.error);
        if (event.type === "delta") {
          receivedDeltas = true;
          setStreamingText((current) => current + event.text);
          voice.delta(event.text);
          setPhase("Ary is responding…");
        }
        if (event.type === "cancelled") {
          setGenerating(false);
          setStreamingText("");
          voice.stopSpeaking();
        }
        if (event.type === "entities") {
          accepted.current = true;
          setConversationId(event.message.conversation_id);
          if (cancelPending.current) controller.abort();
          setMessages((current) =>
            current.map((m) => (m.id === optimisticId ? event.message : m)),
          );
        }
        if (event.type === "response") {
          setStreamingText("");
          setGenerating(false);
          generation.current = null;
          if (!receivedDeltas) voice.delta(event.message.content);
          voice.finishResponse();
          assistantId = event.message.id;
          setConversationId(event.conversation_id);
          setMessages((current) => [...current, event.message]);
          setSelected(event.message.id);
          setPhase("Response delivered. Extracting durable memories…");
        }
        if (event.type === "complete") {
          completed = true;
          activity.finish(
            event.warnings.length ? "error" : "complete",
            event.warnings.length
              ? "Memory update needs attention"
              : "Conversation and memory check saved",
          );
          for (const id of event.saved_memory_ids)
            noteKnowledgeCreated({ id, kind: "memory", entityIds: [] });
          setNotice(
            event.warnings.length
              ? event.warnings.join(" ")
              : event.saved_memory_ids.length
                ? `${event.saved_memory_ids.length} new memory saved.`
                : "Conversation saved. No new durable memories extracted.",
          );
          setMessages((current) =>
            current.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    metadata: {
                      ...m.metadata,
                      extraction_status: event.warnings.length
                        ? "failed"
                        : "completed",
                      saved_memory_ids: event.saved_memory_ids,
                      warnings: event.warnings,
                    },
                  }
                : m,
            ),
          );
        }
      }
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) consume(line);
      }
      buffer += decoder.decode();
      consume(buffer);
      if (!completed)
        throw new Error(
          "Connection ended before memory save status arrived. Reload the conversation to check.",
        );
      await refresh();
    } catch (e) {
      activity.finish(
        controller.signal.aborted ? "waiting" : "error",
        controller.signal.aborted
          ? "Interrupted · background save may continue"
          : "Ary response failed",
      );
      voice.stopSpeaking();
      if (controller.signal.aborted)
        setNotice(
          "Response interrupted. Your saved message will still be checked for durable memories; reload the conversation to see completion.",
        );
      else setError((e as Error).message);
    } finally {
      generation.current = null;
      setGenerating(false);
      setStreamingText("");
      setBusy(false);
      setPhase("");
    }
  }
  async function mutate(path: string, body: unknown, method = "POST") {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await api(path, {
        method,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (
        method === "POST" &&
        (path === "memories" || path === "relationships")
      ) {
        const created = await response.json();
        if (typeof created.id === "string")
          noteKnowledgeCreated({
            id: created.id,
            kind: path === "memories" ? "memory" : "relationship",
            entityIds:
              path === "relationships"
                ? [created.source_entity_id, created.target_entity_id].filter(
                    (id): id is string => typeof id === "string",
                  )
                : [],
          });
      }
      await refresh();
      setSearchResults(null);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function addMemory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (
      await mutate("memories", {
        content: form.get("content"),
        summary: form.get("summary"),
        memory_type: form.get("memory_type"),
        importance_score: Number(form.get("importance_score")),
        confidence_score: Number(form.get("confidence_score")),
      })
    ) {
      setMemoryForm(false);
      setNotice("Memory saved and indexed for retrieval.");
    }
  }
  async function findMemories(event?: FormEvent, query = search) {
    event?.preventDefault();
    setSearching(true);
    setError("");
    try {
      setSearchResults(
        query.trim()
          ? await (await api(`memories?q=${encodeURIComponent(query)}`)).json()
          : null,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSearching(false);
    }
  }
  const selectedMessage = messages.find((m) => m.id === selected);
  const retrieved = (selectedMessage?.metadata.retrieved_memories ??
    []) as MemoryHit[];
  if (loading)
    return (
      <main className={`${nexusStyles.shell} auth-screen`}>
        <NexusState title="Opening Ary Nexus…">
          Connecting to your workspace.
        </NexusState>
      </main>
    );
  if (needsLogin)
    return (
      <main className={`${nexusStyles.shell} auth-screen`}>
        <form className="auth-card" onSubmit={login}>
          <div className="brand-mark">a</div>
          <h1>Ary Nexus</h1>
          <p>Sign in to your intelligence workspace.</p>
          {!configured && (
            <p className="error">
              Configure Supabase in .env.local, or enable the local development
              demo. See README.md.
            </p>
          )}
          <label>
            Email
            <input name="email" type="email" autoComplete="username" required />
          </label>
          <label>
            Password
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </label>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <button className="primary" disabled={busy || !configured}>
            Sign in
          </button>
          <small>Create your user through Supabase Auth to get started.</small>
        </form>
      </main>
    );
  if (mobile)
    return (
      <MobileCompanion
        data={data}
        voice={voice}
        busy={busy}
        generating={generating}
        input={input}
        onInput={setInput}
        messages={messages}
        streamingText={streamingText}
        conversationId={conversationId}
        onConversation={openConversation}
        onSend={() => void send()}
        onStop={() => {
          voice.interruptAll();
          cancelResponse();
        }}
        error={error}
        notice={notice}
        onRefresh={refresh}
        onSignOut={async () => {
          voice.interruptAll();
          cancelResponse();
          clearKnowledgeEvents();
          await authClient?.auth.signOut();
          setData(null);
          setMessages([]);
          setNeedsLogin(true);
        }}
      />
    );
  return (
    <NexusShell
      tab={tab}
      onNavigate={(next) => navigateCommand({ tab: next })}
      voiceState={voiceState({
        capture: voice.capture,
        playback: voice.playback,
        generating,
        busy,
        preview: voicePreview,
        interrupted: voice.interrupted,
        error: voice.error || error,
      })}
      level={voice.level}
      environment={
        data
          ? data.mode === "demo"
            ? "Local demo"
            : "Supabase"
          : "Disconnected"
      }
      provider={data?.provider ?? "Provider unavailable"}
      reflectionDev={!!data?.reflectionDev}
      contextOpen={contextOpen}
      onContext={() => setContextOpen((v) => !v)}
      notice={notice}
      error={error}
      onDismissNotice={() => setNotice("")}
      onDismissError={() => setError("")}
      onRetry={() => void refresh().catch((e) => setError(e.message))}
      onOrbit={shellBridge?.onOrbit}
      ambient={(openConversation) => (
        <AmbientConversation
          voice={voice}
          busy={busy}
          generating={generating}
          latestUser={
            messages.findLast((m) => m.role === "user")?.content ?? ""
          }
          latestAnswer={
            streamingText ||
            messages.findLast((m) => m.role === "assistant")?.content ||
            ""
          }
          onConversation={() => {
            openConversation();
            navigateCommand({ tab: "Chat" });
          }}
          onApprovals={() => navigateCommand({ tab: "Approvals" })}
        />
      )}
      voiceSessionActive={voice.sessionActive}
      audioActive={
        voice.sessionActive ||
        generating ||
        voice.capture !== "idle" ||
        voice.playback !== "idle"
      }
      onStop={() => {
        voice.interruptAll();
        cancelResponse();
      }}
      onSignOut={
        data?.mode === "supabase"
          ? async () => {
              generation.current?.abort();
              voice.stopSpeaking();
              voice.cancelCapture();
              clearKnowledgeEvents();
              await authClient?.auth.signOut();
              setData(null);
              setMessages([]);
              setNeedsLogin(true);
            }
          : undefined
      }
    >
      <ApprovalDialog />
      {data && (
        <CommandPalette
          showLauncher={shellBridge ? !shellBridge.active : false}
          reflectionDev={data.reflectionDev}
          entities={data.graph.nodes}
          tasks={data.tasks}
          aliases={data.aliases}
          onNavigate={navigateCommand}
          onOpen={() => {
            cancelResponse();
            voice.cancelCapture();
          }}
        />
      )}
      <main className="main">
        <div className="page-content">
          <div className="page-heading">
            <div>
              <span className="eyebrow">ARY NEXUS / {tab.toUpperCase()}</span>
              <h1>{titles[tab][0]}</h1>
              <p>{titles[tab][1]}</p>
            </div>
            <button className="primary" onClick={() => setMemoryForm(true)}>
              + Add memory
            </button>
          </div>
          {tab === "Action history" && <ActivityInspector />}
          {(tab === "Approvals" || tab === "Action history") && (
            <ActionCenter
              key={tab}
              view={tab}
              onTaskCreated={refresh}
              commandTool={commandTool}
            />
          )}
          {tab === "Calls" && data && (
            <CallsPanel entities={data.graph.nodes} onTaskCreated={refresh} />
          )}
          {tab === "Creative" && <PremierePanel />}
          {tab === "Studio" && (
            <StudioPanel
              onMission={(id) => {
                setAgentMissionId(id);
                setTab("Execution Plans");
              }}
            />
          )}
          {tab === "Execution Plans" && (
            <OrchestratorPanel initialMissionId={agentMissionId} />
          )}
          {tab === "Perception" && <PerceptionPanel />}
          {tab === "Settings" && <PermissionsPanel />}
          {tab === "Computer & Browser" && <ControlPanel />}
          {tab === "Tools" && (
            <ToolsView
              onSelect={(tool) => navigateCommand({ tab: "Approvals", tool })}
            />
          )}
          {tab === "Skills" && (
            <SkillBuilder
              onMission={(id) => {
                setAgentMissionId(id);
                setTab("Execution Plans");
              }}
            />
          )}
          {tab === "Automations" && (
            <SkillBuilder
              automations
              onMission={(id) => {
                setAgentMissionId(id);
                setTab("Execution Plans");
              }}
            />
          )}
          {tab === "Calendar" && (
            <CalendarView
              entities={data?.graph.nodes ?? []}
              focusId={calendarFocusId}
              focusConnectionId={calendarFocusAccount}
            />
          )}
          {tab === "Communications" && (
            <>
              <div className="actions">
                <button onClick={() => setCommunicationMode("hub")}>
                  Communications hub
                </button>
                <button
                  onClick={() => {
                    setMailSource(undefined);
                    setCommunicationMode("gmail");
                  }}
                >
                  Gmail workspace
                </button>
              </div>
              {communicationMode === "gmail" ? (
                <GmailView source={mailSource} />
              ) : (
                <CommunicationsHub
                  onNavigate={setTab}
                  onSource={(source) => {
                    if (source.channel === "gmail") {
                      setMailSource(source);
                      setCommunicationMode("gmail");
                    } else if (source.channel === "calendar") {
                      setCalendarFocusAccount(null);
                      setCalendarFocusId(source.record_id);
                      setTab("Calendar");
                    } else if (source.channel === "phone") setTab("Calls");
                  }}
                />
              )}
            </>
          )}
          {tab === "Finance" && (
            <FinanceView
              focusKey={financeFocusKey}
              entities={data?.graph.nodes ?? []}
              goals={data?.goals ?? []}
              onEntity={(id) => {
                setGraphFocus(id);
                setTab("Graph");
              }}
            />
          )}
          {tab === "ROI" && <RoiDashboard />}
          {tab === "Agent Runtime" && (
            <AgentsView
              onMission={(id) => {
                setAgentMissionId(id);
                setTab("Execution Plans");
              }}
            />
          )}
          {tab === "Board" && (
            <BoardView
              onGraph={(id) => {
                setGraphFocus(id);
                setTab("Graph");
              }}
            />
          )}
          {tab === "Priority" && (
            <PriorityView
              onGraph={(id) => {
                setGraphFocus(id);
                setTab("Graph");
              }}
            />
          )}
          <div className="stats">
            <div>
              <span>Active memories</span>
              <strong>{data?.memories.length ?? "—"}</strong>
              <small>Knowledge retained</small>
            </div>
            <div>
              <span>Connected entities</span>
              <strong>{data?.graph.nodes.length ?? "—"}</strong>
              <small>People, projects & companies</small>
            </div>
            <div>
              <span>Relationships</span>
              <strong>{data?.graph.edges.length ?? "—"}</strong>
              <small>Context across your workspace</small>
            </div>
            <div>
              <span>Conversations</span>
              <strong>{data?.conversations.length ?? "—"}</strong>
              <small>History you can return to</small>
            </div>
          </div>
          {data && (
            <div className="mode-note">
              <span className="online-dot" />
              <span>
                {data.mode === "demo"
                  ? "Local demo · data saved to .data/demo.json."
                  : "Supabase · authenticated, persistent storage."}{" "}
                {data.provider === "Development stub"
                  ? "Deterministic brain stub."
                  : `Reasoning: ${data.provider}.`}{" "}
                {data.embeddingModel.startsWith("local-")
                  ? "Retrieval: development vectors + text + entity graph."
                  : "Retrieval: semantic vectors + full-text + entity graph."}
              </span>
            </div>
          )}
          {!data && (
            <button
              className="primary"
              onClick={() => refresh().catch((e) => setError(e.message))}
            >
              Retry connection
            </button>
          )}
          {data && tab === "Chat" && (
            <section className="chat-grid">
              <div className="panel chat-panel">
                <div className="panel-heading">
                  <div className="panel-title">
                    <span className="small-logo">a</span>
                    <div>
                      Ary<small>Memory-aware conversation</small>
                    </div>
                  </div>
                  <div className="conversation-tools">
                    <select
                      aria-label="Conversation"
                      disabled={busy}
                      value={conversationId ?? ""}
                      onChange={(e) => {
                        if (e.target.value)
                          void openConversation(e.target.value);
                        else {
                          voice.stopSpeaking();
                          voice.cancelCapture();
                          setVoicePreview(false);
                          setInput("");
                          setMessages([]);
                          setConversationId(undefined);
                          setSelected(null);
                        }
                      }}
                    >
                      <option value="">New conversation</option>
                      {data.conversations.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.title}
                        </option>
                      ))}
                    </select>
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() => {
                        voice.stopSpeaking();
                        voice.cancelCapture();
                        setVoicePreview(false);
                        setInput("");
                        setMessages([]);
                        setConversationId(undefined);
                        setSelected(null);
                      }}
                    >
                      + New
                    </button>
                  </div>
                </div>
                <AryPresence
                  stage
                  state={voiceState({
                    capture: voice.capture,
                    playback: voice.playback,
                    generating,
                    busy,
                    preview: voicePreview,
                    interrupted: voice.interrupted,
                    error: voice.error,
                  })}
                  level={voice.level}
                />
                <div className="messages" aria-live="polite">
                  {!messages.length && (
                    <div className="chat-welcome">
                      <span className="welcome-orbit">a</span>
                      <h2>A little context goes a long way.</h2>
                      <p>
                        Ask about your projects, connect an idea, or give Ary
                        something to remember.
                      </p>
                      <div className="suggestions">
                        {[
                          "What is Ary Nexus?",
                          "What do we know about Wag Trails?",
                          "Remember: Ary Nexus should keep memory sources visible.",
                        ].map((q) => (
                          <button key={q} onClick={() => setInput(q)}>
                            {q}
                            <span>↗</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {messages.map((m) => (
                    <article key={m.id} className={`message ${m.role}`}>
                      <div className="message-label">
                        {m.role === "assistant" ? "ARY" : "YOU"}
                        {m.role === "assistant" && (
                          <span>
                            {String(
                              m.metadata.provider_id ??
                                (m.metadata.provider === "Development stub"
                                  ? "development"
                                  : "provider unrecorded"),
                            )}{" "}
                            ·{" "}
                            {String(m.metadata.provider ?? "Model unrecorded")}
                          </span>
                        )}
                      </div>
                      <div className="message-content">{m.content}</div>
                      {Array.isArray(m.metadata.finance_accounts) &&
                        m.metadata.finance_accounts.map((raw, i) => {
                          const a = raw as { key: string; name: string };
                          return (
                            <button
                              key={i}
                              onClick={() => {
                                setFinanceFocusKey(a.key);
                                setTab("Finance");
                              }}
                            >
                              Finance evidence: {a.name}
                            </button>
                          );
                        })}
                      {Array.isArray(m.metadata.calendar_events) &&
                        m.metadata.calendar_events.map((raw, i) => {
                          const e = raw as {
                            id: string;
                            summary: string;
                            account?: string;
                            connection_id?: string;
                          };
                          return (
                            <button
                              key={i}
                              onClick={() => {
                                setCalendarFocusAccount(
                                  e.connection_id ?? null,
                                );
                                setCalendarFocusId(e.id);
                                setTab("Calendar");
                              }}
                            >
                              Focus: {e.summary}
                              {e.account ? ` · ${e.account}` : ""}
                            </button>
                          );
                        })}
                      {m.role === "assistant" && !!m.metadata.task_proposal && (
                        <TaskProposal
                          proposal={m.metadata.task_proposal}
                          tasks={data.tasks}
                          onCreated={refresh}
                        />
                      )}
                      {m.role === "assistant" &&
                        typeof m.metadata.mission_id === "string" && (
                          <button
                            onClick={() => {
                              setAgentMissionId(
                                m.metadata.mission_id as string,
                              );
                              setTab("Execution Plans");
                            }}
                          >
                            Open mission
                          </button>
                        )}
                      <EntityResolutionDebug
                        traces={m.metadata.entity_resolutions}
                      />
                      {m.role === "assistant" && (
                        <>
                          <RoutingDetail metadata={m.metadata} />
                          <ResponseMetrics metadata={m.metadata} />
                        </>
                      )}
                      {m.role === "assistant" && (
                        <button
                          className={`source-button ${selected === m.id ? "selected" : ""}`}
                          onClick={() => {
                            setSelected(m.id);
                            setContextOpen(true);
                          }}
                        >
                          ▤{" "}
                          {
                            ((m.metadata.retrieved_memories ?? []) as unknown[])
                              .length
                          }{" "}
                          retrieved memories <span>↗</span>
                        </button>
                      )}
                    </article>
                  ))}
                  {streamingText && (
                    <article
                      className="message assistant"
                      aria-label="Ary streaming response"
                    >
                      <p style={{ whiteSpace: "pre-wrap" }}>{streamingText}</p>
                    </article>
                  )}
                  {phase && (
                    <p className="phase" role="status">
                      {phase}
                    </p>
                  )}
                  <div ref={end} />
                </div>
                <form className="composer" onSubmit={send}>
                  <label className="sr-only" htmlFor="chat-input">
                    {voicePreview ? "Transcript preview" : "Message Ary"}
                  </label>
                  <textarea
                    id="chat-input"
                    placeholder="Ask Ary, or start with “Remember: …”"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (
                        e.key === "Enter" &&
                        !e.shiftKey &&
                        !e.nativeEvent.isComposing
                      ) {
                        e.preventDefault();
                        if (!busy && input.trim()) void send(e);
                      }
                    }}
                    rows={2}
                    maxLength={10000}
                    disabled={busy}
                  />
                  <div>
                    <small>Enter to send · Shift + Enter for a new line</small>
                    <button
                      className="primary"
                      disabled={
                        busy || !input.trim() || voice.capture !== "idle"
                      }
                    >
                      {busy ? "Working…" : "Send ↑"}
                    </button>
                  </div>
                  <VoiceControls
                    showPresence={false}
                    voice={voice}
                    busy={busy}
                    generating={generating}
                    onCancel={cancelResponse}
                    preview={voicePreview}
                    onDiscard={() => {
                      setVoicePreview(false);
                      setInput("");
                    }}
                    lastAnswer={
                      messages.findLast((m) => m.role === "assistant")
                        ?.content ?? ""
                    }
                  />
                </form>
              </div>
              <aside className="panel retrieval-panel">
                <div className="panel-heading">
                  <div>
                    <h2>Retrieved context</h2>
                    <p>The memories behind the response</p>
                  </div>
                  <span className="count-badge">{retrieved.length}</span>
                </div>
                <div className="retrieval-body">
                  {selectedMessage && (
                    <div className="retrieval-meta">
                      <span className="eyebrow">RETRIEVAL SNAPSHOT</span>
                      <p>
                        Intent:{" "}
                        <strong>
                          {String(selectedMessage.metadata.intent ?? "recall")}
                        </strong>
                        <br />
                        Extraction:{" "}
                        {String(
                          selectedMessage.metadata.extraction_status ??
                            "unknown",
                        )}
                      </p>
                    </div>
                  )}
                  {retrieved.length ? (
                    retrieved.map((m, i) => (
                      <div className="memory-card" key={m.id}>
                        <div>
                          <span className="tag">{m.memory_type}</span>
                          <span className="match">
                            #{m.final_rank ?? i + 1} · {m.score.toFixed(4)}{" "}
                            {m.retrieval_version ? "RRF" : "legacy score"}
                          </span>
                        </div>
                        <h3>
                          <span className="citation">[{i + 1}]</span>{" "}
                          {m.summary || m.content}
                        </h3>
                        {m.summary && <p>{m.content}</p>}
                        {m.retrieval_version ? (
                          <div className="small">
                            <p>Sources: {m.retrieval_sources?.join(" + ")}</p>
                            <p>
                              Semantic cosine:{" "}
                              {m.semantic_score?.toFixed(4) ??
                                "— (not a candidate)"}
                              {m.semantic_rank != null &&
                                ` · source rank ${m.semantic_rank}`}
                            </p>
                            <p>
                              Text score:{" "}
                              {m.text_score?.toFixed(4) ?? "— (no text match)"}
                              {m.text_rank != null &&
                                ` · source rank ${m.text_rank}`}
                            </p>
                            <p>
                              Graph:{" "}
                              {m.graph_rank != null
                                ? `${m.graph_hops} hops · source rank ${m.graph_rank}`
                                : "— (no entity path)"}
                            </p>
                          </div>
                        ) : (
                          <p className="small">
                            Per-source scores were not recorded for this older
                            response.
                          </p>
                        )}
                        <MemorySources sources={m.source_evidence} />
                        {m.explanation && (
                          <p className="small">
                            {m.explanation.class} · learned{" "}
                            {new Date(
                              m.explanation.learned_at,
                            ).toLocaleString()}{" "}
                            · {m.explanation.relevant_because.join(" · ")}
                          </p>
                        )}
                        {!!m.unresolved_conflict_count && (
                          <p className="notice">
                            Unresolved contradiction: review this fact before
                            treating it as settled truth.
                          </p>
                        )}
                        <details className="small">
                          <summary>Why this memory was included</summary>
                          <ul>
                            {m.retrieval_reasons?.map((reason, index) => (
                              <li key={index}>{reason}</li>
                            ))}
                          </ul>
                        </details>
                        {Boolean(m.graph_path?.length) && (
                          <p className="small">{m.graph_path!.join(" → ")}</p>
                        )}
                        <footer>
                          <span>Importance {percent(m.importance_score)}</span>
                          <span>Confidence {percent(m.confidence_score)}</span>
                        </footer>
                      </div>
                    ))
                  ) : (
                    <div className="empty">
                      <span>▤</span>
                      <h3>
                        {selectedMessage
                          ? "No relevant memories found"
                          : "Context will appear here"}
                      </h3>
                      <p>
                        {selectedMessage
                          ? "Ary did not retrieve an active memory for this message."
                          : "Send a message, then inspect the memories used in its response."}
                      </p>
                    </div>
                  )}
                </div>
                <div className="panel-footnote">
                  Snapshots preserve the context used at response time. Ranking
                  scores are not probabilities.
                </div>
              </aside>
            </section>
          )}
          {data?.reflectionDev && tab === "Reflection" && (
            <ReflectionPanel
              conversations={data.conversations}
              refresh={refresh}
            />
          )}
          {data && tab === "Memory review" && (
            <KnowledgeReview
              memories={data.memoryRecords}
              conflicts={data.conflicts}
              jobs={data.jobs}
              refresh={refresh}
            />
          )}
          {data && tab === "Memories" && (
            <section className="panel">
              <div className="panel-heading">
                <h2>Memory library</h2>
                <form className="search-form" onSubmit={findMemories}>
                  <input
                    aria-label="Search memories"
                    placeholder="Search meaning or keywords…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  <button disabled={searching}>
                    {searching ? "Searching…" : "Search"}
                  </button>
                  {searchResults && (
                    <button
                      type="button"
                      onClick={() => {
                        setSearchResults(null);
                        setSearch("");
                      }}
                    >
                      Clear
                    </button>
                  )}
                </form>
              </div>
              <MemorySystemView
                entities={data.graph.nodes}
                outcomes={data.outcomes}
                conversations={data.conversations}
                onChanged={refresh}
              />
              <div className="memory-grid">
                {(searchResults ?? data.memories).map((m) => (
                  <article className="memory-card" key={m.id}>
                    <div>
                      <span className="tag">{m.memory_type}</span>
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() =>
                          void mutate(`memories/${m.id}`, undefined, "DELETE")
                        }
                      >
                        Archive
                      </button>
                    </div>
                    <h3>{m.summary || m.content}</h3>
                    {m.summary && <p>{m.content}</p>}
                    <footer>
                      <span>Importance {percent(m.importance_score)}</span>
                      <span>Confidence {percent(m.confidence_score)}</span>
                    </footer>
                    <p className="small">
                      Source:{" "}
                      {m.source_message_id
                        ? "conversation"
                        : String(m.metadata.source ?? "manual entry")}
                      <br />
                      Last retrieved:{" "}
                      {m.last_accessed_at
                        ? new Date(m.last_accessed_at).toLocaleString()
                        : "Never"}
                    </p>
                  </article>
                ))}
                {!(searchResults ?? data.memories).length && (
                  <p className="empty">
                    No memories found. Add one to get started.
                  </p>
                )}
              </div>
            </section>
          )}
          {data && tab === "Entities" && (
            <section className="panel">
              <div className="panel-heading">
                <h2>Entity directory</h2>
                <span className="tag">{data.graph.nodes.length} entities</span>
              </div>
              <div className="entity-grid">
                {data.graph.nodes.map((e) => (
                  <article
                    className="entity-card"
                    key={e.id}
                    id={`entity-${e.id}`}
                    tabIndex={-1}
                  >
                    <span
                      className={`entity-icon ${e.entity_type === "company" ? "gold" : ""}`}
                    >
                      {e.name
                        .split(" ")
                        .map((w) => w[0])
                        .join("")
                        .slice(0, 2)}
                    </span>
                    <span className="tag">{e.entity_type}</span>
                    <h2>{e.name}</h2>
                    <p>{e.description || "No description yet."}</p>
                    {e.entity_type === "project" && (
                      <ProjectState
                        project={e}
                        entities={data.graph.nodes}
                        edges={data.graph.edges}
                        goals={data.goals}
                        tasks={data.tasks}
                        onUpdated={refresh}
                        onGraph={(id) => {
                          setGraphFocus(id);
                          setTab("Graph");
                        }}
                      />
                    )}
                    <p className="small">
                      Aliases:{" "}
                      {data.aliases
                        .filter((a) => a.entity_id === e.id)
                        .map((a) => a.alias)
                        .join(", ") || "None"}
                    </p>
                    <form
                      onSubmit={async (event) => {
                        event.preventDefault();
                        const form = event.currentTarget;
                        const values = new FormData(form);
                        if (
                          await mutate(`entities/${e.id}/aliases`, {
                            alias: values.get("alias"),
                          })
                        )
                          form.reset();
                      }}
                    >
                      <input
                        name="alias"
                        aria-label={`Alias for ${e.name}`}
                        placeholder="Add an alias"
                        required
                        maxLength={200}
                      />
                      <button disabled={busy}>Add alias</button>
                    </form>
                    <small>
                      {
                        data.graph.edges.filter(
                          (r) =>
                            r.source_entity_id === e.id ||
                            r.target_entity_id === e.id,
                        ).length
                      }{" "}
                      relationships
                    </small>
                  </article>
                ))}
              </div>
              <form
                className="inline-form"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const form = e.currentTarget;
                  const f = new FormData(form);
                  if (
                    await mutate("entities", {
                      name: f.get("name"),
                      entity_type: f.get("entity_type"),
                      description: f.get("description"),
                    })
                  )
                    form.reset();
                }}
              >
                <h3>Add an entity</h3>
                <input
                  name="name"
                  aria-label="Entity name"
                  placeholder="Name"
                  required
                  maxLength={200}
                />
                <select name="entity_type" aria-label="Entity type">
                  {entityTypes.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
                <input
                  name="description"
                  aria-label="Entity description"
                  placeholder="Description"
                  maxLength={4000}
                />
                <button disabled={busy}>Add entity</button>
              </form>
            </section>
          )}
          {data && tab === "Relationships" && (
            <section className="panel">
              <div className="panel-heading">
                <h2>Relationship register</h2>
                <span className="tag">Directed connections</span>
              </div>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Source entity</th>
                      <th>Relationship</th>
                      <th>Target entity</th>
                      <th>Strength</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.graph.edges.map((r) => (
                      <tr key={r.id}>
                        <td>
                          {
                            data.graph.nodes.find(
                              (e) => e.id === r.source_entity_id,
                            )?.name
                          }
                        </td>
                        <td>
                          <span className="tag">{r.relationship_type} →</span>
                        </td>
                        <td>
                          {
                            data.graph.nodes.find(
                              (e) => e.id === r.target_entity_id,
                            )?.name
                          }
                        </td>
                        <td>
                          {percent(r.strength)}{" "}
                          <button
                            disabled={busy}
                            onClick={() =>
                              void mutate(
                                `relationships/${r.id}`,
                                undefined,
                                "DELETE",
                              )
                            }
                          >
                            End relationship
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <form
                className="inline-form"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  await mutate("relationships", {
                    source_entity_id: f.get("source"),
                    target_entity_id: f.get("target"),
                    relationship_type: f.get("type"),
                    strength: Number(f.get("strength")),
                  });
                }}
              >
                <h3>Connect entities</h3>
                <select name="source" aria-label="Source entity" required>
                  <option value="">Source</option>
                  {data.graph.nodes.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </select>
                <input
                  name="type"
                  placeholder="Relationship type"
                  aria-label="Relationship type"
                  required
                  maxLength={100}
                />
                <select name="target" aria-label="Target entity" required>
                  <option value="">Target</option>
                  {data.graph.nodes.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </select>
                <input
                  name="strength"
                  type="number"
                  aria-label="Strength (0–1)"
                  min="0"
                  max="1"
                  step="0.05"
                  defaultValue="1"
                  required
                />
                <button disabled={busy}>Connect</button>
              </form>
            </section>
          )}
          {data && ["Graph", "Memory map", "World map"].includes(tab) && (
            <NexusMapExperience
              key={tab}
              lens={
                tab === "Memory map"
                  ? "memory"
                  : tab === "World map"
                    ? "world"
                    : "nexus"
              }
              development={data.reflectionDev}
              initialEntityId={graphFocus}
              onNavigate={(node) => {
                if (node.kind === "mission" && node.recordId)
                  setAgentMissionId(node.recordId);
                navigateCommand({
                  tab: node.destination,
                  tool: node.tool,
                  recordId:
                    node.destination === "Entities" && node.recordId
                      ? `entity-${node.recordId}`
                      : undefined,
                  query: node.kind === "memory" ? node.label : undefined,
                });
              }}
            />
          )}
          {data && tab === "Activity" && (
            <>
              <section className="activity-grid">
                {[
                  ["Goals", data.goals],
                  ["Decisions", data.decisions],
                  ["Tasks", data.tasks],
                ].map(([label, items]) => (
                  <div className="panel activity-card" key={label as string}>
                    <h2>{label as string}</h2>
                    {(items as (Goal | Decision | Task)[]).map((item) =>
                      "priority" in item ? (
                        <TaskUpdateCard
                          key={item.id}
                          task={item}
                          entities={data.graph.nodes}
                          onUpdated={refresh}
                        />
                      ) : (
                        <div key={item.id}>
                          <span className="tag">{item.status}</span>
                          <h3>{item.title}</h3>
                          <p>
                            {"rationale" in item
                              ? item.rationale
                              : item.description}
                          </p>
                        </div>
                      ),
                    )}
                  </div>
                ))}
              </section>
              <section className="panel">
                <div className="panel-heading">
                  <h2>Action log</h2>
                  <small>
                    Most recent 30 actions · server-owned permissions
                  </small>
                </div>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Action</th>
                        <th>Permission</th>
                        <th>Status</th>
                        <th>Outcome</th>
                        <th>Time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.actions.map((a) => (
                        <tr key={a.id}>
                          <td>{a.tool_name}</td>
                          <td>{a.permission_level}</td>
                          <td>
                            <span className="tag">{a.status}</span>
                          </td>
                          <td>
                            {data.outcomes.find((o) => o.action_id === a.id)
                              ?.summary ?? "No outcome recorded"}
                          </td>
                          <td>{new Date(a.created_at).toLocaleTimeString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!data.actions.length && (
                    <p className="empty">Actions will appear as you use Ary.</p>
                  )}
                </div>
              </section>
            </>
          )}
          {data && !data.graph.nodes.length && (
            <div className="seed-prompt">
              <p>Start with the project brief’s entities and memories.</p>
              <button disabled={busy} onClick={() => void mutate("seed", {})}>
                Load Clevaryn, Wag Trails & Ary Nexus
              </button>
            </div>
          )}
          <footer className="workspace-footer">
            <span>ARY NEXUS</span>
            <span>
              Structured memory. Connected context. Persistent intelligence.
            </span>
          </footer>
        </div>
      </main>
      {memoryForm && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="memory-title"
            onKeyDown={(e) => {
              if (e.key === "Escape" && !busy) setMemoryForm(false);
              if (e.key === "Tab") {
                const elements = Array.from(
                  e.currentTarget.querySelectorAll<HTMLElement>(
                    "button:not(:disabled),input,textarea,select",
                  ),
                );
                const first = elements[0],
                  last = elements.at(-1);
                if (e.shiftKey && document.activeElement === first) {
                  e.preventDefault();
                  last?.focus();
                } else if (!e.shiftKey && document.activeElement === last) {
                  e.preventDefault();
                  first?.focus();
                }
              }
            }}
          >
            <div className="panel-heading">
              <h2 id="memory-title">Give Ary something to remember.</h2>
              <button
                aria-label="Close memory form"
                disabled={busy}
                onClick={() => setMemoryForm(false)}
              >
                ×
              </button>
            </div>
            <form onSubmit={addMemory}>
              <label>
                Memory type
                <select name="memory_type">
                  {memoryTypes.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </label>
              <label>
                Content
                <textarea
                  name="content"
                  placeholder="A durable fact, preference, or piece of context…"
                  rows={5}
                  maxLength={20000}
                  required
                  autoFocus
                />
              </label>
              <label>
                Short summary <span>(optional)</span>
                <input name="summary" maxLength={1000} />
              </label>
              <div className="form-row">
                <label>
                  Importance (0–1)
                  <input
                    name="importance_score"
                    type="number"
                    min="0"
                    max="1"
                    step="0.05"
                    defaultValue="0.7"
                    required
                  />
                </label>
                <label>
                  Confidence (0–1)
                  <input
                    name="confidence_score"
                    type="number"
                    min="0"
                    max="1"
                    step="0.05"
                    defaultValue="0.9"
                    required
                  />
                </label>
              </div>
              <p className="small">
                The memory will be embedded and available to the next retrieval.
              </p>
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
              <button className="primary" disabled={busy}>
                {busy ? "Saving…" : "Save memory"}
              </button>
            </form>
          </section>
        </div>
      )}
    </NexusShell>
  );
}
