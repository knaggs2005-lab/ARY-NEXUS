import { init, surface, effect, frame } from "vgpu";
import type { PresenceState } from "../../domain/presence";
import { appearance } from "./appearance";
import { presenceShader } from "./shader";
export async function createPresenceRenderer(
  canvas: HTMLCanvasElement,
  read: () => { state: PresenceState; energy: number },
  signal: AbortSignal,
  failed: () => void,
) {
  const gpu = await init({
    powerPreference: "low-power",
    label: "Ary presence",
  });
  if (signal.aborted) {
    gpu.dispose();
    return;
  }
  let stopped = false,
    visible = false,
    raf = 0,
    last = 0,
    slow = 0,
    settleUntil = 0,
    fold = appearance(read().state).fold;
  let observer: IntersectionObserver | undefined;
  let offError = () => {};
  const dispose = () => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(raf);
    observer?.disconnect();
    offError();
    document.removeEventListener("visibilitychange", wake);
    signal.removeEventListener("abort", dispose);
    canvas.style.opacity = "0";
    gpu.dispose();
  };
  const fail = () => {
    if (!stopped) {
      dispose();
      failed();
    }
  };
  function wake() {
    if (!stopped && visible && !document.hidden && !raf)
      raf = requestAnimationFrame(tick);
  }
  let draw = (_now: number) => {};
  function tick(now: number) {
    raf = 0;
    if (stopped || !visible || document.hidden) return;
    const moving = appearance(read().state).moving;
    if (!last || now - last >= 1000 / 24) {
      // Sustained missed frames downgrade to the static object, never affect interaction.
      if (last && moving && now - last > 160) slow++;
      else slow = Math.max(0, slow - 1);
      if (slow >= 8) {
        fail();
        return;
      }
      try {
        draw(now);
        last = now;
      } catch {
        fail();
        return;
      }
    }
    if (moving || now < settleUntil) wake();
  }
  try {
    signal.addEventListener("abort", dispose, { once: true });
    offError = gpu.onError(fail);
    void gpu.gpu.lost.then(fail);
    const output = surface(gpu, canvas, {
      autoResize: false,
      alphaMode: "premultiplied",
      clearColor: [0, 0, 0, 0],
      size: [640, 240],
    });
    const field = effect(gpu, presenceShader, {
      set: { globals: { shape: [0, 0.3, 0, 0], tint: [0.68, 0.74, 0.84, 1] } },
    });
    await field.compile({ colors: [output.format] });
    if (stopped || signal.aborted) {
      dispose();
      return;
    }
    draw = (now) => {
      const value = read(),
        style = appearance(value.state);
      fold +=
        (style.fold - fold) *
        (1 - Math.exp(-Math.min(100, last ? now - last : 42) / 90));
      const tint =
        style.warmth > 0.8
          ? [0.9, 0.6, 0.62, 1]
          : style.warmth > 0
            ? [0.9, 0.73, 0.48, 1]
            : style.warmth < 0
              ? [0.61, 0.77, 0.69, 1]
              : [0.68, 0.74, 0.84, 1];
      field.set({
        globals: {
          shape: [
            style.moving ? now / 1000 : 0,
            fold,
            Math.max(0, Math.min(1, value.energy || 0)),
            style.moving ? 0.7 : 0,
          ],
          tint,
        },
      });
      frame(gpu, (f) => f.pass(output, (p) => p.draw(field)));
      canvas.style.opacity = "1";
    };
    observer = new IntersectionObserver((entries) => {
      visible = entries[0]?.isIntersecting ?? false;
      last = 0;
      slow = 0;
      wake();
    });
    observer.observe(canvas);
    document.addEventListener("visibilitychange", wake);
    if (stopped) return;
    return {
      dispose,
      update() {
        settleUntil = performance.now() + 360;
        last = 0;
        wake();
      },
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
