/** One full-screen triangle, bounded eight-line field. No textures, particles, noise or bloom passes. */
export const presenceShader = /* wgsl */ `
struct Globals { shape: vec4f, tint: vec4f }
@group(0) @binding(0) var<uniform> globals: Globals;
@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let p = (uv - 0.5) * vec2f(2.5, 1.8);
  let time = globals.shape.x;
  let fold = globals.shape.y;
  let energy = globals.shape.z;
  let movement = globals.shape.w;
  var light = 0.0;
  for (var i = 0; i < 8; i++) {
    let n = f32(i) / 7.0;
    let width = 0.65 + n * 0.28;
    let envelope = max(0.0, 1.0 - p.x * p.x / (width * width));
    let y = sin(p.x * (4.0 + fold) + n * 1.2) * (0.13 + fold * 0.09 + energy * 0.12) * envelope;
    let offset = (n - 0.5) * 0.4 * envelope;
    let d = abs(p.y - y - offset);
    let travel = 0.78 + 0.22 * cos(p.x * 4.0 - time * movement + n);
    light += (exp(-d * 210.0) * 0.32 + exp(-d * 28.0) * 0.045) * envelope * travel;
  }
  let alpha = min(0.92, light);
  return vec4f(globals.tint.rgb * alpha, alpha);
}`;
