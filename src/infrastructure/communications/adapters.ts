import { gmailDraftInput } from "../../domain/gmail";
import { randomUUID } from "node:crypto";
import { ARY_CALL_DISCLOSURE, callInput } from "../../domain/phone";
import type { CommunicationAdapter } from "../../domain/communication-plan";
import { AppError } from "../../domain/validation";
export class CommunicationAdapterRegistry {
  private adapters = new Map<string, CommunicationAdapter>();
  register(adapter: CommunicationAdapter) {
    if (this.adapters.has(adapter.channel))
      throw new Error("Duplicate communication channel");
    this.adapters.set(adapter.channel, adapter);
    return this;
  }
  get(channel: string) {
    const adapter = this.adapters.get(channel);
    if (!adapter)
      throw new AppError("Communication channel is not installed", 503);
    return adapter;
  }
}
export const phoneCommunicationAdapter: CommunicationAdapter = {
  channel: "phone",
  transport: "existing PhoneProvider",
  conversational: false,
  prepare(input, contact) {
    if (input.mode === "conversation")
      return {
        requests: [],
        limitations: [
          "Interactive calling is unavailable. The current provider delivers a script; it cannot listen, negotiate a time or verify an answer. Configure and accept a conversational telephony adapter first.",
        ],
      };
    const parsed = callInput.safeParse({
      operation_id: randomUUID(),
      to: contact.metadata.phone,
      contact_entity_id: contact.id,
      entity_ids: [contact.id, ...(input.project_id ? [input.project_id] : [])],
      script: `${ARY_CALL_DISCLOSURE} ${input.message}`,
      user_intent: true,
      capture_transcript: false,
      recording_consent_confirmed: false,
    });
    if (!parsed.success)
      throw new AppError(
        "Contact needs a permitted saved phone number and a non-deceptive script",
        400,
      );
    return {
      requests: [
        {
          tool: "phone.initiate",
          input: parsed.data,
          label: "Review one outbound scripted call",
        },
      ],
      limitations: [
        "No listening or agreement detection. Recording is off. Provider configuration, allowlist, destination checks, rate limits and exact approval still apply.",
      ],
    };
  },
};
export const emailCommunicationAdapter: CommunicationAdapter = {
  channel: "email",
  transport: "existing GmailProvider",
  conversational: false,
  prepare(input, contact) {
    if (!input.email_thread)
      return {
        requests: [],
        limitations: [
          "Select an existing Gmail connection and thread. Ary will prepare an unsent reply; sending has a separate exact approval.",
        ],
      };
    const instruction = `Prepare a reply for ${contact.name}. Identify yourself as Ary, an automated assistant acting on behalf of the account owner. Do not claim to be the owner or invent their authority. Objective: ${input.objective}\nRequested message: ${input.message}`;
    const draft = gmailDraftInput.safeParse({
      ...input.email_thread,
      instruction,
    });
    if (!draft.success)
      throw new AppError(
        "Shorten the email objective/message to fit the existing draft limit",
        400,
      );
    return {
      requests: [
        {
          tool: "gmail.draft",
          input: draft.data,
          label: "Prepare unsent email reply",
        },
      ],
      limitations: [
        "Draft only. Review recipients and content in the existing Gmail screen before separate send approval. The selected thread must contain this contact's saved email address.",
      ],
    };
  },
};
export const messagingCommunicationAdapter: CommunicationAdapter = {
  channel: "messaging",
  transport: "unconfigured",
  conversational: false,
  prepare() {
    return {
      requests: [],
      limitations: [
        "Messaging transport is not configured. This plan is retained for review; no message can be delivered.",
      ],
    };
  },
};
export function communicationAdapters() {
  return new CommunicationAdapterRegistry()
    .register(phoneCommunicationAdapter)
    .register(emailCommunicationAdapter)
    .register(messagingCommunicationAdapter);
}
