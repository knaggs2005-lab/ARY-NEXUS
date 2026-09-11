"use client";
import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
} from "react";
import type { BrainGraph } from "@/domain/brain-graph";
import {
  fitCamera,
  layoutGraph,
  neighborhood,
  nodeColor,
  radius,
  zoomAt,
  type Camera,
  type Point,
} from "./graph-engine";
import styles from "./brain.module.css";
import { BrainEffects } from "./brain-effects";
import { createEffectsBridge } from "./effects/bridge";
export type BrainCanvasHandle = {
  fit(): void;
  zoom(factor: number): void;
  flyTo(id: string): void;
};
type Props = {
  graph: BrainGraph;
  selected: string | null;
  onSelect: (id: string) => void;
  onClear: () => void;
  ref?: Ref<BrainCanvasHandle>;
  knowledgeEvents?: boolean;
  layoutPositions?: Map<string, Point>;
  onScale?: (scale: number) => void;
  onOrbit?: (dx: number, dy: number) => void;
  observedEdges?: ReadonlySet<string>;
  atlas?: boolean;
};
export function BrainCanvas({
  graph,
  selected,
  onSelect,
  onClear,
  knowledgeEvents = true,
  layoutPositions,
  onScale,
  onOrbit,
  observedEdges,
  atlas = false,
  ref,
}: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [effects] = useState(createEffectsBridge);
  const latest = useRef({
    graph,
    selected,
    onSelect,
    onClear,
    onScale,
    onOrbit,
    observedEdges,
    atlas,
  });
  const controls = useRef<BrainCanvasHandle>({
    fit() {},
    zoom() {},
    flyTo() {},
  });
  const invalidate = useRef<() => void>(() => {});
  const targets = useRef(new Map<string, Point>());
  const [zoomLabel, setZoomLabel] = useState(100);
  useImperativeHandle(
    ref,
    () => ({
      fit: () => controls.current.fit(),
      zoom: (f) => controls.current.zoom(f),
      flyTo: (id) => controls.current.flyTo(id),
    }),
    [],
  );
  useEffect(() => {
    latest.current = {
      graph,
      selected,
      onSelect,
      onClear,
      onScale,
      onOrbit,
      observedEdges,
      atlas,
    };
    targets.current =
      layoutPositions ??
      layoutGraph(graph, targets.current, selected ?? undefined);
    invalidate.current();
  }, [
    graph,
    selected,
    onSelect,
    onClear,
    layoutPositions,
    onScale,
    onOrbit,
    observedEdges,
    atlas,
  ]);
  useEffect(() => {
    const el = canvas.current!;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reduced = media.matches,
      width = 1,
      height = 1,
      frame = 0,
      disposed = false,
      visible = true,
      initial = true;
    let camera: Camera = { x: 0, y: 0, scale: 1 },
      dest = { ...camera },
      lastZoom = 100;
    let hovered: string | null = null,
      animatingUntil = 0;
    const drawn = new Map<string, Point>();
    const opacity = new Map<string, number>();
    const pointers = new Map<number, Point>();
    let down: Point | null = null,
      moved = false,
      pinchDistance = 0;
    const wake = () => {
      if (!frame && !disposed && visible && !document.hidden)
        frame = requestAnimationFrame(draw);
    };
    const relative = (event: { clientX: number; clientY: number }) => {
      const rect = el.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };
    const hit = (p: Point) => {
      const world = {
        x: (p.x - camera.x) / camera.scale,
        y: (p.y - camera.y) / camera.scale,
      };
      let closest: string | null = null,
        best = Infinity;
      for (const n of latest.current.graph.nodes) {
        const loc = drawn.get(n.id);
        if (!loc) continue;
        const distance = Math.hypot(loc.x - world.x, loc.y - world.y);
        if (
          distance < Math.max(16 / camera.scale, radius(n) + 10) &&
          distance < best
        ) {
          closest = n.id;
          best = distance;
        }
      }
      return closest;
    };
    const fit = () => {
      dest = fitCamera(targets.current, width, height);
      wake();
    };
    controls.current = {
      fit,
      zoom: (factor) => {
        dest = zoomAt(dest, factor, { x: width / 2, y: height / 2 });
        wake();
      },
      flyTo: (id) => {
        const p = targets.current.get(id);
        if (p) {
          dest = {
            x: width / 2 - p.x * 1.1,
            y: height / 2 - p.y * 1.1,
            scale: 1.1,
          };
          wake();
        }
      },
    };
    invalidate.current = () => {
      animatingUntil = performance.now() + 1400;
      wake();
    };
    function draw(time: number) {
      frame = 0;
      if (disposed || !ctx || width < 10 || height < 10) return;
      const { graph, selected } = latest.current;
      if (initial && graph.nodes.length) {
        dest = fitCamera(targets.current, width, height);
        camera = { ...dest };
        initial = false;
      }
      const connected = neighborhood(graph, selected);
      const t = reduced ? 1 : 0.16;
      let moving = false;
      for (const key of ["x", "y", "scale"] as const) {
        const delta = dest[key] - camera[key];
        if (Math.abs(delta) > 0.001) moving = true;
        camera[key] += delta * t;
      }
      const z = Math.round(camera.scale * 100);
      if (z !== lastZoom) {
        lastZoom = z;
        setZoomLabel(z);
        latest.current.onScale?.(camera.scale);
      }
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      for (const n of graph.nodes) {
        const target = targets.current.get(n.id)!;
        const old = drawn.get(n.id) ??
          (selected ? drawn.get(selected) : undefined) ?? {
            x: target.x * 0.65,
            y: target.y * 0.65,
          };
        const p = {
          x: old.x + (target.x - old.x) * t,
          y: old.y + (target.y - old.y) * t,
        };
        if (Math.hypot(p.x - target.x, p.y - target.y) > 0.1) moving = true;
        drawn.set(n.id, p);
        const wanted = selected && !connected.has(n.id) ? 0.18 : 1,
          prior = opacity.get(n.id) ?? 0;
        opacity.set(n.id, prior + (wanted - prior) * t);
        if (Math.abs(prior - wanted) > 0.005) moving = true;
      }
      const ids = new Set(graph.nodes.map((n) => n.id));
      for (const id of drawn.keys())
        if (!ids.has(id)) {
          drawn.delete(id);
          opacity.delete(id);
        }
      effects.publish({
        graph,
        selected: latest.current.atlas ? null : selected,
        camera: { ...camera },
        positions: drawn,
        opacity,
        width,
        height,
      });
      ctx.save();
      ctx.translate(camera.x, camera.y);
      ctx.scale(camera.scale, camera.scale);
      for (const e of graph.edges) {
        const a = drawn.get(e.source),
          b = drawn.get(e.target);
        if (!a || !b) continue;
        const observed = latest.current.observedEdges?.has(e.id) ?? false;
        const lit =
          observed ||
          (!!selected && (e.source === selected || e.target === selected));
        ctx.globalAlpha = selected ? (lit ? 0.85 : 0.075) : 0.32;
        ctx.strokeStyle =
          e.type === "blocks"
            ? "#d4ae79"
            : observed
              ? "#d5c2f2"
              : lit
                ? "#b9cadc"
                : latest.current.atlas
                  ? "#576780"
                  : "#7a958b";
        ctx.lineWidth = (lit ? 1.3 : 0.65) + e.strength * 0.6;
        ctx.setLineDash(
          e.status !== "current" ? [5, 7] : e.type === "blocks" ? [2, 5] : [],
        );
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        if (observed && !reduced) {
          const progress = (time % 1800) / 1800;
          ctx.fillStyle = "#dfd2ed";
          ctx.beginPath();
          ctx.arc(
            a.x + (b.x - a.x) * progress,
            a.y + (b.y - a.y) * progress,
            2.2 / camera.scale,
            0,
            Math.PI * 2,
          );
          ctx.fill();
        }
        if (lit && camera.scale > 0.65) {
          ctx.globalAlpha = 0.85;
          ctx.font = "10px Inter, system-ui, sans-serif";
          ctx.fillStyle = e.type === "blocks" ? "#d4ae79" : "#a0b1a9";
          ctx.textAlign = "center";
          ctx.fillText(
            e.type.replaceAll("_", " "),
            (a.x + b.x) / 2,
            (a.y + b.y) / 2 - 9,
          );
        }
      }
      ctx.setLineDash([]);
      let viewportNodes = 0;
      for (const n of graph.nodes) {
        const p = drawn.get(n.id)!;
        const sx = p.x * camera.scale + camera.x,
          sy = p.y * camera.scale + camera.y;
        if (sx >= 0 && sx <= width && sy >= 0 && sy <= height) viewportNodes++;
        if (sx < -150 || sx > width + 150 || sy < -100 || sy > height + 100)
          continue;
        const r = radius(n),
          active = n.id === selected,
          over = n.id === hovered,
          color = latest.current.atlas
            ? n.activeBlockerCount > 0
              ? "#d4ae79"
              : n.type === "cluster"
                ? "#a3a9c6"
                : n.type === "ary"
                  ? "#eee8fc"
                  : "#a9bdd4"
            : nodeColor(n);
        ctx.globalAlpha = opacity.get(n.id) ?? 1;
        const alive =
          n.status === "active" ||
          Date.now() - Date.parse(n.recency) < 7 * 86400000;
        const pulse =
          !latest.current.atlas && !reduced && alive && time < animatingUntil
            ? Math.sin(time / 650) * 2
            : 0;
        if (active || over || alive) {
          const glow = ctx.createRadialGradient(
            p.x,
            p.y,
            r * 0.25,
            p.x,
            p.y,
            r * (active ? 3.5 : 2.3),
          );
          glow.addColorStop(0, active ? "#8db9a52a" : "#8db9a512");
          glow.addColorStop(1, "#8db9a500");
          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(p.x, p.y, r * 3.5, 0, Math.PI * 2);
          ctx.fill();
        }
        if (active) {
          ctx.strokeStyle = "#c4d9cf70";
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          ctx.arc(p.x, p.y, r + 13 + pulse, 0, Math.PI * 2);
          ctx.stroke();
          ctx.strokeStyle = "#a8c9b928";
          ctx.beginPath();
          ctx.arc(p.x, p.y, r + 21, 0, Math.PI * 2);
          ctx.stroke();
        }
        const fill = ctx.createRadialGradient(
          p.x - r * 0.3,
          p.y - r * 0.4,
          1,
          p.x,
          p.y,
          r,
        );
        fill.addColorStop(
          0,
          latest.current.atlas
            ? active
              ? "#45506e"
              : "#293242"
            : active
              ? "#638679"
              : "#384d44",
        );
        fill.addColorStop(1, latest.current.atlas ? "#101722" : "#192822");
        ctx.fillStyle = fill;
        ctx.strokeStyle = color;
        ctx.lineWidth = active ? 1.4 : 0.8;
        ctx.beginPath();
        if (latest.current.atlas && n.type === "cluster")
          ctx.roundRect(p.x - r, p.y - r, r * 2, r * 2, 8);
        else ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = color;
        ctx.font = `${Math.max(10 / camera.scale, r * 0.42)}px Inter, system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        if (camera.scale > 0.5 || active || over)
          ctx.fillText(
            "members" in n && Array.isArray(n.members)
              ? String(n.members.length)
              : n.label
                  .split(/\s+/)
                  .map((w) => w[0])
                  .join("")
                  .slice(0, 2)
                  .toUpperCase(),
            p.x,
            p.y,
          );
        if (n.activeBlockerCount > 0 || n.status === "blocked") {
          ctx.fillStyle = "#d4ae79";
          ctx.beginPath();
          ctx.moveTo(p.x + r, p.y - r - 7);
          ctx.lineTo(p.x + r + 5, p.y - r);
          ctx.lineTo(p.x + r, p.y - r + 7);
          ctx.lineTo(p.x + r - 5, p.y - r);
          ctx.fill();
        }
        if (camera.scale > 0.55 || active || over || graph.nodes.length < 35) {
          ctx.fillStyle = active ? "#f0efe9" : "#bac3bd";
          ctx.font = `${active ? 500 : 400} ${11 / camera.scale}px Inter, system-ui, sans-serif`;
          const label =
            n.label.length > 29 ? n.label.slice(0, 27) + "…" : n.label;
          ctx.fillText(label, p.x, p.y + r + 22 / camera.scale);
          ctx.fillStyle = "#71857a";
          ctx.font = `${8 / camera.scale}px Inter, system-ui, sans-serif`;
          ctx.fillText(n.type.toUpperCase(), p.x, p.y + r + 37 / camera.scale);
        }
      }
      ctx.restore();
      ctx.globalAlpha = 1;
      if (latest.current.atlas) {
        el.dataset.settled = String(!moving);
        el.dataset.drawnNodes = String(graph.nodes.length);
        el.dataset.viewportNodes = String(viewportNodes);
      }
      if (moving || (!reduced && time < animatingUntil)) wake();
    }
    const resize = new ResizeObserver(([entry]) => {
      const before = { x: width / 2, y: height / 2 };
      width = entry.contentRect.width;
      height = entry.contentRect.height;
      const dpr = Math.min(devicePixelRatio || 1, 2);
      el.width = Math.round(width * dpr);
      el.height = Math.round(height * dpr);
      dest.x += width / 2 - before.x;
      dest.y += height / 2 - before.y;
      wake();
    });
    resize.observe(el);
    const intersection = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      if (visible) wake();
      else {
        cancelAnimationFrame(frame);
        frame = 0;
      }
    });
    intersection.observe(el);
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      dest = zoomAt(dest, Math.exp(-e.deltaY * 0.0015), relative(e));
      wake();
    };
    const pointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      el.focus({ preventScroll: true });
      const p = relative(e);
      pointers.set(e.pointerId, p);
      el.setPointerCapture(e.pointerId);
      down = p;
      moved = false;
      dest = { ...camera };
      if (pointers.size === 2) {
        moved = true;
        const [a, b] = [...pointers.values()];
        pinchDistance = Math.hypot(a.x - b.x, a.y - b.y);
      }
    };
    const pointerMove = (e: PointerEvent) => {
      const p = relative(e);
      const prior = pointers.get(e.pointerId);
      if (prior) {
        pointers.set(e.pointerId, p);
        if (pointers.size === 2) {
          const [a, b] = [...pointers.values()],
            distance = Math.hypot(a.x - b.x, a.y - b.y);
          dest = zoomAt(dest, distance / Math.max(1, pinchDistance), {
            x: (a.x + b.x) / 2,
            y: (a.y + b.y) / 2,
          });
          pinchDistance = distance;
          moved = true;
        } else {
          if (latest.current.onOrbit)
            latest.current.onOrbit(p.x - prior.x, p.y - prior.y);
          else {
            dest.x += p.x - prior.x;
            dest.y += p.y - prior.y;
          }
          if (down && Math.hypot(p.x - down.x, p.y - down.y) > 5) moved = true;
        }
        wake();
      } else {
        const next = hit(p);
        if (next !== hovered) {
          hovered = next;
          el.style.cursor = next ? "pointer" : "grab";
          wake();
        }
      }
    };
    const pointerUp = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.delete(e.pointerId);
      if (pointers.size) {
        moved = true;
        return;
      }
      if (!moved && e.type !== "pointercancel") {
        const id = hit(relative(e));
        if (id) latest.current.onSelect(id);
        else latest.current.onClear();
      }
      down = null;
    };
    const key = (e: KeyboardEvent) => {
      if (
        [
          "ArrowLeft",
          "ArrowRight",
          "ArrowUp",
          "ArrowDown",
          "+",
          "=",
          "-",
          "0",
          "Escape",
        ].includes(e.key)
      ) {
        e.preventDefault();
        if (e.key === "0") fit();
        else if (e.key === "+" || e.key === "=") controls.current.zoom(1.2);
        else if (e.key === "-") controls.current.zoom(1 / 1.2);
        else if (e.key === "Escape") latest.current.onClear();
        else if (latest.current.onOrbit) {
          latest.current.onOrbit(
            e.key === "ArrowLeft" ? -20 : e.key === "ArrowRight" ? 20 : 0,
            e.key === "ArrowUp" ? -20 : e.key === "ArrowDown" ? 20 : 0,
          );
        } else {
          dest.x +=
            e.key === "ArrowLeft" ? 65 : e.key === "ArrowRight" ? -65 : 0;
          dest.y += e.key === "ArrowUp" ? 65 : e.key === "ArrowDown" ? -65 : 0;
          wake();
        }
      }
    };
    const motion = () => {
      reduced = media.matches;
      wake();
    };
    const visibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(frame);
        frame = 0;
      } else wake();
    };
    el.addEventListener("wheel", wheel, { passive: false });
    el.addEventListener("pointerdown", pointerDown);
    el.addEventListener("pointermove", pointerMove);
    el.addEventListener("pointerup", pointerUp);
    el.addEventListener("pointercancel", pointerUp);
    el.addEventListener("keydown", key);
    media.addEventListener("change", motion);
    document.addEventListener("visibilitychange", visibility);
    wake();
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      resize.disconnect();
      intersection.disconnect();
      el.removeEventListener("wheel", wheel);
      el.removeEventListener("pointerdown", pointerDown);
      el.removeEventListener("pointermove", pointerMove);
      el.removeEventListener("pointerup", pointerUp);
      el.removeEventListener("pointercancel", pointerUp);
      el.removeEventListener("keydown", key);
      media.removeEventListener("change", motion);
      document.removeEventListener("visibilitychange", visibility);
      invalidate.current = () => {};
    };
  }, []);
  return (
    <div className={styles.canvasWrap}>
      <BrainEffects bridge={effects} knowledgeEvents={knowledgeEvents} />
      <canvas
        ref={canvas}
        className={styles.canvas}
        tabIndex={0}
        role="img"
        aria-label={
          atlas
            ? "Nexus spatial map. Drag to pan or orbit in the selected mode. Arrow keys move; plus and minus zoom; zero fits. Select records using search or the accessible directory."
            : "Brain graph. Drag to pan, scroll or pinch to zoom. Arrow keys pan; plus and minus zoom; zero fits. Select nodes using the directory or search."
        }
      />
      <span className={styles.zoomReadout}>{zoomLabel}%</span>
    </div>
  );
}
