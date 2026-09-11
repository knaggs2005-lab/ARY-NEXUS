import { draw, effect, frame, init, storage, surface } from "vgpu";
import type { EffectsBridge } from "./bridge";
import { fieldShader, spriteShader } from "./shaders";
import {
  createFrameHealth,
  MAX_SPRITES,
  packScene,
  STRIDE,
  type Burst,
  type Quality,
} from "./scene";
import {
  subscribeKnowledgeEvents,
  takeKnowledgeEvents,
} from "./knowledge-events";

export type EffectsStatus =
  "loading" | "active" | "low" | "unavailable" | "off" | "reduced-motion";
export interface EffectsRenderer {
  dispose(): void;
}
export async function createVgpuRenderer(
  canvas: HTMLCanvasElement,
  bridge: EffectsBridge,
  options: {
    signal: AbortSignal;
    knowledgeEvents: boolean;
    onStatus(status: EffectsStatus): void;
  },
): Promise<EffectsRenderer> {
  const gpu = await init({
    powerPreference: "low-power",
    label: "Ary Brain ambience",
  });
  if (options.signal.aborted) {
    gpu.dispose();
    return { dispose() {} };
  }
  let disposed = false,
    visible = false,
    raf = 0;
  let unsubscribe = () => {},
    unsubscribeEvents = () => {},
    unsubscribeError = () => {};
  let observer: IntersectionObserver | undefined;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(raf);
    observer?.disconnect();
    unsubscribe();
    unsubscribeEvents();
    unsubscribeError();
    document.removeEventListener("visibilitychange", visibility);
    options.signal.removeEventListener("abort", dispose);
    canvas.style.opacity = "0";
    gpu.dispose();
  };
  const fail = () => {
    if (disposed) return;
    dispose();
    options.onStatus("unavailable");
  };
  let quality: Quality = "standard";
  const health = createFrameHealth();
  let lastRender = -Infinity,
    lastRevision = -1,
    count = 0;
  let bursts: Burst[] = [],
    eventsDirty = true;
  const output = (() => {
    try {
      return surface(gpu, canvas, {
        autoResize: false,
        alphaMode: "premultiplied",
        clearColor: [0, 0, 0, 0],
        size: [1, 1],
      });
    } catch (error) {
      dispose();
      throw error;
    }
  })();
  const canDraw = () => !disposed && visible && !document.hidden;
  let render: (now: number, force?: boolean) => void = () => {};
  const wake = () => {
    if (canDraw() && !raf) raf = requestAnimationFrame(tick);
  };
  function tick(now: number) {
    raf = 0;
    if (!canDraw()) return;
    if (quality === "standard" && health.sample(now)) {
      quality = "low";
      lastRevision = -1;
      options.onStatus("low");
    }
    render(now);
    wake();
  }
  function visibility() {
    cancelAnimationFrame(raf);
    raf = 0;
    health.reset();
    if (canDraw()) {
      render(performance.now(), true);
      wake();
    }
  }
  try {
    if (options.signal.aborted) {
      dispose();
      return { dispose };
    }
    options.signal.addEventListener("abort", dispose, { once: true });
    unsubscribeError = gpu.onError(fail);
    void gpu.gpu.lost.then(fail);
    const buffer = storage(gpu, MAX_SPRITES * STRIDE * 4, "read");
    const globals = { viewport: [1, 1, 0, 1], camera: [0, 0, 1, 0] };
    const field = effect(gpu, fieldShader, { set: { globals } });
    const sprites = draw(gpu, {
      shader: spriteShader,
      vertices: 6,
      blend: "premultiplied",
      set: { globals, items: buffer },
    });
    // Compile against a signature: a Surface texture only exists inside a frame.
    await Promise.all([
      field.compile({ colors: [output.format] }),
      sprites.compile({ colors: [output.format] }),
    ]);
    if (disposed) return { dispose };
    render = (now, force = false) => {
      if (!canDraw() || (!force && now - lastRender < 1000 / 30)) return;
      const { snapshot: s, revision } = bridge.read();
      if (!s || s.width < 10 || s.height < 10) return;
      try {
        const seconds = now / 1000;
        const active = bursts.filter((b) => seconds - b.started < 2.4);
        if (active.length !== bursts.length) {
          bursts = active;
          eventsDirty = true;
        }
        const scale = Math.min(
          window.devicePixelRatio || 1,
          quality === "low" ? 0.75 : 1.25,
          Math.sqrt(2_000_000 / (s.width * s.height)),
        );
        const w = Math.max(1, Math.round(s.width * scale)),
          h = Math.max(1, Math.round(s.height * scale));
        if (output.size[0] !== w || output.size[1] !== h) output.resize([w, h]);
        if (revision !== lastRevision || eventsDirty) {
          const packed = packScene(s, bursts, seconds, quality);
          count = packed.count;
          buffer.write(packed.data);
          lastRevision = revision;
          eventsDirty = false;
        }
        const values = {
          viewport: [s.width, s.height, seconds, 1],
          camera: [s.camera.x, s.camera.y, s.camera.scale, 0],
        };
        field.set({ globals: values });
        sprites.set({ globals: values });
        frame(gpu, (f) =>
          f.pass(output, (p) => {
            p.draw(field);
            if (count) p.draw(sprites, { instances: count });
          }),
        );
        lastRender = now;
        canvas.style.opacity = "1";
        canvas.dataset.instances = String(count);
        canvas.dataset.quality = quality;
      } catch {
        fail();
      }
    };
    unsubscribe = bridge.subscribe(() => {
      render(performance.now(), true);
      wake();
    });
    if (options.knowledgeEvents) {
      const receive = () => {
        const incoming = takeKnowledgeEvents();
        bursts = [
          ...bursts,
          ...incoming.map((event) => ({
            event,
            started: performance.now() / 1000,
          })),
        ].slice(-4);
        eventsDirty = true;
        render(performance.now(), true);
        wake();
      };
      unsubscribeEvents = subscribeKnowledgeEvents(receive);
      receive();
    }
    observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      visibility();
    });
    observer.observe(canvas);
    document.addEventListener("visibilitychange", visibility);
    options.onStatus("active");
    return { dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}
