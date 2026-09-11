import type { PresenceState } from "../../domain/presence";
/** Fixed semantic morphology. No random values or simulated progress. */
export function appearance(state: PresenceState) {
  const warmth =
    state === "error"
      ? 1
      : state === "approval"
        ? 0.65
        : state === "complete"
          ? -1
          : 0;
  const fold = {
    idle: 0.3,
    understanding: 0.5,
    thinking: 0.65,
    retrieving: 0.85,
    remembering: 0.7,
    acting: 1,
    delegating: 1.2,
    mission: 1.1,
    waiting: 0.2,
    approval: 0.15,
    complete: 0.4,
    error: 0.1,
    listening: 0.5,
    speaking: 0.6,
  }[state];
  const moving = [
    "understanding",
    "thinking",
    "retrieving",
    "remembering",
    "acting",
    "delegating",
    "mission",
    "listening",
    "speaking",
  ].includes(state);
  return { warmth, fold, moving };
}
