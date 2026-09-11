"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Entity, EntityAlias, Task } from "../../domain/models";
import type { InstalledApp } from "../../domain/desktop";
import { api } from "../api";
import { useAryVoice } from "../voice/use-ary-voice";
import {
  buildCommands,
  indexCommands,
  rankCommands,
  websiteCommand,
  voiceQuery,
  exactVoiceDestination,
  dispatchCommand,
  type CatalogItem,
  type Command,
  type Destination,
} from "./command-index";
import styles from "./palette.module.css";
export function CommandPalette({
  entities,
  tasks,
  aliases,
  onNavigate,
  onOpen,
  reflectionDev = false,
  showLauncher = true,
  supportsDestination,
}: {
  entities: Entity[];
  tasks: Task[];
  aliases: EntityAlias[];
  onNavigate: (d: Destination) => void;
  onOpen: () => void;
  reflectionDev?: boolean;
  showLauncher?: boolean;
  supportsDestination?: (destination: Destination) => boolean;
}) {
  const [mounted, setMounted] = useState(false),
    [open, setOpen] = useState(false),
    [query, setQuery] = useState(""),
    [selected, setSelected] = useState(0),
    [tools, setTools] = useState<CatalogItem[]>([]),
    [apps, setApps] = useState<InstalledApp[]>([]),
    [status, setStatus] = useState(""),
    [loading, setLoading] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null),
    input = useRef<HTMLInputElement>(null),
    previous = useRef<HTMLElement | null>(null),
    pending = useRef<AbortController | null>(null),
    running = useRef(false),
    opened = useRef(false);
  const attempt = useRef<{
    id: string;
    operationId: string;
    requestKey: string;
  } | null>(null);
  const commands = useMemo(
    () =>
      buildCommands(
        entities,
        tasks,
        aliases,
        apps,
        tools,
        reflectionDev,
      ).filter(
        (c) =>
          !c.destination ||
          !supportsDestination ||
          supportsDestination(c.destination),
      ),
    [entities, tasks, aliases, apps, tools, reflectionDev, supportsDestination],
  );
  const index = useMemo(() => indexCommands(commands), [commands]);
  const results = useMemo(() => {
    const web = websiteCommand(query);
    return web
      ? [{ command: web, tier: 0, reason: "Website" }]
      : rankCommands(index, query);
  }, [index, query]);
  const voice = useAryVoice(
    (text) => {
      if (!opened.current) return;
      const q = voiceQuery(text);
      setQuery(q);
      setSelected(0);
      const exact = exactVoiceDestination(commands, text);
      if (exact) void choose(exact);
      else
        setStatus(
          "Transcript ready. Choose a result; ambiguous names are not opened automatically.",
        );
    },
    () => {},
  );
  function show() {
    if (running.current || document.querySelector("dialog[open]")) return;
    previous.current = document.activeElement as HTMLElement;
    onOpen();
    opened.current = true;
    setQuery("");
    setSelected(0);
    setStatus("");
    setOpen(true);
  }
  function close() {
    opened.current = false;
    voice.cancelCapture();
    voice.stopSpeaking();
    pending.current?.abort();
    setOpen(false);
    dialog.current?.close();
    previous.current?.focus({ preventScroll: true });
  }
  async function choose(command: Command) {
    if (running.current) return;
    running.current = true;
    close();
    if (command.execution) onNavigate({ tab: "Approvals" });
    if (command.execution && attempt.current?.id !== command.id)
      attempt.current = {
        id: command.id,
        operationId: crypto.randomUUID(),
        requestKey: crypto.randomUUID(),
      };
    try {
      await dispatchCommand(command, {
        executionKeys: attempt.current ?? undefined,
        navigate: onNavigate,
        request: async (body) => {
          return (
            await api("actions/request", {
              method: "POST",
              body: JSON.stringify(body),
            })
          ).json();
        },
        uuid: () => crypto.randomUUID(),
      });
      attempt.current = null;
      if (command.execution) onNavigate({ tab: "Action history" });
    } catch (e) {
      setStatus((e as Error).message);
      setOpen(true);
      opened.current = true;
    } finally {
      running.current = false;
    }
  }
  async function scan() {
    if (loading) return;
    setLoading(true);
    setStatus("");
    const controller = new AbortController();
    pending.current = controller;
    try {
      const data = await (
        await api(
          "actions/request",
          {
            method: "POST",
            signal: controller.signal,
            body: JSON.stringify({
              tool: "desktop.list_apps",
              input: {},
              request_key: crypto.randomUUID(),
              reason: "Refresh installed apps in the Ary command palette",
            }),
          },
          true,
        )
      ).json();
      if (!controller.signal.aborted) setApps(data.result.apps);
    } catch (e) {
      if (!controller.signal.aborted) setStatus((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    setMounted(true);
    return () => {
      opened.current = false;
      pending.current?.abort();
    };
  }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        (e.metaKey || e.ctrlKey) &&
        e.key.toLowerCase() === "k" &&
        !e.isComposing
      ) {
        e.preventDefault();
        e.stopPropagation();
        if (opened.current) close();
        else show();
      }
    };
    window.addEventListener("keydown", key);
    window.addEventListener("ary:open-command", show);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("ary:open-command", show);
    };
  });
  useEffect(() => {
    if (!open) return;
    dialog.current?.showModal();
    input.current?.focus();
    const controller = new AbortController();
    void api("actions/tools", { signal: controller.signal })
      .then((r) => r.json())
      .then((data) => {
        if (!controller.signal.aborted) setTools(data);
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setStatus(
            "Action catalog unavailable. Workspace navigation remains available.",
          );
      });
    return () => controller.abort();
  }, [open]);
  useEffect(() => {
    setSelected(0);
  }, [query]);
  useEffect(() => {
    document
      .getElementById(`ary-command-${selected}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selected]);
  const active = Math.min(selected, Math.max(0, results.length - 1));
  return mounted
    ? createPortal(
        <>
          {showLauncher && (
            <button
              className={styles.launcher}
              onClick={show}
              aria-label="Open Ary command palette"
              aria-keyshortcuts="Meta+k Control+k"
            >
              Search Ary <kbd>⌘K</kbd>
            </button>
          )}
          <dialog
            ref={dialog}
            className={styles.dialog}
            aria-label="Ary command palette"
            onCancel={(e) => {
              e.preventDefault();
              close();
            }}
            onClick={(e) => {
              if (e.target === e.currentTarget) close();
            }}
          >
            <div className={styles.body}>
              <div className={styles.top}>
                <span>ARY / COMMAND</span>
                <button onClick={close} aria-label="Close command palette">
                  Esc
                </button>
              </div>
              <input
                ref={input}
                value={query}
                maxLength={2048}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Apps, projects, tasks, actions, or a website URL…"
                role="combobox"
                aria-label="Search Ary commands"
                aria-autocomplete="list"
                aria-expanded={open}
                aria-controls="ary-command-results"
                aria-activedescendant={
                  results.length ? `ary-command-${active}` : undefined
                }
                onKeyDown={(e) => {
                  if (e.nativeEvent.isComposing) return;
                  if (
                    ["ArrowDown", "ArrowUp", "Home", "End", "Enter"].includes(
                      e.key,
                    )
                  ) {
                    e.preventDefault();
                    if (e.key === "Enter") {
                      if (results[active]) void choose(results[active].command);
                    } else
                      setSelected(
                        e.key === "Home"
                          ? 0
                          : e.key === "End"
                            ? Math.max(0, results.length - 1)
                            : (active +
                                (e.key === "ArrowDown" ? 1 : -1) +
                                results.length) %
                              Math.max(1, results.length),
                      );
                  }
                }}
              />
              <div className={styles.tools}>
                <button disabled={loading} onClick={() => void scan()}>
                  {loading ? "Scanning…" : "Refresh installed apps"}
                </button>
                <button
                  disabled={
                    !voice.supported ||
                    ["requesting", "transcribing"].includes(voice.capture)
                  }
                  onClick={() =>
                    voice.capture === "listening"
                      ? voice.stopListening()
                      : void voice.startListening()
                  }
                >
                  {voice.capture === "listening"
                    ? "Finish recording"
                    : "Speak a command"}
                </button>
                <span>
                  {voice.capture !== "idle"
                    ? voice.capture
                    : "↑ ↓ navigate · Enter open"}
                </span>
              </div>
              <p role="status">
                {status || voice.error || voice.partialTranscript}
              </p>
              <ul
                id="ary-command-results"
                role="listbox"
                aria-label="Command results"
                className={styles.results}
              >
                {results.map(({ command, reason }, i) => (
                  <li
                    key={command.id}
                    id={`ary-command-${i}`}
                    role="option"
                    aria-selected={i === active}
                    onMouseMove={() => setSelected(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => void choose(command)}
                  >
                    <span className={styles.tag}>{command.source}</span>
                    <div>
                      <strong>{command.label}</strong>
                      <small>{command.detail}</small>
                    </div>
                    <small>{reason}</small>
                  </li>
                ))}
              </ul>
              {!results.length && query.trim() && (
                <button
                  onClick={() =>
                    void choose({
                      id: "semantic",
                      label: "Search Ary memory",
                      source: "action",
                      aliases: [],
                      detail: "Existing semantic retrieval",
                      destination: { tab: "Memories", query },
                    })
                  }
                >
                  Search Ary memory for “{query}”
                </button>
              )}
              <footer>
                External commands retain permissions and approval. App discovery
                requires the enabled Desktop Bridge. Voice uses the same results
                and dispatcher.
              </footer>
            </div>
          </dialog>
        </>,
        document.body,
      )
    : null;
}
