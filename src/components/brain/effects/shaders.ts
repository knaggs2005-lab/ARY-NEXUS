// Plain WGSL strings are supported by vgpu; no shader-loader or bundler change needed.
const globals = /* wgsl */ `
struct Globals { viewport: vec4f, camera: vec4f }
@group(0) @binding(0) var<uniform> globals: Globals;
`;
export const fieldShader =
  globals +
  /* wgsl */ `
@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let aspect = globals.viewport.x / max(1.0, globals.viewport.y);
  let p = (uv - 0.5) * vec2f(aspect, 1.0) + globals.camera.xy / 16000.0;
  let t = globals.viewport.z * 0.055;
  let a = sin(p.x * 4.0 + sin(p.y * 3.0 + t)) * 0.2;
  let b = cos(p.x * 2.4 - t * 0.7) * 0.17;
  let field = exp(-abs(p.y - a - b) * 8.0);
  let filament = exp(-abs(p.y - a - b) * 130.0);
  let vignette = 1.0 - smoothstep(0.15, 0.85, length(p));
  let alpha = min(0.075, (field * 0.035 + filament * 0.022) * vignette);
  return vec4f(vec3f(0.43, 0.57, 0.49) * alpha, alpha);
}
`;
export const spriteShader =
  globals +
  /* wgsl */ `
struct Item { start: vec4f, end: vec4f, color: vec4f }
@group(0) @binding(1) var<storage, read> items: array<Item>;
struct Out {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
  @location(1) color: vec4f,
}
@vertex fn vs_main(@builtin(vertex_index) v: u32, @builtin(instance_index) i: u32) -> Out {
  let corners = array<vec2f, 6>(vec2f(-1,-1), vec2f(1,-1), vec2f(-1,1), vec2f(-1,1), vec2f(1,-1), vec2f(1,1));
  let item = items[i];
  let time = globals.viewport.z;
  let motion = globals.viewport.w;
  var center = item.start.xy;
  var size = min(120.0, item.start.z * globals.camera.z);
  var alpha = item.end.z;
  if (item.start.w == 1.0) {
    center = mix(center, item.end.xy, fract(time * 0.13 + item.color.w));
    size = 5.0;
    alpha *= motion;
  }
  center = center * globals.camera.z + globals.camera.xy;
  if (item.start.w == 2.0) {
    let age = max(0.0, time - item.end.w);
    let angle = item.color.w * 6.2831853;
    center += vec2f(cos(angle), sin(angle)) * (8.0 + age * 22.0);
    size = 2.5;
    alpha *= (1.0 - smoothstep(0.2, 2.4, age)) * motion;
  }
  let pixel = center + corners[v] * size;
  var out: Out;
  out.position = vec4f(pixel / globals.viewport.xy * vec2f(2.0, -2.0) + vec2f(-1.0, 1.0), 0.0, 1.0);
  out.uv = corners[v];
  out.color = vec4f(item.color.xyz, alpha);
  return out;
}
@fragment fn fs_main(input: Out) -> @location(0) vec4f {
  let d = dot(input.uv, input.uv);
  let a = input.color.a * exp(-d * 4.5) * (1.0 - smoothstep(0.5, 1.0, d));
  return vec4f(input.color.rgb * a, a);
}
`;
