"use client";
import type { RefObject } from "react";
import { voiceLabels, type VoiceState } from "./voice-state";
import { AryPresence } from "../nexus/primitives";

export function VoicePresence({
  state,
  level,
  continuous = false,
}: {
  continuous?: boolean;
  state: VoiceState;
  level: RefObject<number>;
}) {
  return (
    <div style={{ padding: "8px 0 16px" }}>
      <AryPresence
        state={state}
        level={level}
        label={voiceLabels[state][0]}
        stage
      />
      <p style={{ margin: "4px 0 0", fontSize: 12 }}>
        {continuous && state === "listening"
          ? "A short pause sends this turn to Ary."
          : voiceLabels[state][1]}
      </p>
    </div>
  );
}
