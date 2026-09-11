/** Optional real GPU smoke test; never contacts Ary's database or AI providers. */

import {
  fieldShader,
  spriteShader,
} from "../src/components/brain/effects/shaders";
async function main() {
  const { init, effect, draw, target, storage, frame } =
    await import("vgpu/node");
  const gpu = await init();
  const errors: string[] = [];
  gpu.onError((e) => errors.push(String(e)));
  try {
    const output = target(gpu, {
      size: [256, 256],
      format: "rgba8unorm",
      clearColor: [0, 0, 0, 0],
    });
    const globals = { viewport: [256, 256, 1, 1], camera: [0, 0, 1, 0] };
    const field = effect(gpu, fieldShader, { set: { globals } });
    const buffer = storage(gpu, 3 * 48, "read");
    buffer.write(
      new Float32Array([
        128, 128, 70, 0, 0, 0, 0.18, 0, 0.55, 0.7, 0.62, 0, 30, 128, 5, 1, 220,
        128, 0.3, 0, 0.55, 0.7, 0.62, 0, 128, 128, 2, 2, 0, 0, 0.3, 0.5, 0.55,
        0.7, 0.62, 0.5,
      ]),
    );
    const sprites = draw(gpu, {
      shader: spriteShader,
      vertices: 6,
      blend: "premultiplied",
      set: { globals, items: buffer },
    });
    await Promise.all([field.compile(output), sprites.compile(output)]);
    frame(gpu, (f) =>
      f.pass(output, (p) => {
        p.draw(field);
        p.draw(sprites, { instances: 3 });
      }),
    );
    const pixels = await output.read();
    await gpu.settled();
    if (errors.length) throw new Error(errors.join("\n"));
    const center = (128 * 256 + 128) * 4;
    if (pixels[center + 3] <= pixels[3])
      throw new Error("Halo did not render at its expected center");
    console.log(
      JSON.stringify({
        success: true,
        adapter: gpu.adapter,
        shaders: 2,
        instances: 3,
        centerAlpha: pixels[center + 3],
      }),
    );
  } finally {
    gpu.dispose();
  }
}
main().catch((e) => {
  console.error(String(e));
  process.exitCode = 1;
});
