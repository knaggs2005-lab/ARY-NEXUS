"use client";
import type { useAryVoice } from "./use-ary-voice";
import { VoicePresence } from "./voice-presence";
import { voiceState } from "./voice-state";
import styles from "./voice.module.css";
export function AmbientConversation({
  voice,
  busy,
  generating,
  latestUser,
  latestAnswer,
  onConversation,
  onApprovals,
}: {
  voice: ReturnType<typeof useAryVoice>;
  busy: boolean;
  generating: boolean;
  latestUser: string;
  latestAnswer: string;
  onConversation(): void;
  onApprovals(): void;
}) {
  const state = voiceState({
    capture: voice.capture,
    playback: voice.playback,
    generating,
    busy,
    preview: false,
    interrupted: voice.interrupted,
    error: voice.error,
  });
  return (
    <section className={styles.ambient} aria-label="Ambient conversation">
      <span className={styles.eyebrow}>ONE ARY · ONE CONVERSATION</span>
      <VoicePresence
        state={state}
        level={voice.level}
        continuous={voice.sessionActive}
      />
      <p>
        {voice.sessionActive
          ? voice.sessionState === "paused"
            ? "Listening paused while you review an approval."
            : "Your microphone is active. Speak naturally; pause to send. You can speak over Ary to interrupt."
          : "Start a conversation. Ary keeps the same memories, missions and permissions."}
      </p>
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
          onClick={voice.interruptAll}
          disabled={!voice.sessionActive && voice.playback === "idle"}
        >
          Stop voice
        </button>
        <button
          type="button"
          aria-pressed={voice.muted}
          onClick={voice.toggleMute}
        >
          {voice.muted ? "Unmute Ary" : "Mute Ary"}
        </button>
        <button type="button" onClick={onApprovals}>
          Review approvals
        </button>
      </div>
      <label className={styles.background}>
        <input
          type="checkbox"
          checked={voice.background}
          onChange={(e) => voice.setBackgroundListening(e.target.checked)}
        />{" "}
        Keep listening while the app is hidden
      </label>
      <small>
        Off until you start. Turns up to 20 seconds. Ends after 5 minutes of
        inactivity or 30 minutes. Locking this Mac stops the desktop session.
        Wake word is not enabled. Headphones improve interruption detection.
      </small>
      <div
        className={styles.conversationText}
        aria-label="Latest voice conversation"
      >
        {(voice.partialTranscript || latestUser) && (
          <p>
            <small>YOU{voice.partialTranscript ? " · DRAFT" : ""}</small>
            {voice.partialTranscript || latestUser}
          </p>
        )}
        {latestAnswer && (
          <p>
            <small>ARY · AI-GENERATED VOICE</small>
            {latestAnswer}
          </p>
        )}
      </div>
      {voice.error && <p role="alert">{voice.error}</p>}
      <button type="button" onClick={onConversation}>
        Conversation & evidence
      </button>
    </section>
  );
}
