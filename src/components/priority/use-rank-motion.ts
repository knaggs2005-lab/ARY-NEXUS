"use client";
import { useEffect, useLayoutEffect, useRef } from "react";
/** FLIP positions only: rank changes are communicated without moving keyboard focus. */
export function useRankMotion(revision: string) {
  const list = useRef<HTMLOListElement>(null);
  const previous = useRef(new Map<string, number>());
  const animations = useRef<Animation[]>([]);
  useLayoutEffect(() => {
    const offsets = new Map<string, number>();
    for (const node of list.current?.querySelectorAll<HTMLElement>(
      "[data-priority-id]",
    ) ?? []) {
      const transform = getComputedStyle(node).transform;
      offsets.set(
        node.dataset.priorityId!,
        transform === "none" ? 0 : new DOMMatrixReadOnly(transform).m42,
      );
    }
    animations.current.forEach((a) => a.cancel());
    animations.current = [];
    const next = new Map<string, number>();
    for (const node of list.current?.querySelectorAll<HTMLElement>(
      "[data-priority-id]",
    ) ?? []) {
      const key = node.dataset.priorityId!;
      const top = node.offsetTop;
      const settled = previous.current.get(key);
      const old =
        settled === undefined ? undefined : settled + (offsets.get(key) ?? 0);
      next.set(key, top);
      if (
        old !== undefined &&
        old !== top &&
        !matchMedia("(prefers-reduced-motion: reduce)").matches &&
        node.animate
      ) {
        animations.current.push(
          node.animate(
            [
              { transform: `translateY(${old - top}px)` },
              { transform: "translateY(0)" },
            ],
            { duration: 440, easing: "cubic-bezier(.2,.8,.2,1)" },
          ),
        );
      }
    }
    previous.current = next;
  }, [revision]);
  useEffect(() => {
    const preference = matchMedia("(prefers-reduced-motion: reduce)");
    const stop = () => {
      if (preference.matches) animations.current.forEach((a) => a.cancel());
    };
    preference.addEventListener("change", stop);
    return () => {
      preference.removeEventListener("change", stop);
      animations.current.forEach((a) => a.cancel());
    };
  }, []);
  return list;
}
