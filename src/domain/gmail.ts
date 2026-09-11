import { z } from "zod";
const id = z.string().regex(/^[a-f0-9]{1,80}$/i);
const address = z
  .email()
  .max(254)
  .refine((v) => /^[\x21-\x7e]+$/.test(v) && !/[\r\n<>]/.test(v));
export const gmailSearch = z
  .object({
    query: z.string().trim().min(1).max(500),
    page: z.string().max(500).optional(),
  })
  .strict();
export const gmailThreadInput = z
  .object({ connection_id: z.uuid(), thread_id: id })
  .strict();
export const gmailDraftInput = gmailThreadInput
  .extend({ instruction: z.string().trim().min(1).max(2000) })
  .strict();
export const gmailSendInput = z
  .object({
    connection_id: z.uuid(),
    operation_id: z.uuid(),
    draft_action_id: z.uuid(),
    from_account: address,
    to: z.array(address).min(1).max(10),
    cc: z.array(address).max(10).default([]),
    subject: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .refine((v) => !/[\r\n]/.test(v)),
    body: z.string().trim().min(1).max(16000),
    source_thread_id: id.nullable().default(null),
  })
  .strict();
export const gmailEvidenceInput = z
  .object({
    analysis_action_id: z.uuid(),
    candidate_index: z.number().int().min(0).max(4),
    quote: z.string().min(20).max(1500),
  })
  .strict();
export const gmailAnalysis = z
  .object({
    summary: z.string().max(4000),
    candidates: z
      .array(
        z
          .object({
            kind: z.enum(["decision", "fact", "task"]),
            message_id: id,
            quote: z.string().min(20).max(1500),
            importance: z.number().min(0).max(1),
            confidence: z.number().min(0).max(1),
            reason: z.string().min(1).max(700),
          })
          .strict(),
      )
      .max(5),
  })
  .strict();
export interface MailMessage {
  id: string;
  thread_id: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  text: string;
  truncated: boolean;
  body_available: boolean;
}
export interface MailThread {
  id: string;
  connection_id: string;
  account: string;
  messages: MailMessage[];
  truncated: boolean;
}
export interface GmailProvider {
  status(): Promise<{
    configured: boolean;
    connected: boolean;
    writable: boolean;
    connection_id: string | null;
    account: string | null;
  }>;
  search(input: z.infer<typeof gmailSearch>): Promise<{
    connection_id: string;
    threads: { id: string; snippet: string }[];
    next_page: string | null;
  }>;
  thread(input: z.infer<typeof gmailThreadInput>): Promise<MailThread>;
  send(
    input: z.infer<typeof gmailSendInput>,
  ): Promise<{ message_id: string; thread_id: string; recovered: boolean }>;
}
export interface MailIntelligence {
  summarize(thread: MailThread): Promise<z.infer<typeof gmailAnalysis>>;
  draft(
    thread: MailThread,
    instruction: string,
  ): Promise<{ subject: string; body: string }>;
}
