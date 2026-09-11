export type Quality = "high" | "balanced" | "low";
export const qualitySettings = {
  high: { particles: 18, trackingFps: 24 },
  balanced: { particles: 8, trackingFps: 20 },
  low: { particles: 0, trackingFps: 12 },
} as const;
export class FrameSampler {
  private intervals: number[] = [];
  private last = 0;
  add(now: number) {
    if (this.last) {
      const dt = now - this.last;
      if (dt > 0 && dt < 200) this.intervals.push(dt);
    }
    this.last = now;
  }
  result() {
    const a = this.intervals.slice().sort((a, b) => a - b);
    return {
      frames: a.length,
      fps: a.length
        ? Math.round(1000 / (a.reduce((x, y) => x + y, 0) / a.length))
        : null,
      p95: a.length
        ? Math.round(a[Math.floor((a.length - 1) * 0.95)] * 10) / 10
        : null,
    };
  }
}
export function adaptiveQuality(fps: number | null): Quality {
  return fps === null
    ? "balanced"
    : fps < 35
      ? "low"
      : fps < 52
        ? "balanced"
        : "high";
}
export function capabilities() {
  const canvas = document.createElement("canvas");
  let gl: WebGLRenderingContext | null = null;
  try {
    gl = canvas.getContext("webgl");
  } catch {}
  const webgl = !!gl;
  gl?.getExtension("WEBGL_lose_context")?.loseContext();
  return {
    css3d: CSS.supports("perspective", "1000px"),
    webgl,
    webgpu: "gpu" in navigator,
    dpr: devicePixelRatio || 1,
  };
}
