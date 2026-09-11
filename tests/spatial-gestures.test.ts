import { it, expect } from "vitest";
import {
  GestureEngine,
  type Landmark,
} from "../src/components/spatial/gesture-engine";
function hand() {
  const points: Landmark[] = Array.from({ length: 21 }, () => ({
    x: 0.5,
    y: 0.6,
    z: 0,
  }));
  points[0] = { x: 0.5, y: 0.8, z: 0 };
  points[5] = { x: 0.4, y: 0.6, z: 0 };
  points[17] = { x: 0.6, y: 0.6, z: 0 };
  points[4] = { x: 0.2, y: 0.55, z: 0 };
  for (const i of [8, 12, 16, 20]) {
    points[i] = { x: 0.4 + (i - 8) * 0.015, y: 0.25, z: 0 };
    points[i - 2] = { x: points[i].x, y: 0.5, z: 0 };
  }
  return points;
}
function pinched() {
  const p = hand();
  p[4] = { ...p[8], x: p[8].x + 0.02 };
  return p;
}
const scale = (p: Landmark[], size: number) =>
  p.map((v) => ({
    x: 0.5 + (v.x - 0.5) * size,
    y: 0.8 + (v.y - 0.8) * size,
    z: v.z,
  }));
it("recognizes open and closed hands with fingertip and mirrored palm positions", () => {
  const engine = new GestureEngine();
  const open = engine.update(hand(), 100);
  expect(open.gesture).toBe("open_hand");
  expect(open.tips).toHaveLength(5);
  expect(open.palm.x).toBeCloseTo(0.5);
  const closed = hand();
  for (const i of [8, 12, 16, 20]) closed[i] = { x: 0.5, y: 0.7, z: 0 };
  closed[4] = { x: 0.2, y: 0.6, z: 0 };
  expect(engine.update(closed, 300).gesture).toBe("closed_hand");
});
it("uses pinch hysteresis and emits a release when tracking is lost", () => {
  const engine = new GestureEngine();
  expect(engine.update(pinched(), 0).gesture).not.toBe("pinch");
  expect(engine.update(pinched(), 100).gesture).toBe("pinch");
  const near = pinched();
  near[4].x = near[8].x + 0.08;
  expect(engine.update(near, 200).pinched).toBe(true);
  expect(engine.update([], 300).gesture).toBe("release");
  expect(engine.update([], 400).gesture).toBe("none");
});
it.each([
  [0.25, "swipe_left"],
  [-0.25, "swipe_right"],
] as const)(
  "maps mirrored swipe %s to %s once per cooldown",
  (shift, gesture) => {
    const engine = new GestureEngine();
    engine.update(hand(), 0);
    const moved = hand().map((p) => ({ ...p, x: p.x + shift }));
    expect(engine.update(moved, 250).gesture).toBe(gesture);
    expect(engine.update(hand(), 350).gesture).not.toContain("swipe");
  },
);
it("uses palm-span change while pinched for pull and push, never a destructive action", () => {
  const engine = new GestureEngine();
  engine.update(pinched(), 0);
  engine.update(pinched(), 100);
  expect(engine.update(scale(pinched(), 1.4), 300).gesture).not.toBe("pull");
  expect(engine.update(scale(pinched(), 1.4), 430).gesture).toBe("pull");
  engine.update(scale(pinched(), 0.8), 1500);
  expect(engine.update(scale(pinched(), 0.8), 1630).gesture).toBe("push");
  engine.update(hand(), 1700);
  expect(engine.update(hand(), 1800).gesture).toBe("release");
});
it("requires a steady open palm before freezing, and resets on tracking loss", () => {
  const engine = new GestureEngine();
  for (const time of [0, 200, 400, 600])
    expect(engine.update(hand(), time).gesture).toBe("open_hand");
  expect(engine.update(hand(), 700).gesture).toBe("steady_palm");
  engine.update([], 750);
  expect(engine.update(hand(), 850).gesture).toBe("open_hand");
});
it("rejects invalid or tiny landmarks, and leaves circle activation unimplemented", () => {
  const engine = new GestureEngine();
  expect(engine.update([{ x: NaN, y: 0, z: 0 }], 0).confidence).toBe(0);
  expect(engine.update(scale(hand(), 0.01), 10).gesture).toBe("none");
  for (let t = 0; t < 360; t += 15) {
    const p = hand().map((p) => ({
      ...p,
      x: p.x + 0.05 * Math.sin(t),
      y: p.y + 0.05 * Math.cos(t),
    }));
    expect(engine.update(p, t * 5).gesture).not.toBe("circle");
  }
});

it("rejects one-frame pinch noise and tolerates short release noise", () => {
  const e = new GestureEngine();
  e.update(hand(), 0);
  expect(e.update(pinched(), 30).pinched).toBe(false);
  expect(e.update(hand(), 60).pinched).toBe(false);
  e.update(pinched(), 100);
  expect(e.update(pinched(), 220).gesture).toBe("pinch");
  expect(e.update(hand(), 250).pinched).toBe(true);
  expect(e.update(pinched(), 280).pinched).toBe(true);
});
it("smooths fingertip jitter and reaches viewport edges within the camera's central area", () => {
  const e = new GestureEngine();
  const start = e.update(hand(), 0);
  const noise = hand().map((p) => ({ ...p, x: p.x + 0.01 }));
  const next = e.update(noise, 33);
  expect(Math.abs(next.cursor.x - start.cursor.x)).toBeLessThan(0.0125);
  expect(next.cursor.x).toBeGreaterThan(next.palm.x);
  const edge = hand().map((p) => ({ ...p, x: p.x - 0.5 }));
  for (let t = 100; t < 800; t += 40) e.update(edge, t);
  expect(e.update(edge, 850).cursor.x).toBeGreaterThan(0.97);
});
it("removes the cursor and releases immediately on tracking loss", () => {
  const e = new GestureEngine();
  e.update(pinched(), 0);
  e.update(pinched(), 120);
  expect(e.update([], 150)).toMatchObject({
    tracked: false,
    pinched: false,
    gesture: "release",
  });
  expect(e.update(pinched(), 180).pinched).toBe(false);
});
it("does not expand from a single noisy size jump", () => {
  const e = new GestureEngine();
  e.update(pinched(), 0);
  e.update(pinched(), 120);
  expect(e.update(scale(pinched(), 1.5), 180).gesture).not.toBe("pull");
  expect(e.update(pinched(), 220).gesture).not.toBe("pull");
});
