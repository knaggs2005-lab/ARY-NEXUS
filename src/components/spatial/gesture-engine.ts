export interface Landmark {
  x: number;
  y: number;
  z: number;
}
export type Gesture =
  | "none"
  | "pinch"
  | "release"
  | "swipe_left"
  | "swipe_right"
  | "pull"
  | "push"
  | "steady_palm"
  | "open_hand"
  | "closed_hand";
export interface GestureFrame {
  gesture: Gesture;
  confidence: number;
  palm: { x: number; y: number };
  tips: Landmark[];
  pinched: boolean;
  cursor: { x: number; y: number };
  tracked: boolean;
  pinchProgress: number;
}
const distance = (a: Landmark, b: Landmark) => Math.hypot(a.x - b.x, a.y - b.y);
/** Navigation-only heuristics on MediaPipe landmarks. Circle is deliberately reserved. */
export class GestureEngine {
  private pinched = false;
  private span = 0;
  private cooldown = 0;
  private history: Array<{ x: number; y: number; t: number }> = [];
  private held = false;
  private candidate: { pinch: boolean; since: number } | null = null;
  private depth: { gesture: "pull" | "push"; since: number } | null = null;
  private cursor: { x: number; y: number } | null = null;
  private lastTime: number | null = null;
  reset() {
    this.pinched = false;
    this.candidate = null;
    this.depth = null;
    this.cursor = null;
    this.lastTime = null;
    this.span = 0;
    this.history = [];
    this.held = false;
    this.cooldown = 0;
  }
  update(points: Landmark[], now: number): GestureFrame {
    const empty: GestureFrame = {
      gesture: "none",
      confidence: 0,
      palm: { x: 0.5, y: 0.5 },
      tips: [],
      pinched: false,
      cursor: { x: 0.5, y: 0.5 },
      tracked: false,
      pinchProgress: 0,
    };
    if (
      points.length !== 21 ||
      points.some((p) => ![p.x, p.y, p.z].every(Number.isFinite))
    ) {
      const release = this.pinched;
      this.reset();
      return { ...empty, gesture: release ? "release" : "none" };
    }
    const palm = {
      x: 1 - (points[0].x + points[5].x + points[17].x) / 3,
      y: (points[0].y + points[5].y + points[17].y) / 3,
    };
    const size = distance(points[5], points[17]);
    if (size < 0.035) {
      const release = this.pinched;
      this.reset();
      return { ...empty, gesture: release ? "release" : "none" };
    }
    const ratio = distance(points[4], points[8]) / size;
    const desiredPinch = ratio < (this.pinched ? 0.58 : 0.34);
    let pinch = this.pinched;
    if (desiredPinch === this.pinched) this.candidate = null;
    else {
      if (this.candidate?.pinch !== desiredPinch)
        this.candidate = { pinch: desiredPinch, since: now };
      if (now - this.candidate.since >= (desiredPinch ? 100 : 65)) {
        pinch = desiredPinch;
        this.candidate = null;
      }
    }
    // Index fingertip aims; the thumb/index midpoint holds position during a pinch.
    // Map the central camera area to the full viewport so screen edges remain reachable.
    const aim = pinch
      ? {
          x: (points[4].x + points[8].x) / 2,
          y: (points[4].y + points[8].y) / 2,
        }
      : points[8];
    const clamp = (v: number) => Math.max(0.015, Math.min(0.985, v));
    const target = {
      x: clamp((1 - aim.x - 0.1) / 0.8),
      y: clamp((aim.y - 0.08) / 0.78),
    };
    const dt =
      this.lastTime === null
        ? 100
        : Math.max(1, Math.min(150, now - this.lastTime));
    const speed = this.cursor
      ? Math.hypot(target.x - this.cursor.x, target.y - this.cursor.y) / dt
      : 0;
    const alpha = 1 - Math.exp(-dt / (speed > 0.002 ? 35 : 85));
    this.cursor = this.cursor
      ? {
          x: this.cursor.x + (target.x - this.cursor.x) * alpha,
          y: this.cursor.y + (target.y - this.cursor.y) * alpha,
        }
      : target;
    this.lastTime = now;
    const extended = [8, 12, 16, 20].filter(
      (i) =>
        distance(points[i], points[0]) >
        distance(points[i - 2], points[0]) * 1.18,
    ).length;
    let gesture: Gesture =
      extended === 4 ? "open_hand" : extended === 0 ? "closed_hand" : "none";
    if (pinch && !this.pinched) {
      gesture = "pinch";
      this.span = size;
      this.depth = null;
      this.history = [];
    } else if (!pinch && this.pinched) {
      gesture = "release";
      this.span = 0;
      this.depth = null;
      this.history = [];
    } else if (pinch && now > this.cooldown && this.span) {
      const depthGesture =
        size / this.span > 1.38
          ? "pull"
          : size / this.span < 0.7
            ? "push"
            : null;
      if (!depthGesture) this.depth = null;
      else {
        if (this.depth?.gesture !== depthGesture)
          this.depth = { gesture: depthGesture, since: now };
        if (now - this.depth.since >= 120) {
          gesture = depthGesture;
          this.span = size;
          this.cooldown = now + 900;
          this.depth = null;
        }
      }
    } else this.depth = null;
    this.pinched = pinch;
    this.history.push({ ...palm, t: now });
    this.history = this.history.filter((h) => now - h.t < 800);
    if (!pinch && extended === 4) {
      const recent = this.history.filter((h) => now - h.t <= 400),
        first = recent[0];
      if (
        first &&
        now - first.t >= 100 &&
        now > this.cooldown &&
        Math.abs(palm.x - first.x) > 0.2 &&
        Math.abs(palm.y - first.y) < 0.16
      ) {
        gesture = palm.x < first.x ? "swipe_left" : "swipe_right";
        this.cooldown = now + 700;
        this.history = [];
      } else if (
        this.history.length > 3 &&
        now - this.history[0].t > 650 &&
        this.history.every(
          (p) => Math.hypot(p.x - palm.x, p.y - palm.y) < 0.025,
        )
      ) {
        gesture = "steady_palm";
        this.held = true;
      }
    } else this.held = false;
    return {
      gesture,
      confidence:
        gesture === "none"
          ? 0
          : gesture === "pinch"
            ? Math.min(1, 1 - ratio)
            : 0.8,
      palm,
      tips: [4, 8, 12, 16, 20].map((i) => points[i]),
      pinched: pinch,
      cursor: this.cursor,
      tracked: true,
      pinchProgress: pinch
        ? 1
        : this.candidate?.pinch
          ? Math.min(1, (now - this.candidate.since) / 100)
          : 0,
    };
  }
}
