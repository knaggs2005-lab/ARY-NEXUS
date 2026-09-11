import { modules } from "./modules";
export type CardState =
  | "idle"
  | "hover"
  | "selected"
  | "focused"
  | "expanded"
  | "dragging"
  | "warning"
  | "disabled";
export interface SpatialState {
  revision: number;
  index: number;
  phase: "orbit" | "focused" | "expanded";
  drag: { x: number; y: number } | null;
  frozen: boolean;
}
export const initialSpatialState: SpatialState = {
  revision: 0,
  index: 0,
  phase: "orbit",
  drag: null,
  frozen: false,
};
export type SpatialEvent =
  | { type: "rotate"; direction: number }
  | { type: "select"; index: number }
  | { type: "focus" }
  | { type: "expand" }
  | { type: "return" }
  | { type: "drag"; x: number; y: number }
  | { type: "release" }
  | { type: "freeze"; value: boolean };
export function spatialReducer(
  state: SpatialState,
  event: SpatialEvent,
): SpatialState {
  switch (event.type) {
    case "rotate":
      return {
        ...state,
        revision: state.revision + 1,
        index:
          (state.index + (event.direction % modules.length) + modules.length) %
          modules.length,
        phase: "orbit",
        drag: null,
      };
    case "select":
      return {
        ...state,
        revision: state.revision + 1,
        index: Math.max(0, Math.min(modules.length - 1, event.index)),
        phase: "focused",
        drag: null,
      };
    case "focus":
      return {
        ...state,
        revision: state.revision + 1,
        phase: "focused",
        drag: null,
      };
    case "expand":
      if (state.phase === "expanded") return state;
      return modules[state.index].tab
        ? {
            ...state,
            revision: state.revision + 1,
            phase: "expanded",
            drag: null,
          }
        : state;
    case "return":
      return {
        ...state,
        revision: state.revision + 1,
        phase: "orbit",
        drag: null,
      };
    case "drag":
      return state.phase === "expanded"
        ? state
        : {
            ...state,
            drag: {
              x: Math.max(-150, Math.min(150, event.x)),
              y: Math.max(-100, Math.min(100, event.y)),
            },
          };
    case "release":
      return { ...state, drag: null };
    case "freeze":
      return { ...state, frozen: event.value };
  }
}
export function cardState(
  state: SpatialState,
  index: number,
  hover: boolean,
  warning: boolean,
): CardState {
  if (!modules[index].tab) return "disabled";
  if (index === state.index) {
    if (state.drag) return "dragging";
    if (state.phase !== "orbit") return state.phase;
    return "selected";
  }
  return hover ? "hover" : warning ? "warning" : "idle";
}
