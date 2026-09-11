export type CaptureState = "idle" | "requesting" | "listening" | "transcribing";
export type PlaybackState = "idle" | "buffering" | "speaking";
export type VoiceState =
  | "ready"
  | "requesting"
  | "listening"
  | "transcribing"
  | "review"
  | "thinking"
  | "buffering"
  | "speaking"
  | "saving"
  | "interrupted"
  | "error";
/** One presentation state, derived from existing capture/Brain/playback lifecycles. */
export function voiceState(input: {
  capture: CaptureState;
  playback: PlaybackState;
  generating: boolean;
  busy: boolean;
  preview: boolean;
  interrupted: boolean;
  error: string;
}): VoiceState {
  if (input.capture !== "idle") return input.capture;
  if (input.error) return "error";
  if (input.interrupted) return "interrupted";
  if (input.playback !== "idle") return input.playback;
  if (input.preview) return "review";
  if (input.generating) return "thinking";
  if (input.busy) return "saving";
  return "ready";
}
export const voiceLabels: Record<VoiceState, [string, string]> = {
  ready: ["Ary is here", "Speak when you’re ready."],
  requesting: ["Opening your microphone", "Waiting for microphone permission."],
  listening: ["Listening", "Finish recording when you’re ready to review."],
  transcribing: [
    "Finding your words",
    "Turning your recording into a transcript.",
  ],
  review: ["Your words, ready", "Review or edit the transcript, then Send."],
  thinking: [
    "Awaiting Ary",
    "The presence reports confirmed processing stages as they arrive.",
  ],
  buffering: [
    "Preparing Ary’s voice",
    "Text appears as it arrives; speech follows in short phrases.",
  ],
  speaking: ["Speaking", "You can interrupt at any time."],
  saving: [
    "Waiting for confirmation",
    "The current operation has not finished reporting its result.",
  ],
  interrupted: [
    "Paused for you",
    "Audio stopped. Saved conversation context is retained.",
  ],
  error: ["Voice needs attention", "Your text conversation remains available."],
};
