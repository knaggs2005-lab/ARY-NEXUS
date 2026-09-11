/** Render actual presence WGSL across every semantic state; no network/model/data access. */
import { presenceShader } from "../src/components/presence/shader";
import { appearance } from "../src/components/presence/appearance";
import { presencePriority, type PresenceState } from "../src/domain/presence";
async function main() {
  const { init, effect, target, frame } = await import("vgpu/node");
  const gpu = await init();
  const errors: string[] = [];
  gpu.onError((e) => errors.push(String(e)));
  try {
    const output = target(gpu, {
      size: [320, 120],
      format: "rgba8unorm",
      clearColor: [0, 0, 0, 0],
    });
    const field = effect(gpu, presenceShader, {
      set: { globals: { shape: [0, 0.3, 0, 0], tint: [0.68, 0.74, 0.84, 1] } },
    });
    await field.compile(output);
    const samples = [];
    for (const state of Object.keys(presencePriority) as PresenceState[]) {
      const a = appearance(state);
      field.set({
        globals: {
          shape: [
            1,
            a.fold,
            state === "listening" ? 0.7 : 0,
            a.moving ? 0.7 : 0,
          ],
          tint: [0.68, 0.74, 0.84, 1],
        },
      });
      frame(gpu, (f) => f.pass(output, (p) => p.draw(field)));
      const pixels = await output.read();
      let lit = 0;
      for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 0) lit++;
      if (!lit) throw Error(`Empty presence: ${state}`);
      samples.push({ state, lit });
    }
    await gpu.settled();
    if (errors.length) throw Error(errors.join("\n"));
    console.log(
      JSON.stringify({ passed: true, adapter: gpu.adapter, samples }),
    );
  } finally {
    gpu.dispose();
  }
}
main().catch((e) => {
  console.error(String(e));
  process.exitCode = 1;
});
