import { expect, it } from "vitest";
import {
  initialSpatialState,
  spatialReducer,
  cardState,
} from "../src/components/spatial/interaction-state";
import { modules } from "../src/components/spatial/modules";
import {
  motion,
  stepSpring,
  settled,
  nearestOrbit,
} from "../src/components/spatial/motion";
import { orbitPose, cameraPose } from "../src/components/spatial/camera";
import {
  FrameSampler,
  adaptiveQuality,
  qualitySettings,
} from "../src/components/spatial/performance";
it("wraps the orbit and never navigates into unavailable integrations", () => {
  expect(
    spatialReducer(initialSpatialState, { type: "rotate", direction: -1 })
      .index,
  ).toBe(9);
  expect(
    spatialReducer(
      { ...initialSpatialState, index: 9 },
      { type: "rotate", direction: 1 },
    ).index,
  ).toBe(0);
  for (const [index, m] of modules.entries()) {
    const selected = spatialReducer(initialSpatialState, {
      type: "select",
      index,
    });
    expect(spatialReducer(selected, { type: "expand" }).phase).toBe(
      m.tab ? "expanded" : "focused",
    );
  }
});
it("uses a new revision for focus interruption so old completion cannot reopen a module", () => {
  let state = spatialReducer(initialSpatialState, { type: "select", index: 2 });
  state = spatialReducer(state, { type: "expand" });
  const old = state.revision;
  state = spatialReducer(state, { type: "return" });
  expect(state.phase).toBe("orbit");
  expect(state.revision).toBeGreaterThan(old);
  state = spatialReducer(state, { type: "select", index: 3 });
  expect(state.index).toBe(3);
});
it("bounds dragging, restores its slot and prevents dragging an expanded application", () => {
  let state = spatialReducer(initialSpatialState, {
    type: "drag",
    x: 900,
    y: -900,
  });
  expect(state.drag).toEqual({ x: 150, y: -100 });
  state = spatialReducer(state, { type: "release" });
  expect(state.drag).toBeNull();
  state = spatialReducer(state, { type: "expand" });
  expect(spatialReducer(state, { type: "drag", x: 20, y: 20 })).toBe(state);
  expect(spatialReducer(state, { type: "expand" })).toBe(state);
});
it.each(Object.keys(motion) as (keyof typeof motion)[])(
  "%s springs settle exactly with no perpetual drift",
  (curve) => {
    let spring = { value: 0, velocity: 0 };
    for (let i = 0; i < 600; i++)
      spring = stepSpring(spring, 1, 1 / 60, motion[curve]);
    expect(settled(spring, 1)).toBe(true);
    for (let i = 0; i < 100; i++)
      spring = stepSpring(spring, 1, 1 / 60, motion[curve]);
    expect(spring).toEqual({ value: 1, velocity: 0 });
  },
);
it("retargets an in-flight focus spring without a jump and returns safely", () => {
  let spring = { value: 0, velocity: 0 };
  for (let i = 0; i < 12; i++) spring = stepSpring(spring, 1, 1 / 60);
  const before = spring.value;
  spring = stepSpring(spring, 0, 1 / 60, motion.returning);
  expect(Math.abs(spring.value - before)).toBeLessThan(0.1);
  for (let i = 0; i < 600; i++)
    spring = stepSpring(spring, 0, 1 / 60, motion.returning);
  expect(spring).toEqual({ value: 0, velocity: 0 });
});
it("keeps focus card visible, steps others back and takes the nearest orbit route", () => {
  expect(nearestOrbit(9, 0, 10)).toBe(10);
  expect(nearestOrbit(0, 9, 10)).toBe(-1);
  const idle = orbitPose(0, 0, 10, 0, 0, 1200),
    focused = orbitPose(0, 0, 10, 1, 0, 1200);
  expect(focused.z).toBeGreaterThan(idle.z);
  expect(focused.opacity).toBe(1);
  expect(orbitPose(5, 0, 10, 1, 0, 1200).opacity).toBe(0);
  expect(cameraPose(1).approach).toBeGreaterThan(cameraPose(0).approach);
});
it("represents every card state without conflating a warning with a disabled integration", () => {
  expect(cardState(initialSpatialState, 1, false, false)).toBe("idle");
  expect(cardState(initialSpatialState, 1, true, false)).toBe("hover");
  expect(cardState(initialSpatialState, 0, false, false)).toBe("selected");
  expect(
    cardState({ ...initialSpatialState, phase: "focused" }, 0, false, false),
  ).toBe("focused");
  expect(
    cardState({ ...initialSpatialState, phase: "expanded" }, 0, false, false),
  ).toBe("expanded");
  expect(
    cardState(
      { ...initialSpatialState, drag: { x: 1, y: 1 } },
      0,
      false,
      false,
    ),
  ).toBe("dragging");
  expect(cardState(initialSpatialState, 1, false, true)).toBe("warning");
  expect(cardState(initialSpatialState, 4, false, true)).toBe("warning");
  expect(cardState(initialSpatialState, 5, false, true)).toBe("warning");
});
it("measures frame intervals and reduces effects at low measured frame rate", () => {
  const sampler = new FrameSampler();
  for (let i = 1; i <= 121; i++) sampler.add((i * 1000) / 60);
  expect(sampler.result().fps).toBe(60);
  expect(adaptiveQuality(30)).toBe("low");
  expect(adaptiveQuality(45)).toBe("balanced");
  expect(adaptiveQuality(60)).toBe("high");
  expect(qualitySettings.low.particles).toBe(0);
  expect(qualitySettings.low.trackingFps).toBeLessThan(
    qualitySettings.high.trackingFps,
  );
});
