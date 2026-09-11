"use client";
import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type {
  Conversation,
  EntityAlias,
  Graph,
  Json,
  Message,
  Task,
  Action,
} from "../../domain/models";
import type { ExecutionPlan } from "../../domain/orchestration";
import {
  mobileDestination,
  mobileSupportsDestination,
  mobileMissionCommands,
  type MobileTab,
} from "../../domain/mobile";
import type { useAryVoice } from "../voice/use-ary-voice";
import { VoicePresence } from "../voice/voice-presence";
import { voiceState } from "../voice/voice-state";
import { VoiceControls } from "../voice/voice-controls";
import { ApprovalDialog } from "../approval-dialog";
import { EmergencyControl } from "../emergency-control";
import { CommandPalette } from "../commands/command-palette";
import { NexusRealtime } from "../events/nexus-realtime";
import { useNexusEvents } from "../events/event-store";
import { NexusModeContext } from "../nexus/mode";
import { api } from "../api";
import styles from "./mobile.module.css";
const Capture = dynamic(() =>
  import("./mobile-capture").then((m) => m.MobileCapture),
);
const Map = dynamic(() => import("./mobile-nexus").then((m) => m.MobileNexus));
type Data = {
  mode: string;
  conversations: Conversation[];
  graph: Graph;
  tasks: Task[];
  aliases: EntityAlias[];
};
type Props = {
  data: Data | null;
  voice: ReturnType<typeof useAryVoice>;
  busy: boolean;
  generating: boolean;
  input: string;
  onInput(text: string): void;
  messages: Message[];
  streamingText: string;
  conversationId?: string;
  onConversation(id: string): Promise<void>;
  onSend(): void;
  onStop(): void;
  error: string;
  notice: string;
  onRefresh(): Promise<unknown>;
  onSignOut(): Promise<void>;
};
export default function MobileCompanion(p: Props) {
  const [tab, setTab] = useState<MobileTab>("Ary"),
    [online, setOnline] = useState(true),
    [pending, setPending] = useState<Action[]>([]),
    [queueError, setQueueError] = useState(""),
    [revision, setRevision] = useState(0);
  const [entityFocus, setEntityFocus] = useState<string | undefined>();
  const [mapMode, setMapMode] = useState("map");
  const events = useNexusEvents();
  const stop = useRef(p.onStop);
  stop.current = p.onStop;
  const [plans, setPlans] = useState<ExecutionPlan[]>([]),
    [localError, setLocalError] = useState(""),
    [working, setWorking] = useState(false);
  const lock = useRef(false);
  useEffect(() => {
    const network = () => setOnline(navigator.onLine);
    const hide = () => {
      if (document.hidden) stop.current();
    };
    network();
    window.addEventListener("online", network);
    window.addEventListener("offline", network);
    document.addEventListener("visibilitychange", hide);
    if (window.isSecureContext && "serviceWorker" in navigator)
      void navigator.serviceWorker
        .register("/mobile/sw.js", { scope: "/mobile" })
        .catch(() => {});
    return () => {
      window.removeEventListener("online", network);
      window.removeEventListener("offline", network);
      document.removeEventListener("visibilitychange", hide);
    };
  }, []);
  useEffect(() => {
    const abort = new AbortController();
    let loading = false;
    const refresh = async () => {
      if (document.hidden || loading) return;
      loading = true;
      try {
        const rows = await (
          await api("actions/history?offset=0&pending=true", {
            signal: abort.signal,
          })
        ).json();
        if (!abort.signal.aborted) {
          setPending(rows.items);
          setQueueError("");
        }
      } catch (e) {
        if (!abort.signal.aborted) {
          setPending([]);
          setQueueError((e as Error).message);
        }
      } finally {
        loading = false;
      }
    };
    void refresh();
    const timer = setInterval(refresh, 15000);
    window.addEventListener("ary:action-settled", refresh);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      abort.abort();
      clearInterval(timer);
      window.removeEventListener("ary:action-settled", refresh);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [revision]);
  useEffect(() => {
    if (tab !== "Missions") return;
    const abort = new AbortController();
    setLocalError("");
    void api("orchestrator/plans", { signal: abort.signal })
      .then((r) => r.json())
      .then((rows) => {
        if (!abort.signal.aborted) setPlans(rows);
      })
      .catch((e) => {
        if (!abort.signal.aborted) {
          setPlans([]);
          setLocalError(e.message);
        }
      });
    return () => abort.abort();
  }, [tab, revision]);
  async function work(fn: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setWorking(true);
    setLocalError("");
    try {
      await fn();
    } catch (e) {
      setLocalError((e as Error).message);
    } finally {
      lock.current = false;
      setWorking(false);
      setRevision((v) => v + 1);
    }
  }
  async function review(action: Action) {
    await work(async () => {
      const approved = await new Promise<boolean>((respond) =>
        window.dispatchEvent(
          new CustomEvent("ary:approval", {
            detail: { actionId: action.id, tool: action.tool_name, respond },
          }),
        ),
      );
      if (approved && action.metadata.request_envelope)
        await api("actions/request", {
          method: "POST",
          body: JSON.stringify(action.metadata.request_envelope),
        });
    });
  }
  const latest =
    p.streamingText ||
    p.messages.findLast((m) => m.role === "assistant")?.content;
  const state = voiceState({
    capture: p.voice.capture,
    playback: p.voice.playback,
    generating: p.generating,
    busy: p.busy,
    preview: false,
    interrupted: p.voice.interrupted,
    error: p.voice.error,
  });
  return (
    <NexusModeContext.Provider value="ambient">
      <div className={styles.companion} aria-label="ARY mobile companion">
        <NexusRealtime />
        <ApprovalDialog />
        <CommandPalette
          showLauncher={false}
          entities={p.data?.graph.nodes ?? []}
          tasks={p.data?.tasks ?? []}
          aliases={p.data?.aliases ?? []}
          reflectionDev={false}
          supportsDestination={mobileSupportsDestination}
          onNavigate={(d) => {
            setEntityFocus(d.recordId?.replace(/^entity-/, ""));
            setMapMode(
              d.tab === "Memories"
                ? "memory"
                : d.tab === "Studio"
                  ? "devices"
                  : "map",
            );
            setTab(mobileDestination(d.tab));
          }}
          onOpen={p.onStop}
        />
        <header className={styles.header}>
          <a href="/mobile" aria-label="ARY companion home">
            ARY<span>COMPANION</span>
          </a>
          <button
            aria-label="Open mobile command interface"
            onClick={() => window.dispatchEvent(new Event("ary:open-command"))}
          >
            ⌕
          </button>
          <button
            aria-label="Review mobile approvals"
            onClick={() => setTab("Updates")}
          >
            {pending.length ? `${pending.length} to review` : "Updates"}
          </button>
        </header>
        {!online && (
          <p role="alert" className={styles.banner}>
            Offline. Reconnect before sending or approving. Nothing is queued
            automatically.
          </p>
        )}
        <main className={styles.content}>
          {(p.error || p.notice || localError) && (
            <p role="status">{localError || p.error || p.notice}</p>
          )}
          {!p.data && (
            <button
              onClick={() =>
                void p.onRefresh().catch((e) => setLocalError(e.message))
              }
            >
              Reconnect to Ary
            </button>
          )}
          {tab === "Ary" && (
            <section aria-label="Mobile Ary conversation">
              <p className={styles.eyebrow}>YOUR INTELLIGENCE, WITH YOU</p>
              <h1>One thought away.</h1>
              <div className={styles.presence}>
                <VoicePresence
                  state={state}
                  level={p.voice.level}
                  continuous={p.voice.sessionActive}
                />
              </div>
              <button
                className={styles.talk}
                disabled={!online || !p.data || !p.voice.supported}
                onClick={() =>
                  p.voice.sessionActive
                    ? p.onStop()
                    : void p.voice.startConversation()
                }
              >
                {p.voice.sessionActive ? "End conversation" : "Talk to Ary"}
              </button>
              <p className={styles.fine}>
                {p.voice.sessionActive
                  ? "Microphone active · pause to send · speak over Ary to interrupt"
                  : "Tap to connect. The microphone stays off until you choose."}
              </p>
              {(p.voice.sessionActive ||
                p.generating ||
                p.voice.playback !== "idle") && (
                <button onClick={p.onStop}>Stop voice and response</button>
              )}
              {(p.voice.partialTranscript || p.input) && (
                <p className={styles.transcript}>
                  YOU · {p.voice.partialTranscript || p.input}
                </p>
              )}
              {latest && (
                <article className={styles.answer}>
                  <small>ARY</small>
                  <p>{latest}</p>
                </article>
              )}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  p.onSend();
                }}
              >
                <label>
                  Message Ary
                  <textarea
                    id="chat-input"
                    value={p.input}
                    onChange={(e) => p.onInput(e.target.value)}
                    placeholder="Ask, capture, or start a mission…"
                    rows={2}
                    maxLength={10000}
                    disabled={p.busy}
                  />
                </label>
                <button
                  className={styles.primary}
                  disabled={
                    !online ||
                    p.busy ||
                    !p.input.trim() ||
                    p.voice.capture !== "idle"
                  }
                >
                  Send to Ary
                </button>
              </form>
              <details>
                <summary>Voice controls & transcript</summary>
                <VoiceControls
                  voice={p.voice}
                  busy={p.busy}
                  generating={p.generating}
                  onCancel={p.onStop}
                  preview={false}
                  onDiscard={() => p.onInput("")}
                  lastAnswer={latest ?? ""}
                  showPresence={false}
                />
                <label>
                  Conversation
                  <select
                    value={p.conversationId ?? ""}
                    onChange={(e) => void p.onConversation(e.target.value)}
                    disabled={p.busy}
                  >
                    <option value="" disabled>
                      Current conversation
                    </option>
                    {p.data?.conversations.map((c) => (
                      <option value={c.id} key={c.id}>
                        {c.title}
                      </option>
                    ))}
                  </select>
                </label>
                {p.messages.slice(-12).map((m) => (
                  <article className={styles.row} key={m.id}>
                    <small>{m.role.toUpperCase()}</small>
                    <p>{m.content}</p>
                  </article>
                ))}
              </details>
            </section>
          )}
          {tab === "Missions" && (
            <section aria-label="Mobile missions">
              <p className={styles.eyebrow}>WORK THAT CONTINUES</p>
              <h1>Keep it moving.</h1>
              <button
                onClick={() => {
                  p.onInput("Create a mission to ");
                  setTab("Ary");
                }}
              >
                Ask Ary to create a mission
              </button>
              <button onClick={() => setRevision((v) => v + 1)}>
                Refresh missions
              </button>
              {plans.slice(0, 20).map((plan) => (
                <article className={styles.row} key={plan.id}>
                  <small>{plan.mission?.state ?? plan.status}</small>
                  <h2>{plan.goal}</h2>
                  <p>
                    {plan.summary ||
                      plan.mission?.reason ||
                      "Inspect the planned steps before continuing."}
                  </p>
                  <details>
                    <summary>Steps & recent progress</summary>
                    {plan.spec.steps.map((s) => (
                      <p key={s.id}>
                        {s.title} · {plan.states[s.id]?.status ?? "planned"}
                      </p>
                    ))}
                    {plan.events.slice(-3).map((e, i) => (
                      <p key={i}>{e.text}</p>
                    ))}
                  </details>
                  {plan.mission &&
                    !["COMPLETED", "CANCELLED"].includes(
                      plan.mission.state,
                    ) && (
                      <div className={styles.segment}>
                        {mobileMissionCommands(plan.mission.state).map(
                          (command) => (
                            <button
                              disabled={working || !online}
                              key={command}
                              onClick={() =>
                                void work(async () => {
                                  await api("actions/request", {
                                    method: "POST",
                                    body: JSON.stringify({
                                      tool:
                                        command === "tick"
                                          ? "mission.tick"
                                          : "mission.control",
                                      input:
                                        command === "tick"
                                          ? { mission_id: plan.id }
                                          : {
                                              mission_id: plan.id,
                                              revision: plan.revision,
                                              command,
                                            },
                                      request_key: `mobile:${plan.id}:${plan.revision}:${command}`,
                                      reason:
                                        "Owner requested mission control from ARY Companion",
                                    }),
                                  });
                                })
                              }
                            >
                              {command === "tick"
                                ? "Process checkpoint"
                                : command}
                            </button>
                          ),
                        )}
                      </div>
                    )}
                </article>
              ))}
              {!plans.length && <p>No recorded missions in this view yet.</p>}
            </section>
          )}
          {tab === "Capture" && <Capture />}
          {tab === "Nexus" && (
            <Map initialEntityId={entityFocus} initialMode={mapMode} />
          )}
          {tab === "Updates" && (
            <section aria-label="Mobile updates">
              <p className={styles.eyebrow}>ONLY WHAT NEEDS YOU</p>
              <h1>Stay in the loop.</h1>
              <h2>Approvals</h2>
              {queueError && (
                <p role="alert">Approval queue unavailable: {queueError}</p>
              )}
              {pending.map((a) => (
                <article className={styles.row} key={a.id}>
                  <strong>{a.tool_name}</strong>
                  <p>
                    {String(a.metadata.reason ?? "Review the exact request")}
                  </p>
                  <button
                    disabled={working || !online}
                    onClick={() => void review(a)}
                  >
                    Inspect approval
                  </button>
                </article>
              ))}
              {!pending.length && !queueError && (
                <p>Nothing awaiting your review.</p>
              )}
              <h2>Important activity</h2>
              <p className={styles.fine}>
                {events.connection} · Live in-app updates while open. Background
                push is not connected.
              </p>
              {events.events
                .filter(
                  (e) =>
                    e.source.kind !== "client" &&
                    e.severity !== "debug" &&
                    !e.type.endsWith("requested"),
                )
                .slice(-15)
                .reverse()
                .map((e) => (
                  <article className={styles.row} key={e.id}>
                    <strong>{e.type.replaceAll(".", " · ")}</strong>
                    <p>
                      {String(
                        e.payload.label ??
                          e.payload.state ??
                          e.payload.status ??
                          "Recorded activity",
                      )}
                    </p>
                    <small>{new Date(e.timestamp).toLocaleString()}</small>
                  </article>
                ))}
              <details>
                <summary>Install & privacy</summary>
                <p>
                  Open this page over HTTPS, then use your browser’s Add to Home
                  Screen or Install command. On iPhone, use Safari’s Share menu.
                </p>
                <p>
                  Voice stops when this screen is hidden. Camera and approximate
                  location require an explicit request. No background location
                  or cached private pages.
                </p>
                <a href="/?systems=1">Open desktop Systems</a>
                {p.data?.mode === "supabase" && (
                  <button onClick={() => void p.onSignOut()}>Sign out</button>
                )}
              </details>
            </section>
          )}
        </main>
        <footer className={styles.dock}>
          <nav aria-label="Mobile destinations">
            {(["Ary", "Missions", "Capture", "Nexus", "Updates"] as const).map(
              (name, i) => (
                <button
                  key={name}
                  aria-current={tab === name ? "page" : undefined}
                  onClick={() => {
                    setTab(name);
                    setLocalError("");
                  }}
                >
                  <span aria-hidden>{["◉", "↗", "+", "◇", "≋"][i]}</span>
                  {name}
                </button>
              ),
            )}
          </nav>
          <EmergencyControl />
        </footer>
      </div>
    </NexusModeContext.Provider>
  );
}
