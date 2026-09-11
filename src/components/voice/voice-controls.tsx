"use client";
import { VoicePresence } from "./voice-presence";
import { voiceState } from "./voice-state";
import type { useAryVoice } from "./use-ary-voice";
import styles from "./voice.module.css";
export function VoiceControls({
  voice,
  busy,
  generating,
  onCancel,
  preview,
  onDiscard,
  lastAnswer,
  showPresence = true,
}: {
  voice: ReturnType<typeof useAryVoice>;
  busy: boolean;
  generating: boolean;
  onCancel: () => void;
  preview: boolean;
  onDiscard: () => void;
  lastAnswer: string;
  showPresence?: boolean;
}) {
  const status = voiceState({
    capture: voice.capture,
    playback: voice.playback,
    generating,
    busy,
    preview,
    interrupted: voice.interrupted,
    error: voice.error,
  });
  return (
    <section className={styles.voice} aria-label="Ary Voice">
      {showPresence && <VoicePresence state={status} level={voice.level} />}
      <div className={styles.row}>
        <button
          type="button"
          disabled={!voice.supported}
          onClick={() =>
            voice.sessionActive
              ? voice.interruptAll()
              : void voice.startConversation()
          }
        >
          {voice.sessionActive ? "End conversation" : "Start conversation"}
        </button>
        <button
          type="button"
          className={voice.capture === "listening" ? styles.active : ""}
          disabled={
            !voice.supported ||
            voice.sessionActive ||
            ["requesting", "transcribing"].includes(voice.capture)
          }
          onClick={() =>
            voice.capture === "listening"
              ? voice.stopListening()
              : void voice.startListening()
          }
          aria-label={
            voice.capture === "listening"
              ? "Finish recording"
              : "Use microphone"
          }
        >
          <svg
            width="16"
            height="18"
            viewBox="0 0 16 20"
            fill="none"
            aria-hidden="true"
          >
            <rect
              x="5"
              y="1"
              width="6"
              height="11"
              rx="3"
              stroke="currentColor"
            />
            <path d="M2 9a6 6 0 0 0 12 0M8 15v4M5 19h6" stroke="currentColor" />
          </svg>
          {voice.capture === "listening" ? "Finish recording" : "Microphone"}
        </button>
        {voice.capture !== "idle" && (
          <button type="button" onClick={voice.cancelCapture}>
            Cancel recording
          </button>
        )}
        <button
          type="button"
          onClick={voice.stopSpeaking}
          disabled={voice.playback === "idle" && !generating}
        >
          Stop speaking
        </button>
        <button
          type="button"
          aria-pressed={voice.muted}
          onClick={voice.toggleMute}
        >
          {voice.muted ? "Unmute" : "Mute"}
        </button>
        {(generating ||
          voice.capture !== "idle" ||
          voice.playback !== "idle") && (
          <button type="button" onClick={voice.interruptAll}>
            Interrupt Ary
          </button>
        )}
        {generating && (
          <button type="button" onClick={onCancel}>
            Cancel response
          </button>
        )}
        {lastAnswer &&
          voice.capture === "idle" &&
          voice.playback === "idle" &&
          !generating && (
            <button type="button" onClick={() => voice.readAloud(lastAnswer)}>
              Read aloud
            </button>
          )}
      </div>
      {voice.capture === "transcribing" && voice.partialTranscript && (
        <p
          className={styles.preview}
          aria-label="Draft transcription"
          aria-live="off"
        >
          {voice.partialTranscript}
          <small>Finishing transcription…</small>
        </p>
      )}
      {preview && (
        <p className={styles.preview}>
          Transcript preview is in the message box. Edit it, then Send.{" "}
          <button type="button" onClick={onDiscard}>
            Discard
          </button>
        </p>
      )}
      <small>
        AI-generated voice · Microphone records one message; Start conversation
        enables continuous listening and automatic turn submission. End
        conversation releases the microphone.
      </small>
      {voice.providers && (
        <small className={styles.providers}>{voice.providers}</small>
      )}
      {process.env.NODE_ENV !== "production" && voice.transcriptionTiming && (
        <small className={styles.providers}>
          Transcription: first text{" "}
          {voice.transcriptionTiming.first_text_ms === null
            ? "—"
            : `${(voice.transcriptionTiming.first_text_ms / 1000).toFixed(1)}s`}
          {" · "}ready {(voice.transcriptionTiming.total_ms / 1000).toFixed(1)}s
        </small>
      )}
      {!voice.supported && (
        <p>Recording is unavailable in this browser. You can still type.</p>
      )}
      {voice.error && (
        <p role="alert" className={styles.error}>
          {voice.error}
        </p>
      )}
    </section>
  );
}
