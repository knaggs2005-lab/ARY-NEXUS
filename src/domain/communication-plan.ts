import { z } from "zod";
import type { Entity, Json } from "./models";
export const communicationPlanInput = z
  .object({
    channel: z.enum(["phone", "email", "messaging"]),
    contact: z.string().trim().min(1).max(200),
    objective: z.string().trim().min(1).max(2000),
    message: z.string().trim().min(1).max(1500),
    project_id: z.uuid().nullable().default(null),
    email_thread: z
      .object({
        connection_id: z.uuid(),
        thread_id: z.string().regex(/^[a-f0-9]{1,80}$/i),
      })
      .strict()
      .optional(),
    mode: z.enum(["script", "conversation"]).default("script"),
  })
  .strict();
export type CommunicationPlanInput = z.infer<typeof communicationPlanInput>;
export interface PreparedCommunicationRequest {
  tool: string;
  input: Json;
  label: string;
}
/** Adapters prepare existing capabilities; they cannot grant permission or execute outreach. */
export interface CommunicationAdapter {
  channel: CommunicationPlanInput["channel"];
  transport: string;
  conversational: boolean;
  prepare(
    input: CommunicationPlanInput,
    contact: Entity,
  ): {
    requests: PreparedCommunicationRequest[];
    limitations: string[];
  };
}
export const communicationDebriefInput = z
  .object({
    source_action_id: z.uuid(),
    project_id: z.uuid().nullable().default(null),
  })
  .strict();
export const communicationFindings = z
  .object({
    summary: z.string().min(1).max(2000),
    candidates: z
      .array(
        z
          .object({
            kind: z.enum(["fact", "decision", "commitment"]),
            source_id: z.string().min(1).max(256),
            quote: z.string().min(20).max(1500),
            reason: z.string().min(1).max(700),
            confidence: z.number().min(0).max(1),
            importance: z.number().min(0).max(1),
          })
          .strict(),
      )
      .max(5),
  })
  .strict();
export interface CommunicationEvidence {
  id: string;
  text: string;
  attribution: string;
}
