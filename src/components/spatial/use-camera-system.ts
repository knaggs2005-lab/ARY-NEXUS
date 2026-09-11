"use client";
import { useEffect, useRef, useState, type RefObject } from "react";
import { cameraPose, orbitPose } from "./camera";
import { motion, nearestOrbit, stepSpring, settled } from "./motion";
import { FrameSampler, adaptiveQuality, type Quality } from "./performance";
import type { SpatialState } from "./interaction-state";
import { modules } from "./modules";
export function useCameraSystem(
  world: RefObject<HTMLDivElement | null>,
  cards: RefObject<Array<HTMLButtonElement | null>>,
  state: SpatialState,
  reduced: boolean,
  flat: boolean,
  visible = true,
) {
  const positions = useRef({
    orbit: { value: 0, velocity: 0 },
    focus: { value: 0, velocity: 0 },
    x: { value: 0, velocity: 0 },
    y: { value: 0, velocity: 0 },
  });
  const [sizeRevision, setSizeRevision] = useState(0);
  useEffect(() => {
    const node = world.current;
    if (!node || !visible) return;
    const observer = new ResizeObserver(() => setSizeRevision((v) => v + 1));
    observer.observe(node);
    return () => observer.disconnect();
  }, [visible, world, state.phase]);
  const [metrics, setMetrics] = useState<{
    revision: number;
    frames: number;
    fps: number | null;
    p95: number | null;
    settled: boolean;
  }>({ revision: -1, frames: 0, fps: null, p95: null, settled: true });
  const [quality, setQuality] = useState<Quality>("balanced");
  useEffect(() => {
    const node = world.current;
    if (!node || !visible) return;
    let frame = 0,
      last = 0;
    const sampler = new FrameSampler();
    const p = positions.current;
    const target = {
      orbit: nearestOrbit(p.orbit.value, state.index, modules.length),
      focus: state.phase === "orbit" ? 0 : 1,
      x: state.drag?.x ?? 0,
      y: state.drag?.y ?? 0,
    };
    const finish = () => {
      const m = sampler.result();
      setMetrics({ ...m, revision: state.revision, settled: true });
      if (m.frames >= 15) setQuality(adaptiveQuality(m.fps));
    };
    function tick(time: number) {
      const dt = last ? (time - last) / 1000 : 1 / 60;
      last = time;
      sampler.add(time);
      for (const key of ["orbit", "focus", "x", "y"] as const)
        p[key] =
          reduced || flat
            ? { value: target[key], velocity: 0 }
            : stepSpring(
                p[key],
                target[key],
                dt,
                state.phase === "orbit" ? motion.returning : motion.focusing,
              );
      const camera = cameraPose(p.focus.value);
      node!.style.setProperty("--approach", `${camera.approach}px`);
      node!.style.setProperty("--focus-light", String(camera.glow));
      cards.current.forEach((card, i) => {
        if (!card) return;
        if (flat) {
          card.inert = false;
          return;
        }
        const pose = orbitPose(
          i,
          p.orbit.value,
          modules.length,
          p.focus.value,
          state.index,
          node!.clientWidth,
        );
        card.style.transform = `translate(-50%, -50%) translate3d(${pose.x + (i === state.index ? p.x.value : 0)}px,${pose.y + (i === state.index ? p.y.value : 0)}px,${pose.z}px) rotateY(${pose.rotateY}deg) scale(${pose.scale})`;
        card.style.opacity = String(pose.opacity);
        card.inert = pose.opacity === 0;
        card.style.zIndex = String(pose.order);
      });
      if (
        Object.keys(target).every((k) =>
          settled(p[k as keyof typeof p], target[k as keyof typeof target]),
        )
      )
        finish();
      else frame = requestAnimationFrame(tick);
    }
    setMetrics((m) => ({ ...m, settled: false }));
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [
    state.revision,
    sizeRevision,
    visible,
    state.index,
    state.phase,
    state.drag,
    state.frozen,
    reduced,
    flat,
    world,
    cards,
  ]);
  return { metrics, quality };
}
