import { z } from "zod";
/** This exact introduction is part of the approved script, never a model instruction. */
export const ARY_CALL_DISCLOSURE =
  "Hello, this is Ary, an automated assistant calling on behalf of the person who requested this call.";
// Bounded v1 geography: US NANP, then provider country/line-type verification.
export const phoneNumber = z
  .string()
  .regex(/^\+1[2-9]\d{2}[2-9]\d{6}$/)
  .refine(
    (n) =>
      !/^(900|800|888|877|866|855|844|833|822)$/.test(n.slice(2, 5)) &&
      n.slice(5, 8) !== "976" &&
      !/^[2-9]11$/.test(n.slice(2, 5)),
    "Emergency, service and premium destinations are unavailable",
  );
export const callInput = z
  .object({
    operation_id: z.uuid(),
    to: phoneNumber,
    contact_entity_id: z.uuid().nullable().default(null),
    entity_ids: z.array(z.uuid()).max(20).default([]),
    script: z
      .string()
      .trim()
      .min(1)
      .max(2000)
      .refine(
        (s) => s.startsWith(ARY_CALL_DISCLOSURE),
        "Include Ary's exact automated-assistant introduction",
      )
      .refine(
        (s) =>
          !/\b(?:I am|I’m|I'm) (?:a human|your (?:doctor|lawyer|boss))\b|\b(?:not an? (?:AI|automated)|pretend to be|hide (?:my|your) identity)\b/i.test(
            s,
          ),
        "Do not include deceptive identity claims",
      ),
    user_intent: z.literal(true),
    capture_transcript: z.boolean().default(false),
    recording_consent_confirmed: z.boolean().default(false),
  })
  .strict()
  .refine(
    (v) => !v.capture_transcript || v.recording_consent_confirmed,
    "Confirm recording/transcription consent before requesting a transcript",
  );
export type CallInput = z.infer<typeof callInput>;
export const callReference = z.object({ call_action_id: z.uuid() }).strict();
export const callCancel = callReference
  .extend({ user_intent: z.literal(true) })
  .strict();
export const callSnapshot = z
  .object({
    id: z.string().min(1).max(128),
    status: z.enum([
      "queued",
      "ringing",
      "in-progress",
      "completed",
      "busy",
      "no-answer",
      "failed",
      "canceled",
    ]),
    duration_seconds: z.number().int().min(0).nullable(),
    cost: z
      .object({ amount: z.string().max(40), currency: z.string().max(10) })
      .nullable(),
    transcript: z
      .object({ text: z.string().max(30000), source_id: z.string().max(256) })
      .nullable(),
  })
  .strict();
export type CallSnapshot = z.infer<typeof callSnapshot>;
export interface PhoneProvider {
  readonly name: string;
  readonly supportsTranscript: boolean;
  assertConfigured(): void;
  inspectNumber(number: string): Promise<{
    number: string;
    valid: boolean;
    country: string;
    lineType: string;
  }>;
  initiate(input: {
    to: string;
    script: string;
    operationId: string;
    captureTranscript: boolean;
  }): Promise<CallSnapshot>;
  /** Complete provider inventory must prove no call exists before rejected-request recovery. */
  hasNoCalls?(): Promise<boolean>;
  getCall(id: string): Promise<CallSnapshot>;
  cancelCall(id: string): Promise<CallSnapshot>;
}
export const terminalCall = (s: CallSnapshot["status"]) =>
  ["completed", "busy", "no-answer", "failed", "canceled"].includes(s);
export function callSummary(call: CallSnapshot) {
  const states = {
    queued: "The provider queued the call.",
    ringing: "The destination is ringing.",
    "in-progress": "The provider reports an active connection.",
    completed:
      "The call ended. Completion does not establish that a person heard or accepted the message.",
    busy: "The destination was busy.",
    "no-answer": "The provider reports no answer.",
    failed: "The provider reports that the call failed.",
    canceled: "The call was canceled.",
  };
  return (
    states[call.status] +
    (call.transcript
      ? ` Provider transcript excerpt (unverified): ${call.transcript.text.slice(0, 1000)}`
      : " No recipient response transcript is available; no agreement or business result is inferred.")
  );
}
