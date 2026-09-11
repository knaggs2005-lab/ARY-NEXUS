"use client";
import { publishClientEvent } from "../events/event-store";
import { useEffect, useRef, useState } from "react";
import { observeMicrophone } from "./input-meter";
import { api, authClient } from "../api";
import { VOICE_MAX_BYTES, VOICE_MAX_SECONDS } from "../../domain/voice";
import { SpeechQueue, playBrowserAudio } from "./speech-queue";
import { ConversationSession } from "./conversation-session";
import { microphoneLease } from "./microphone-lease";
import { capturePCM } from "./pcm-capture";
import { audioLevel } from "./input-meter";
import { readTranscript } from "./transcript-stream";

export function useAryVoice(
  onTranscript: (text: string, continuous?: boolean) => void,
  interrupt: () => void,
) {
  const [sessionState, setSessionState] = useState<
    "off" | "requesting" | "armed" | "listening" | "transcribing" | "paused"
  >("off");
  const [background, setBackground] = useState(false);
  const backgroundRef = useRef(false);
  const session = useRef<ConversationSession | null>(null);
  const sessionController = useRef<AbortController | null>(null);
  const sessionCleanup = useRef<(() => void) | null>(null);
  const sessionLease = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastSpeech = useRef(0);
  const sessionStarted = useRef(0);
  const level = useRef(0);
  const meter = useRef<(() => void) | null>(null);
  const [interrupted, setInterrupted] = useState(false);
  const [capture, setCapture] = useState<
    "idle" | "requesting" | "listening" | "transcribing"
  >("idle");
  const [playback, setPlayback] = useState<"idle" | "buffering" | "speaking">(
    "idle",
  );
  const [muted, setMuted] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (capture !== "idle")
      publishClientEvent({
        type: `voice.capture_${capture}`,
        visibility: "ambient",
        payload: { status: capture },
      });
    else
      publishClientEvent({
        type: "voice.capture_idle",
        visibility: "systems",
        severity: "debug",
        payload: { status: "idle" },
      });
  }, [capture]);
  useEffect(() => {
    publishClientEvent({
      type: `voice.playback_${playback}`,
      visibility: playback === "speaking" ? "ambient" : "systems",
      payload: { status: playback },
    });
  }, [playback]);
  const [supported, setSupported] = useState(false);
  const [providers, setProviders] = useState("");
  const [partialTranscript, setPartialTranscript] = useState("");
  const [transcriptionTiming, setTranscriptionTiming] = useState<{
    first_text_ms: number | null;
    total_ms: number;
  } | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const media = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const request = useRef<AbortController | null>(null);
  const epoch = useRef(0);
  const queue = useRef<SpeechQueue | null>(null);
  const mutedRef = useRef(false),
    enabledRef = useRef(false);
  const callbacks = useRef({ onTranscript, interrupt });
  callbacks.current = { onTranscript, interrupt };
  const release = () => {
    meter.current?.();
    meter.current = null;
    level.current = 0;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    media.current?.getTracks().forEach((t) => t.stop());
    media.current = null;
  };
  function stopSpeaking() {
    queue.current?.stop();
    queue.current = null;
  }
  function stopConversation() {
    sessionController.current?.abort();
    sessionController.current = null;
    session.current?.stop();
    session.current = null;
    sessionCleanup.current?.();
    sessionCleanup.current = null;
    if (sessionLease.current) clearInterval(sessionLease.current);
    sessionLease.current = null;
    setSessionState("off");
    level.current = 0;
  }
  function cancelCapture() {
    stopConversation();
    setPartialTranscript("");
    setInterrupted(false);
    epoch.current++;
    request.current?.abort();
    if (recorder.current?.state === "recording") recorder.current.stop();
    recorder.current = null;
    release();
    setCapture("idle");
  }
  useEffect(() => {
    setSupported(
      typeof navigator.mediaDevices?.getUserMedia === "function" &&
        typeof window.MediaRecorder !== "undefined",
    );
    const controller = new AbortController();
    void api("voice/config", { signal: controller.signal })
      .then((r) => r.json())
      .then((c) => setProviders(`${c.stt.model} → ${c.tts.model}`))
      .catch(() => {});
    return () => {
      controller.abort();
      epoch.current++;
      request.current?.abort();
      if (recorder.current?.state === "recording") recorder.current.stop();
      release();
      queue.current?.stop();
      stopConversation();
    };
  }, []);
  useEffect(() => {
    if (
      typeof document === "undefined" ||
      typeof window.addEventListener !== "function"
    )
      return;
    const visibility = () => {
      if (document.hidden && !backgroundRef.current) {
        cancelCapture();
        stopSpeaking();
        callbacks.current.interrupt();
      }
    };
    const suspend = () => {
      cancelCapture();
      stopSpeaking();
      callbacks.current.interrupt();
    };
    const offline = () => {
      suspend();
      setError(
        "Voice stopped because the connection went offline. Restart when connected.",
      );
    };
    const approval = (event: Event) => {
      session.current?.pause(Boolean((event as CustomEvent).detail));
    };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("ary:voice-suspend", suspend);
    window.addEventListener("ary:approval-state", approval);
    window.addEventListener("offline", offline);
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("ary:voice-suspend", suspend);
      window.removeEventListener("ary:approval-state", approval);
      window.removeEventListener("offline", offline);
    };
  }, []);
  useEffect(() => {
    let owner: string | null = null;
    const subscription = authClient?.auth.onAuthStateChange(
      (event, current) => {
        const next = current?.user.id ?? null;
        if (event === "SIGNED_OUT" || (owner !== null && owner !== next)) {
          cancelCapture();
          stopSpeaking();
          callbacks.current.interrupt();
        }
        owner = next;
      },
    );
    return () => subscription?.data.subscription.unsubscribe();
  }, []);
  function setBackgroundListening(value: boolean) {
    backgroundRef.current = value;
    setBackground(value);
    if (!value && document.hidden) stopConversation();
  }
  async function startConversation() {
    cancelCapture();
    stopSpeaking();
    callbacks.current.interrupt();
    enabledRef.current = true;
    setEnabled(true);
    setInterrupted(false);
    setError("");
    setSessionState("requesting");
    const controller = new AbortController();
    sessionController.current = controller;
    try {
      if (document.hidden)
        throw new Error("Open Ary before starting the microphone.");
      await microphoneLease(controller.signal);
      controller.signal.throwIfAborted();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
      if (controller.signal.aborted) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      sessionStarted.current = lastSpeech.current = Date.now();
      session.current = new ConversationSession({
        speechStart: () => {
          lastSpeech.current = Date.now();
          setInterrupted(false);
          setPartialTranscript("");
          stopSpeaking();
          callbacks.current.interrupt();
          publishClientEvent({
            type: "voice.user_turn_started",
            visibility: "ambient",
            payload: { status: "listening" },
          });
        },
        state: (state) => {
          if (controller.signal.aborted && state !== "off") return;
          setSessionState(state);
          publishClientEvent({
            type: `voice.session_${state}`,
            visibility: "systems",
            payload: { status: state },
          });
          if (state === "off") {
            controller.abort();
            sessionCleanup.current?.();
            if (sessionLease.current) clearInterval(sessionLease.current);
            sessionLease.current = null;
          }
        },
        transcribe: async (audio, signal) => {
          const started = performance.now();
          let first: number | null = null;
          const response = await api("voice/transcribe", {
            method: "POST",
            body: audio,
            headers: {
              "Content-Type": "audio/wav",
              Accept: "application/x-ndjson",
            },
            signal,
          });
          const result = await readTranscript(
            response,
            (text) => {
              if (!signal.aborted) {
                first ??= Math.round(performance.now() - started);
                setPartialTranscript(text);
              }
            },
            signal,
          );
          if (!signal.aborted) {
            setTranscriptionTiming({
              first_text_ms: first,
              total_ms: Math.round(performance.now() - started),
            });
            setPartialTranscript("");
          }
          return result.text;
        },
        transcript: (text) => callbacks.current.onTranscript(text, true),
        error: (error) => setError(error.message),
      });
      sessionCleanup.current = await capturePCM(
        stream,
        controller.signal,
        (samples, rate) => {
          level.current = audioLevel(samples);
          session.current?.push(samples, rate);
        },
      );
      stream.getTracks().forEach((track) =>
        track.addEventListener(
          "ended",
          () => {
            if (!controller.signal.aborted) {
              stopConversation();
              setError(
                "Microphone disconnected. Reconnect it and start again.",
              );
            }
          },
          { once: true },
        ),
      );
      sessionLease.current = setInterval(() => {
        if (
          Date.now() - lastSpeech.current > 300000 ||
          Date.now() - sessionStarted.current > 1800000
        ) {
          stopConversation();
          stopSpeaking();
          callbacks.current.interrupt();
          setError(
            "Listening session ended after inactivity or its 30-minute limit. Start again to continue.",
          );
        }
      }, 1000);
    } catch (error) {
      if (!controller.signal.aborted) {
        stopConversation();
        setError(
          (error as Error).name === "NotAllowedError"
            ? "Allow microphone access in macOS/browser settings, then start again."
            : (error as Error).message,
        );
      }
    }
  }
  function beginResponse() {
    setInterrupted(false);
    setError("");
    stopSpeaking();
    if (!enabledRef.current || mutedRef.current) return;
    queue.current = new SpeechQueue(
      {
        synthesize: async (text, signal) =>
          (
            await api("voice/speak", {
              method: "POST",
              body: JSON.stringify({ text }),
              signal,
            })
          ).blob(),
        play: playBrowserAudio,
      },
      setPlayback,
      (e) => setError(e.message),
    );
  }
  function delta(text: string) {
    queue.current?.add(text);
  }
  function finishResponse() {
    queue.current?.add("", true);
  }
  function toggleMute() {
    mutedRef.current = !mutedRef.current;
    setMuted(mutedRef.current);
    if (mutedRef.current) stopSpeaking();
  }
  async function startListening() {
    callbacks.current.interrupt();
    stopSpeaking();
    cancelCapture();
    setError("");
    setTranscriptionTiming(null);
    enabledRef.current = true;
    setEnabled(true);
    setInterrupted(false);
    setCapture("requesting");
    const current = epoch.current;
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder)
        throw new Error(
          "Microphone recording requires HTTPS or localhost and a supported browser.",
        );
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: false,
      });
      if (current !== epoch.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      media.current = stream;
      meter.current = observeMicrophone(stream, (value) => {
        level.current = value;
      });
      const mimeType = [
        "audio/webm;codecs=opus",
        "audio/mp4",
        "audio/ogg;codecs=opus",
      ].find((t) => MediaRecorder.isTypeSupported(t));
      if (!mimeType)
        throw new Error(
          "This browser has no supported audio recording format.",
        );
      const recording = new MediaRecorder(stream, {
        mimeType,
        audioBitsPerSecond: 64000,
      });
      recorder.current = recording;
      const chunks: Blob[] = [];
      let size = 0;
      recording.ondataavailable = (e) => {
        if (current !== epoch.current) return;
        if (e.data.size) {
          size += e.data.size;
          chunks.push(e.data);
          if (size > VOICE_MAX_BYTES) {
            cancelCapture();
            setError("Recording exceeded 5 MB. Try a shorter message.");
          }
        }
      };
      recording.onerror = () => {
        if (current !== epoch.current) return;
        cancelCapture();
        setError("Microphone recording failed. Try again.");
      };
      recording.onstop = () => {
        // A late stop from a cancelled recording must not release a newer microphone.
        if (current !== epoch.current) return;
        release();
        recorder.current = null;
        setCapture("transcribing");
        const controller = new AbortController();
        request.current = controller;
        const blob = new Blob(chunks, { type: mimeType });
        const started = performance.now();
        let firstText: number | null = null;
        void api("voice/transcribe", {
          method: "POST",
          body: blob,
          headers: { "Content-Type": mimeType, Accept: "application/x-ndjson" },
          signal: controller.signal,
        })
          .then((r) =>
            readTranscript(
              r,
              (text) => {
                if (current !== epoch.current) return;
                firstText ??= Math.round(performance.now() - started);
                setPartialTranscript(text);
              },
              controller.signal,
            ),
          )
          .then((result) => {
            if (current !== epoch.current) return;
            setTranscriptionTiming({
              first_text_ms: firstText,
              total_ms: Math.round(performance.now() - started),
            });
            if (!result.text.trim())
              setError("No speech was detected. Try again.");
            else callbacks.current.onTranscript(result.text);
          })
          .catch((e) => {
            if (current === epoch.current) setError(e.message);
          })
          .finally(() => {
            if (current === epoch.current) {
              setPartialTranscript("");
              setCapture("idle");
            }
          });
      };
      recording.start(250);
      setCapture("listening");
      timer.current = setTimeout(() => {
        if (recording.state === "recording") recording.stop();
      }, VOICE_MAX_SECONDS * 1000);
    } catch (e) {
      if (current === epoch.current) {
        release();
        setCapture("idle");
        setError(
          (e as Error).name === "NotAllowedError"
            ? "Microphone permission was denied. Allow it in your browser, then try again."
            : (e as Error).message,
        );
      }
    }
  }
  function stopListening() {
    if (recorder.current?.state === "recording") recorder.current.stop();
  }
  function interruptAll() {
    cancelCapture();
    stopSpeaking();
    callbacks.current.interrupt();
    setInterrupted(true);
    setError("");
  }
  function readAloud(text: string) {
    cancelCapture();
    enabledRef.current = true;
    setEnabled(true);
    mutedRef.current = false;
    setMuted(false);
    setError("");
    beginResponse();
    delta(text);
    finishResponse();
  }
  return {
    level,
    sessionState,
    sessionActive: sessionState !== "off",
    isSessionActive: () =>
      !!sessionController.current && !sessionController.current.signal.aborted,
    background,
    setBackgroundListening,
    startConversation,
    stopConversation,
    interrupted,
    interruptAll,
    capture:
      sessionState === "listening"
        ? ("listening" as const)
        : sessionState === "transcribing"
          ? ("transcribing" as const)
          : sessionState === "requesting"
            ? ("requesting" as const)
            : capture,
    playback,
    muted,
    enabled,
    error,
    supported,
    providers,
    partialTranscript,
    transcriptionTiming,
    startListening,
    stopListening,
    cancelCapture,
    stopSpeaking,
    toggleMute,
    beginResponse,
    delta,
    finishResponse,
    readAloud,
  };
}
