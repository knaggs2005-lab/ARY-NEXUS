/** Camera and cards consume the same focus progress; no competing timelines. */
export function cameraPose(focus: number) {
  return {
    approach: Math.max(0, Math.min(1, focus)) * 32,
    glow: 0.25 + Math.max(0, focus) * 0.35,
  };
}
export function orbitPose(
  index: number,
  orbit: number,
  count: number,
  focus: number,
  selected: number,
  width: number,
) {
  const angle = ((index - orbit) * Math.PI * 2) / count,
    front = (Math.cos(angle) + 1) / 2;
  const chosen = index === selected;
  return {
    x: Math.sin(angle) * Math.min(540, width * 0.45),
    y: (1 - front) * -120 + (chosen ? -focus * 12 : focus * 15),
    z: (front - 1) * 420 + (chosen ? focus * 100 : -focus * 90),
    rotateY: -Math.sin(angle) * 18,
    opacity: chosen
      ? 1
      : front < 0.6
        ? 0
        : Math.max(0.13, (0.25 + front * 0.55) * (1 - focus * 0.45)),
    scale: chosen ? 1 + focus * 0.08 : 1 - focus * 0.08,
    order: Math.round(front * 100) + (chosen ? 100 : 0),
  };
}
