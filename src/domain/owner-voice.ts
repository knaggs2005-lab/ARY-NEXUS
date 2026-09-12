import { z } from "zod";
export const speakerTemplate = z
  .object({
    version: z.literal(1),
    model_id: z.string().min(1).max(100),
    model_version: z.string().min(1).max(100),
    model_hash: z.string().regex(/^[a-f0-9]{64}$/),
    created_at: z.string().datetime(),
    vector: z.array(z.number().finite()).min(16).max(4096),
  })
  .strict();
export type SpeakerTemplate = z.infer<typeof speakerTemplate>;
export interface SpeakerVerificationProvider {
  readonly id: string;
  readonly version: string;
  readonly modelHash: string;
  readonly localOnly: true;
  available(): boolean;
  embed(samples: Float32Array, sampleRate: 16000): Promise<Float32Array>;
}
export interface SpeakerTemplateStore {
  read(): Promise<SpeakerTemplate | null>;
  write(template: SpeakerTemplate): Promise<void>;
  delete(): Promise<void>;
}
export type OwnerVoiceDecision = {
  decision: "ALLOW" | "REJECT";
  reason: string;
  confidence: number | null;
  authorizes_actions: false;
  replay_resistant: false;
};
