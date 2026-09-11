"use client";
import { EmergencyControl } from "../emergency-control";
import { useEffect, useState, type ReactNode, type RefObject } from "react";
import { publishClientEvent } from "../events/event-store";
import { NexusModeContext } from "./mode";
import { NexusRealtime } from "../events/nexus-realtime";
import { api } from "../api";
import type { VoiceState } from "../voice/voice-state";
import { destinations, destinationForTab, sectionLabel } from "./destinations";
import { AryPresence, NexusDrawer, NexusState } from "./primitives";
import styles from "./nexus.module.css";

export function NexusShell({
  children,
  tab,
  onNavigate,
  voiceState,
  level,
  environment,
  provider,
  reflectionDev,
  contextOpen,
  onContext,
  notice,
  error,
  onDismissNotice,
  onDismissError,
  onRetry,
  onSignOut,
  onOrbit,
  onStop,
  audioActive,
  ambient,
  voiceSessionActive = false,
}: {
  children: ReactNode;
  ambient?: (openConversation: () => void) => ReactNode;
  voiceSessionActive?: boolean;
  tab: string;
  onNavigate: (tab: string) => void;
  voiceState: VoiceState;
  level: RefObject<number>;
  environment: string;
  provider: string;
  reflectionDev: boolean;
  contextOpen: boolean;
  onContext: () => void;
  notice: string;
  error: string;
  onDismissNotice: () => void;
  onDismissError: () => void;
  onRetry: () => void;
  onSignOut?: () => void;
  onOrbit?: () => void;
  onStop: () => void;
  audioActive: boolean;
}) {
  useEffect(() => {
    publishClientEvent({
      type: "browser.destination_changed",
      severity: "debug",
      payload: { capability: tab },
    });
  }, [tab]);
  useEffect(() => {
    const previous = document.title;
    document.title = voiceSessionActive
      ? "Ary Nexus — Microphone active"
      : "Ary Nexus";
    return () => {
      document.title = previous;
    };
  }, [voiceSessionActive]);
  const [mode, setMode] = useState<"ambient" | "systems">("systems");
  const [drawer, setDrawer] = useState<
    "navigation" | "attention" | "system" | null
  >(null);
  const [pending, setPending] = useState<number | null>(null);
  const [pendingError, setPendingError] = useState(false);
  const current = destinationForTab(tab);
  useEffect(() => {
    // Read-only projection of the existing approval queue. Never a second notification/action store.
    const controller = new AbortController();
    let running = false;
    const refresh = async () => {
      if (running || document.hidden) return;
      running = true;
      try {
        const data = await (
          await api("actions/history?offset=0&pending=true", {
            signal: controller.signal,
          })
        ).json();
        if (!controller.signal.aborted) {
          setPending(data.total);
          setPendingError(false);
        }
      } catch {
        if (!controller.signal.aborted) setPendingError(true);
      } finally {
        running = false;
      }
    };
    void refresh();
    const timer = setInterval(refresh, 30000);
    window.addEventListener("focus", refresh);
    window.addEventListener("ary:approval", refresh);
    window.addEventListener("ary:action-settled", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      controller.abort();
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("ary:approval", refresh);
      window.removeEventListener("ary:action-settled", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [tab, drawer]);
  function navigate(next: string) {
    setDrawer(null);
    onNavigate(next);
  }
  const navigation = (compact = false) => (
    <nav
      className={compact ? styles.directory : styles.destinations}
      aria-label={compact ? "All destinations" : "Primary destinations"}
      onKeyDown={(event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
          return;
        const buttons = Array.from(
          event.currentTarget.querySelectorAll("button"),
        );
        const currentIndex = buttons.indexOf(
          document.activeElement as HTMLButtonElement,
        );
        if (currentIndex < 0) return;
        event.preventDefault();
        const next =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? buttons.length - 1
              : (currentIndex +
                  (event.key === "ArrowRight" ? 1 : -1) +
                  buttons.length) %
                buttons.length;
        buttons[next]?.focus();
      }}
    >
      {destinations.map((d) => (
        <button
          key={d.id}
          aria-current={current.id === d.id ? "page" : undefined}
          onClick={() => navigate(d.tab)}
        >
          <span>{d.id}</span>
          {compact && <small>{d.detail}</small>}
        </button>
      ))}
    </nav>
  );
  return (
    <NexusModeContext.Provider value={mode}>
      <NexusRealtime />
      <div
        className={styles.shell}
        data-nexus-shell
        data-mode={mode}
        data-context={contextOpen}
        data-voice-ambient={mode === "ambient" && tab === "Chat"}
      >
        <a className={styles.skip} href="#nexus-workspace">
          Skip to workspace
        </a>
        <header className={styles.orientation}>
          <button
            className={styles.identity}
            onClick={() => navigate("Graph")}
            aria-label="Nexus home"
          >
            ARY <span>NEXUS</span>
          </button>
          <button
            className={styles.command}
            onClick={() => window.dispatchEvent(new Event("ary:open-command"))}
            aria-label="Open Ary command palette"
          >
            Find anything. Ask Ary.<kbd>⌘K</kbd>
          </button>
          <div className={styles.mode} aria-label="Workspace mode">
            <button
              aria-pressed={mode === "ambient"}
              onClick={() => {
                setMode("ambient");
                onNavigate("Chat");
              }}
            >
              Ambient
            </button>
            <button
              aria-pressed={mode === "systems"}
              onClick={() => setMode("systems")}
            >
              Systems
            </button>
          </div>
          <button
            className={styles.attention}
            onClick={() => setDrawer("attention")}
            aria-label="Open attention"
            data-pending={!!pending || !!error}
          >
            Attention <span>{pendingError ? "?" : (pending ?? "—")}</span>
          </button>
          <button
            className={styles.systemAccess}
            onClick={() => setDrawer("system")}
          >
            System
          </button>
        </header>
        {voiceSessionActive && (
          <div role="status" className={styles.sessionBanner}>
            <span>Microphone active · Ary conversation</span>
            <button onClick={onStop}>End voice session</button>
          </div>
        )}
        {mode === "ambient" &&
          tab === "Chat" &&
          ambient?.(() => setMode("systems"))}
        <div className={styles.navigation}>
          {navigation()}
          <button
            className={styles.compactNav}
            onClick={() => setDrawer("navigation")}
          >
            Explore Nexus <span>{current.id}</span>
          </button>
        </div>
        <div className={styles.scope}>
          <div>
            <span>{current.id}</span>
            <span className={styles.scopeDivider}>/</span>
            <strong>{sectionLabel(tab)}</strong>
          </div>
          <div
            className={styles.sections}
            aria-label={`${current.id} sections`}
          >
            {current.sections.filter((t) => t !== "Reflection" || reflectionDev)
              .length > 1 &&
              current.sections
                .filter((t) => t !== "Reflection" || reflectionDev)
                .map((t) => (
                  <button
                    key={t}
                    aria-current={tab === t ? "page" : undefined}
                    onClick={() => navigate(t)}
                  >
                    {sectionLabel(t)}
                  </button>
                ))}
            {tab === "Chat" && (
              <button aria-pressed={contextOpen} onClick={onContext}>
                {contextOpen ? "Hide context" : "Show context"}
              </button>
            )}
          </div>
        </div>
        {(error || notice) && (
          <div
            className={styles.notification}
            role={error ? "alert" : "status"}
            data-error={!!error}
          >
            <span>{error || notice}</span>
            {error && <button onClick={onRetry}>Retry connection</button>}
            <button onClick={error ? onDismissError : onDismissNotice}>
              Dismiss
            </button>
          </div>
        )}
        <div id="nexus-workspace" tabIndex={-1} className={styles.workspace}>
          {children}
        </div>
        <footer className={styles.statusbar}>
          <EmergencyControl />
          <AryPresence
            state={voiceState}
            level={level}
            approvalCount={pending ?? 0}
          />
          <span className={styles.environment}>
            {environment} · {provider}
          </span>
          <div>
            {audioActive && <button onClick={onStop}>Interrupt Ary</button>}
            <button onClick={() => navigate("Chat")}>Talk to Ary</button>
            <button onClick={() => navigate("Approvals")}>
              Approvals{pending != null && pending > 0 ? ` · ${pending}` : ""}
            </button>
            <button onClick={() => navigate("Action history")}>Activity</button>
          </div>
        </footer>
        <NexusDrawer
          title={
            drawer === "navigation"
              ? "Explore Nexus"
              : drawer === "system"
                ? "Workspace controls"
                : "Attention"
          }
          open={drawer !== null}
          onClose={() => setDrawer(null)}
        >
          {drawer === "navigation" && navigation(true)}
          {drawer === "attention" && (
            <>
              {error && (
                <NexusState error title="Workspace needs attention">
                  {error}
                </NexusState>
              )}
              {notice && (
                <NexusState title="Latest update">{notice}</NexusState>
              )}
              <NexusState
                title={
                  pendingError
                    ? "Approval count unavailable"
                    : pending === null
                      ? "Reading approval queue…"
                      : pending
                        ? `${pending} request${pending === 1 ? "" : "s"} awaiting review`
                        : "No pending approvals"
                }
                action={
                  <button onClick={() => navigate("Approvals")}>
                    Review approvals
                  </button>
                }
              >
                {pendingError
                  ? "Open the queue to retry. No permission or request has changed."
                  : "Requests remain pending until you review their exact inputs. This count refreshes every 30 seconds and when you return."}
              </NexusState>
              <button onClick={() => navigate("Action history")}>
                View action history
              </button>
            </>
          )}
          {drawer === "system" && (
            <div className={styles.controlList}>
              <p>
                {environment} · {provider}
              </p>
              <button onClick={() => navigate("Settings")}>
                Permissions & settings
              </button>
              <button onClick={() => navigate("Tools")}>
                Tools & connections
              </button>
              {onOrbit && (
                <button
                  onClick={() => {
                    setDrawer(null);
                    onOrbit();
                  }}
                >
                  Open spatial navigation
                </button>
              )}
              <p className={styles.hint}>
                Resize this window freely. The workspace keeps its current
                conversation and selection. Native window controls remain
                available.
              </p>
              {onSignOut && <button onClick={onSignOut}>Sign out</button>}
            </div>
          )}
        </NexusDrawer>
      </div>
    </NexusModeContext.Provider>
  );
}
