import { z } from "zod";

export const wakePhrase = z.enum(["ARY", "HEY_ARY", "NEXUS"]);
export type WakePhrase = z.infer<typeof wakePhrase>;
export const wakeWordState = z.enum([
  "STOPPED",
  "STARTING",
  "LISTENING",
  "WAKE_DETECTED",
  "PAUSED",
  "FAILED",
]);
export type WakeWordState = z.infer<typeof wakeWordState>;
export interface WakeWordConfig {
  readonly phrases: readonly WakePhrase[];
  readonly cooldownMs?: number;
  readonly enabled?: boolean;
}
export interface WakeWordDetection {
  readonly wakePhrase: WakePhrase;
  readonly timestamp: string;
  readonly confidence?: number;
  readonly providerId: string;
  readonly sessionId: string;
}
export interface WakeWordEvent {
  readonly type: "wake.detected";
  readonly detection: WakeWordDetection;
}
export interface WakeWordHealth {
  readonly state: WakeWordState;
  readonly providerId: string;
  readonly localOnly: true;
  readonly microphoneActive: boolean;
  readonly reason?: string;
}
export interface WakeWordSession {
  readonly id: string;
  readonly state: WakeWordState;
  pause(): Promise<void>;
  resume(): Promise<void>;
  stop(): Promise<void>;
  onEvent(handler: (event: WakeWordEvent) => void): () => void;
}
export interface WakeWordProvider {
  readonly id: string;
  readonly localOnly: true;
  start(config: WakeWordConfig): Promise<WakeWordSession>;
}
