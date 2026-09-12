import { describe, expect, it } from "vitest";
import { float32ToPcm16, resampleMono } from "../src/domain/audio-capture";
describe("audio capture conversion", () => {
  it("converts and clamps PCM16 safely", () => {
    expect([...float32ToPcm16(new Float32Array([-1, 0, 1, NaN, 2]))]).toEqual([
      -32768, 0, 32767, 0, 32767,
    ]);
  });
  it("resamples deterministically", () => {
    expect(resampleMono(new Float32Array([0, 1]), 24000, 12000)).toHaveLength(
      1,
    );
  });
  it("returns independent buffer at same rate", () => {
    const x = new Float32Array([1]);
    expect(resampleMono(x, 24000, 24000)).not.toBe(x);
  });
});
