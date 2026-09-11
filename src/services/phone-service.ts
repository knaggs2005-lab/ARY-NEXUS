import { resolve } from "node:path";
import {
  callInput,
  callSnapshot,
  callSummary,
  terminalCall,
  type CallInput,
  type CallSnapshot,
  type PhoneProvider,
} from "../domain/phone";
import type { Repository } from "../domain/repository";
import type { ToolExecutionContext } from "../domain/tool-registry";
import type { Json } from "../domain/models";
import { AppError, required } from "../domain/validation";
import { digest } from "./permission-service";
import {
  EncryptedCalendarVault,
  type CalendarVault,
} from "../infrastructure/calendar/vault";
interface Entry {
  fingerprint: string;
  to: string;
  at: number;
  state: "pending" | "submitted" | "rejected";
  recovery?: Json;
  action_id: string;
  input: CallInput;
  provider: string;
  snapshot?: CallSnapshot;
}
interface Ledger {
  operations: Record<string, Entry>;
}
export function assertCallsEnabled(userId: string) {
  if (
    process.env.ARY_CALLS_ENABLED !== "true" ||
    process.env.ARY_STORAGE !== "supabase" ||
    process.env.ARY_CALLS_USER_ID !== userId
  )
    throw new AppError(
      "Calls are disabled. Enable the provider for the authenticated owner on the server first.",
      403,
    );
  if (!/^[a-f0-9]{64}$/i.test(process.env.ARY_INTEGRATION_ENCRYPTION_KEY || ""))
    throw new AppError(
      "Configure call receipt encryption before enabling calls",
      503,
    );
}
export class PhoneService {
  constructor(
    private repo: Repository,
    private provider: PhoneProvider,
    private guard: () => void = () => assertCallsEnabled(repo.userId),
    private vault: CalendarVault = new EncryptedCalendarVault(
      resolve(".data/calls-vault"),
    ),
    private now: () => number = Date.now,
  ) {}
  configuration() {
    let enabled = true;
    let reason: string | undefined;
    try {
      this.assertAvailable();
    } catch (error) {
      enabled = false;
      reason = error instanceof Error ? error.message : "Provider unavailable";
    }
    return {
      enabled,
      provider: this.provider.name,
      supports_transcript: this.provider.supportsTranscript,
      ...(reason ? { reason } : {}),
    };
  }
  assertAvailable() {
    this.guard();
    if (
      process.env.ARY_CALLS_PROVIDER &&
      process.env.ARY_CALLS_PROVIDER !== this.provider.name
    )
      throw new AppError(
        "Configured phone provider does not match the adapter",
        503,
      );
    this.provider.assertConfigured();
  }
  private key() {
    return `calls:${this.repo.userId}`;
  }
  async validateContact(input: CallInput) {
    for (const id of input.entity_ids)
      required(await this.repo.get("entities", id), "Call entity");
    if (input.contact_entity_id) {
      const contact = required(
        await this.repo.get("entities", input.contact_entity_id),
        "Contact",
      );
      if (
        !["person", "company"].includes(contact.entity_type) ||
        contact.metadata.phone !== input.to
      )
        throw new AppError(
          "Saved contact number changed or is not an exact match. Prepare and approve a new request.",
          409,
        );
    }
  }
  async initiate(raw: CallInput, context: ToolExecutionContext): Promise<Json> {
    this.assertAvailable();
    const input = callInput.parse(raw);
    await this.validateContact(input);
    if (input.capture_transcript && !this.provider.supportsTranscript)
      throw new AppError(
        "Configured provider does not support transcripts",
        400,
      );
    const allowed = (process.env.ARY_CALLS_ALLOWED_NUMBERS || "")
      .split(",")
      .map((n) => n.trim());
    if (!allowed.includes(input.to))
      throw new AppError(
        "Destination is not on the operator's calling allowlist",
        403,
      );
    const fingerprint = digest([this.provider.name, input]);
    return this.vault.lock(this.key(), async () => {
      const ledger = (await this.vault.read<Ledger>(this.key())) ?? {
        operations: {},
      };
      const previous = ledger.operations[input.operation_id];
      if (previous) {
        if (previous.fingerprint !== fingerprint)
          throw new AppError(
            "Call operation belongs to different approved inputs",
            409,
          );
        if (previous.state === "rejected")
          throw new AppError("This rejected operation is closed. Prepare a new call and obtain fresh approval.", 409);
        if (previous.state === "pending")
          throw new AppError(
            "Call initiation is uncertain. Inspect the provider console; this operation will never redial automatically.",
            409,
          );
        previous.action_id = required(
          context.actionId ?? null,
          "Action context",
        );
        await this.vault.write(this.key(), ledger);
        return this.result(previous, previous.snapshot!, context);
      }
      const entries = Object.values(ledger.operations),
        time = this.now();
      if (
        entries.some(
          (e) => e.state === "pending" || (e.state === "submitted" && !terminalCall(e.snapshot!.status)),
        )
      )
        throw new AppError(
          "An existing call is active or uncertain. Refresh/resolve it before starting another.",
          409,
        );
      const submitted = entries.filter((e) => e.state !== "rejected");
      if (
        submitted.filter((e) => time - e.at < 3600000).length >= 3 ||
        submitted.filter((e) => time - e.at < 86400000).length >= 10 ||
        submitted.some((e) => e.to === input.to && time - e.at < 86400000)
      )
        throw new AppError(
          "Call rate limit reached: 3/hour, 10/day, one attempt per destination per 24 hours. No automated redial.",
          429,
        );
      const number = await this.provider.inspectNumber(input.to);
      if (
        !number.valid ||
        number.number !== input.to ||
        number.country !== "US" ||
        !["mobile", "landline"].includes(number.lineType)
      )
        throw new AppError(
          "Only provider-verified US mobile/landline destinations are allowed; premium, service, foreign and unknown numbers are blocked",
          400,
        );
      const entry: Entry = {
        fingerprint,
        to: input.to,
        at: time,
        state: "pending",
        action_id: required(context.actionId ?? null, "Action context"),
        input,
        provider: this.provider.name,
      };
      ledger.operations[input.operation_id] = entry;
      await this.vault.write(this.key(), ledger);
      // Persist before contacting the provider. A timeout/crash leaves a non-retryable uncertain receipt.
      const snapshot = this.sanitize(
        await this.provider.initiate({
          to: input.to,
          script: input.script,
          operationId: input.operation_id,
          captureTranscript: input.capture_transcript,
        }),
        input,
      );
      entry.snapshot = snapshot;
      entry.state = "submitted";
      await this.vault.write(this.key(), ledger);
      return this.result(entry, snapshot, context);
    });
  }
  private sanitize(raw: CallSnapshot, input: CallInput) {
    const snapshot = callSnapshot.parse(raw);
    if (
      !input.capture_transcript ||
      !input.recording_consent_confirmed ||
      !this.provider.supportsTranscript
    )
      snapshot.transcript = null;
    return snapshot;
  }
  private result(
    entry: Entry,
    snapshot: CallSnapshot,
    context: ToolExecutionContext,
  ): Json {
    const summary = callSummary(snapshot);
    context.stage?.([
      {
        kind: "insert",
        table: "outcomes",
        data: {
          action_id: context.actionId!,
          goal_id: null,
          status: terminalCall(snapshot.status)
            ? snapshot.status === "completed"
              ? "success"
              : "failure"
            : "pending",
          summary,
          metrics: {
            duration_seconds: snapshot.duration_seconds,
            provider_cost: snapshot.cost,
          },
          metadata: {
            kind: "call_snapshot",
            call_action_id: entry.action_id,
            provider: entry.provider,
            provider_call_id: snapshot.id,
            observed_at: new Date(this.now()).toISOString(),
            transcript_source: snapshot.transcript?.source_id ?? null,
            business_outcome: "unknown",
          },
        },
      },
    ]);
    return {
      kind: "phone_call",
      call_action_id: entry.action_id,
      provider: entry.provider,
      operation_id: entry.input.operation_id,
      to: entry.to,
      contact_entity_id: entry.input.contact_entity_id,
      entity_ids: entry.input.entity_ids,
      script: entry.input.script,
      capture_transcript: entry.input.capture_transcript,
      snapshot,
      summary,
      observed_at: new Date(this.now()).toISOString(),
      business_outcome: "unknown",
      simulated: false,
    };
  }
  async reconcileRejected(actionId: string): Promise<Json> {
    this.assertAvailable();
    const original = required(await this.repo.get("actions", actionId), "Call action");
    if (original.tool_name !== "phone.initiate" || original.status !== "failed" ||
      !(/Telephony provider request failed \(HTTP 400(?:; Twilio code \d+)?\);/.test(original.error || "") || /No call placed\.$/.test(original.error || "") || /active or uncertain/.test(original.error || "")))
      throw new AppError("Only an initiation with a provider-rejected or explicitly uncertain result can be reconciled. Timeouts remain blocked.", 409);
    return this.vault.lock(this.key(), async () => {
      const ledger = required(await this.vault.read<Ledger>(this.key()), "Call ledger");
      const entry = Object.values(ledger.operations).find(e => e.action_id === actionId);
      if (!this.provider.hasNoCalls || !(await this.provider.hasNoCalls()))
        throw new AppError("Provider cannot prove an empty call inventory. Recovery remains blocked.", 409);
      // A process restart can leave the action row without its encrypted
      // receipt reference. If the provider proves there are no calls, close
      // only pending local attempts as rejected; this cannot dial or redial.
      if (!entry) {
        const pending = Object.values(ledger.operations).filter((e) => e.state === "pending");
        if (!pending.length) throw new AppError("Original call receipt not found", 409);
        const recovery = {
          source_action_id: actionId,
          provider: this.provider.name,
          evidence: "Original action had no receipt reference and complete empty provider call inventory",
          observed_at: new Date(this.now()).toISOString(),
          summary: "Unresolved local call attempt closed without dialing. A new call needs a new request and approval.",
        };
        for (const pendingEntry of pending) {
          pendingEntry.state = "rejected";
          pendingEntry.recovery = recovery;
        }
        await this.vault.write(this.key(), ledger);
        return recovery;
      }
      if (entry.provider !== this.provider.name) throw new AppError("Provider mismatch", 409);
      if (entry.state === "rejected") return entry.recovery!;
      if (entry.state !== "pending")
        throw new AppError("Only an unresolved pending call can be reconciled.", 409);
      entry.state = "rejected";
      entry.recovery = {
        source_action_id: actionId, operation_id: entry.input.operation_id,
        provider: entry.provider, evidence: "Original HTTP 400 and complete empty provider call inventory",
        observed_at: new Date(this.now()).toISOString(),
        summary: "Rejected request closed without dialing. A new call needs a new request and approval.",
      };
      await this.vault.write(this.key(), ledger);
      return entry.recovery;
    });
  }
  async refresh(
    actionId: string,
    context: ToolExecutionContext,
    cancel = false,
  ): Promise<Json> {
    this.assertAvailable();
    const original = required(
      await this.repo.get("actions", actionId),
      "Call action",
    );
    if (
      original.tool_name !== "phone.initiate" ||
      original.status !== "succeeded"
    )
      throw new AppError("Use a completed call-initiation action", 400);
    const result = original.output.result as Json;
    const operation = String(result.operation_id);
    return this.vault.lock(this.key(), async () => {
      const ledger = required(
        await this.vault.read<Ledger>(this.key()),
        "Call ledger",
      );
      const entry = required(ledger.operations[operation], "Call receipt");
      if (
        entry.provider !== this.provider.name ||
        !entry.snapshot ||
        entry.state !== "submitted"
      )
        throw new AppError(
          "Provider receipt is unavailable; inspect the original provider",
          409,
        );
      const next = this.sanitize(
        cancel
          ? await this.provider.cancelCall(entry.snapshot.id)
          : await this.provider.getCall(entry.snapshot.id),
        entry.input,
      );
      if (next.id !== entry.snapshot.id)
        throw new AppError("Provider returned a different call", 502);
      entry.snapshot = next;
      await this.vault.write(this.key(), ledger);
      return {
        ...this.result(entry, next, context),
        cancellation_requested: cancel,
      };
    });
  }
}
