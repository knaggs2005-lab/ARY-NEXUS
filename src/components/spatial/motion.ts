/** Shared animation vocabulary. All camera/card/light focus values share one clock. */
export const motion = {
  arriving: { stiffness: 145, damping: 25 },
  leaving: { stiffness: 180, damping: 28 },
  focusing: { stiffness: 160, damping: 25 },
  acknowledging: { stiffness: 220, damping: 27 },
  reporting: { stiffness: 140, damping: 26 },
  returning: { stiffness: 185, damping: 28 },
  drifting: { stiffness: 75, damping: 20 },
} as const;
export interface Spring {
  value: number;
  velocity: number;
}
export function stepSpring(
  s: Spring,
  target: number,
  seconds: number,
  curve: { stiffness: number; damping: number } = motion.focusing,
): Spring {
  const dt = Math.min(0.032, Math.max(0, seconds));
  const velocity =
    s.velocity +
    ((target - s.value) * curve.stiffness - s.velocity * curve.damping) * dt;
  const value = s.value + velocity * dt;
  return Math.abs(target - value) < 0.0005 && Math.abs(velocity) < 0.003
    ? { value: target, velocity: 0 }
    : { value, velocity };
}
export function nearestOrbit(current: number, index: number, count: number) {
  return (
    current +
    ((((index - current + count / 2) % count) + count) % count) -
    count / 2
  );
}
export const settled = (s: Spring, target: number) =>
  s.value === target && s.velocity === 0;
