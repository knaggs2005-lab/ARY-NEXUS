"use client";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { Dashboard } from "../dashboard";
import { SpatialBoundary } from "./fallback-ui";
import {
  modules,
  emptySummary,
  type WorkspaceSummary,
  type ShellBridge,
} from "./modules";
import {
  initialSpatialState,
  spatialReducer,
  type SpatialEvent,
} from "./interaction-state";
import { useCameraSystem } from "./use-camera-system";
import { useGestures } from "./use-gestures";
import { capabilities, qualitySettings, type Quality } from "./performance";
import { SpatialScene } from "./spatial-scene";
import { SpatialHUD } from "./hud";
import { PerformanceControls } from "./performance-controls";
import styles from "./spatial.module.css";
// Landmark/HUD updates must not rerender the existing Brain or conversation view.
const ExistingWorkspace = memo(Dashboard);
export function SpatialShell() {
  return (
    <SpatialBoundary fallback={<Dashboard />}>
      <Shell />
    </SpatialBoundary>
  );
}
function Shell() {
  const [state, reduce] = useReducer(spatialReducer, initialSpatialState);
  const [summary, setSummary] = useState<WorkspaceSummary>(emptySummary),
    [classic, setClassic] = useState(true),
    [flat, setFlat] = useState(false),
    [hud, setHud] = useState(true),
    [reduced, setReduced] = useState(false),
    [systemReduced, setSystemReduced] = useState(false);
  const [qualityChoice, setQuality] = useState<"auto" | Quality>("auto"),
    [logs, setLogs] = useState(["Spatial layer ready · existing Ary services"]);
  const [navigation, setNavigation] = useState<ShellBridge["navigation"]>(null);
  const [caps, setCaps] = useState({
    css3d: true,
    webgl: false,
    webgpu: false,
    dpr: 1,
  });
  const world = useRef<HTMLDivElement>(null),
    cards = useRef<Array<HTMLButtonElement | null>>([]),
    openButton = useRef<HTMLButtonElement>(null);
  const onSummary = useCallback(
    (value: WorkspaceSummary) => setSummary(value),
    [],
  );
  const dispatch = useCallback((event: SpatialEvent) => {
    reduce(event);
    if (["select", "expand", "return", "rotate"].includes(event.type))
      setLogs((old) =>
        [
          ...old,
          `${new Date().toLocaleTimeString()} · ${event.type} module`,
        ].slice(-3),
      );
  }, []);
  const animation = useCameraSystem(
    world,
    cards,
    state,
    reduced || systemReduced,
    flat || !caps.css3d,
    !classic,
  );
  const quality = qualityChoice === "auto" ? animation.quality : qualityChoice;
  const gesture = useGestures(
    dispatch,
    state.phase === "expanded",
    qualitySettings[quality].trackingFps,
  );
  const current = modules[state.index],
    expanded =
      state.phase === "expanded" &&
      animation.metrics.revision === state.revision;
  useEffect(() => {
    setCaps(capabilities());
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    setSystemReduced(media.matches);
    const change = () => setSystemReduced(media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    if (expanded && current.tab)
      setNavigation({ tab: current.tab, revision: Date.now() });
  }, [expanded, current]);
  useEffect(() => {
    if (!expanded) openButton.current?.focus({ preventScroll: true });
  }, [expanded]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest("input,textarea,select,[contenteditable],dialog")
      )
        return;
      if (event.key === "Escape" && !classic) {
        event.preventDefault();
        dispatch({ type: "return" });
      } else if (
        !expanded &&
        !classic &&
        !event.defaultPrevented &&
        ["ArrowLeft", "ArrowRight"].includes(event.key)
      ) {
        event.preventDefault();
        dispatch({
          type: "rotate",
          direction: event.key === "ArrowLeft" ? -1 : 1,
        });
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [expanded, classic, dispatch]);
  const actualFlat = flat || !caps.css3d;
  const bridge = useMemo<ShellBridge>(
    () => ({
      active: expanded || classic,
      navigation,
      onSummary,
      onOrbit: () => {
        gesture.setEnabled(false);
        setClassic(false);
        dispatch({ type: "return" });
      },
      onReveal: () => {
        gesture.setEnabled(false);
        setClassic(true);
      },
    }),
    [expanded, classic, navigation, onSummary, gesture.setEnabled, dispatch],
  );
  return (
    <div
      className={classic ? styles.classic : styles.shell}
      data-quality={quality}
      data-reduced={reduced || systemReduced}
    >
      {!classic && (
        <>
          <header className={styles.header}>
            <a href="/" className={styles.brand}>
              <span>a</span> ARY NEXUS <small>SPATIAL OS / 01</small>
            </a>
            <div className={styles.headerTools}>
              <span className={styles.private}>
                {gesture.enabled
                  ? "HAND TRACKING · LOCAL ONLY"
                  : "PERSONAL INTELLIGENCE"}
              </span>
              <PerformanceControls
                trackingStatus={gesture.status}
                diagnostics={`${actualFlat ? "2D" : "CSS 3D"} · ${animation.metrics.fps ?? "—"} FPS · p95 ${animation.metrics.p95 ?? "—"} ms · ${animation.metrics.settled ? "settled" : "moving"}. WebGL ${caps.webgl ? "available" : "unavailable"}, WebGPU ${caps.webgpu ? "available" : "unavailable"}. CSS resolution is managed by the browser.`}
                flat={actualFlat}
                onFlat={() => setFlat((v) => !v)}
                tracking={gesture.enabled}
                onTracking={() => gesture.setEnabled((v) => !v)}
                hud={hud}
                onHud={() => setHud((v) => !v)}
                reduced={reduced || systemReduced}
                onReduced={() => setReduced((v) => !v)}
                quality={qualityChoice}
                onQuality={setQuality}
                onClassic={() => {
                  gesture.setEnabled(false);
                  setClassic(true);
                }}
              />
            </div>
          </header>
          {!expanded && (
            <main className={styles.stage}>
              <div className={styles.intro}>
                <span>YOUR WORLD, WITHIN REACH</span>
                <h1>
                  Space to think.
                  <br />
                  <em>Room to act.</em>
                </h1>
                <p>One intelligence. Everything connected.</p>
              </div>
              <SpatialScene
                world={world}
                cards={cards}
                state={state}
                summary={summary}
                dispatch={dispatch}
                flat={actualFlat}
                quality={quality}
              />
              {gesture.enabled && gesture.frame?.tracked && (
                <div
                  aria-hidden="true"
                  className={styles.gestureCursor}
                  data-pinched={gesture.frame.pinched}
                  data-target={!!gesture.target}
                  style={{
                    left: `${gesture.frame.cursor.x * 100}vw`,
                    top: `${gesture.frame.cursor.y * 100}vh`,
                  }}
                />
              )}
              <div className={styles.navigator}>
                <button
                  aria-label="Rotate modules left"
                  onClick={() => dispatch({ type: "rotate", direction: -1 })}
                >
                  ←
                </button>
                <div>
                  <small>{String(state.index + 1).padStart(2, "0")} / 10</small>
                  <strong>{current.name}</strong>
                </div>
                <button
                  aria-label="Rotate modules right"
                  onClick={() => dispatch({ type: "rotate", direction: 1 })}
                >
                  →
                </button>
                <button
                  ref={openButton}
                  className={styles.open}
                  disabled={!current.tab}
                  onClick={() => dispatch({ type: "expand" })}
                >
                  {current.tab ? `Open ${current.name}` : "Not connected"}
                  <span>↗</span>
                </button>
              </div>
              <div className={styles.directory} aria-label="Module shortcuts">
                {modules.map((m, i) => (
                  <button
                    aria-pressed={i === state.index}
                    key={m.id}
                    onClick={() => dispatch({ type: "select", index: i })}
                  >
                    {m.name}
                  </button>
                ))}
              </div>
              <button
                className={styles.priorityShortcut}
                onClick={() => {
                  gesture.setEnabled(false);
                  setNavigation({ tab: "Priority", revision: Date.now() });
                  setClassic(true);
                }}
              >
                Open Priority Intelligence ↗
              </button>
              <p className={styles.hint}>
                ← → TO ORBIT · DRAG TO INSPECT · OPEN TO ENTER · ESC TO RETURN
              </p>
              {gesture.enabled && (
                <div className={styles.trackingGuide} role="status">
                  <strong>
                    {gesture.target
                      ? `Aim: ${gesture.target}`
                      : gesture.frame?.tracked
                        ? "Aim your index finger at a module"
                        : gesture.status}
                  </strong>
                  <span>
                    Hold a pinch to select · Keep pinching and bring your hand
                    closer to open · Swipe an open palm to rotate
                  </span>
                  <button onClick={() => gesture.setEnabled(false)}>
                    Stop camera
                  </button>
                </div>
              )}
            </main>
          )}
          {hud && !expanded && (
            <SpatialHUD
              mode={actualFlat ? "2D / native fallback" : "CSS 3D / compositor"}
              fps={animation.metrics.fps}
              p95={animation.metrics.p95}
              settled={animation.metrics.settled}
              tracking={gesture.status}
              gesture={gesture.frame?.gesture ?? "none"}
              confidence={gesture.frame?.confidence ?? 0}
              latency={gesture.latency}
              logs={logs}
            />
          )}
        </>
      )}
      <section
        className={classic ? styles.classicWorkspace : styles.workspace}
        hidden={!expanded && !classic}
        inert={!expanded && !classic}
        aria-label="Existing Ary workspace"
      >
        <div
          className={styles.workspaceBar}
          hidden={classic}
          style={classic ? { display: "none" } : undefined}
        >
          <button
            onClick={() => {
              gesture.setEnabled(false);
              setClassic(false);
              dispatch({ type: "return" });
            }}
          >
            ← Return to orbit
          </button>
          <span>
            {classic
              ? "ORIGINAL WORKSPACE"
              : `${current.name.toUpperCase()} / CONNECTED WORKSPACE`}
          </span>
          <small>Existing services · permission protected</small>
        </div>
        <ExistingWorkspace shellBridge={bridge} />
      </section>
    </div>
  );
}
