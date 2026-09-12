import {
  callSnapshot,
  phoneNumber,
  type PhoneProvider,
  type CallSnapshot,
} from "../../domain/phone";
import { AppError } from "../../domain/validation";
import { createHash } from "node:crypto";
export const xmlText = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
/** One-way approved script delivery. No recording, live reasoning, redirects or webhooks. */
export class TwilioPhoneProvider implements PhoneProvider {
  readonly name = "twilio";
  readonly supportsTranscript = false;
  constructor(
    private account = process.env.TWILIO_ACCOUNT_SID || "",
    private token = process.env.TWILIO_AUTH_TOKEN || "",
    private from = process.env.ARY_CALLS_FROM_NUMBER || "",
    private fetcher: typeof fetch = fetch,
    private trialScriptUrl = process.env.ARY_CALLS_TRIAL_SCRIPT_URL || "",
    private trialScriptDigest = process.env.ARY_CALLS_TRIAL_SCRIPT_DIGEST || "",
  ) {}
  assertConfigured() {
    if (
      !/^AC[a-f0-9]{32}$/i.test(this.account) ||
      !this.token ||
      !phoneNumber.safeParse(this.from).success ||
      (this.trialScriptUrl !== "" &&
        !/^https:\/\/handler\.twilio\.com\/twiml\/EH[a-f0-9]{32}$/.test(this.trialScriptUrl))
    )
      throw new AppError(
        "Configure Twilio credentials and the verified Ary caller number on the server",
        503,
      );
  }
  private async request(url: string, body?: URLSearchParams) {
    this.assertConfigured();
    try {
      const response = await this.fetcher(url, {
        method: body ? "POST" : "GET",
        redirect: "error",
        signal: AbortSignal.timeout(15000),
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.account}:${this.token}`).toString("base64")}`,
          ...(body
            ? { "Content-Type": "application/x-www-form-urlencoded" }
            : {}),
        },
        ...(body ? { body: body.toString() } : {}),
      });
      if (!response.ok) {
        let code = "";
        try {
          const raw = await response.text();
          const value = raw.length <= 10000 ? JSON.parse(raw) : null;
          if (Number.isSafeInteger(value?.code) && value.code > 0)
            code = `; Twilio code ${value.code}`;
          if (value?.code === 20003 && /compliance profile|KYC/i.test(String(value?.message ?? "")))
            throw new AppError(
              "Twilio requires an approved primary compliance profile (KYC) before this US number can place calls. Complete Trust Hub verification, then retry.",
              503,
            );
        } catch { /* Untrusted error content is never displayed. */ }
        throw new AppError(
          `Telephony provider request failed (HTTP ${response.status}${code}); check provider console. No automatic redial.`,
          502,
        );
      }
      const raw = await response.text();
      if (raw.length > 100000) throw Error("Oversize provider response");
      return JSON.parse(raw);
    } catch (e) {
      if (e instanceof AppError) throw e;
      throw new AppError(
        "Telephony request failed or timed out. Initiation may be uncertain; do not redial without verification.",
        502,
      );
    }
  }
  async inspectNumber(number: string) {
    const v = await this.request(
      `https://lookups.twilio.com/v2/PhoneNumbers/${encodeURIComponent(number)}?Fields=line_type_intelligence`,
    );
    return {
      number: v.phone_number,
      valid: v.valid === true,
      country: v.country_code,
      lineType: v.line_type_intelligence?.error_code
        ? "unknown"
        : v.line_type_intelligence?.type || "unknown",
    };
  }
  private path(id?: string) {
    if (id && !/^CA[a-f0-9]{32}$/i.test(id))
      throw new AppError("Invalid provider call reference", 400);
    return `https://api.twilio.com/2010-04-01/Accounts/${this.account}/Calls${id ? `/${id}` : ""}.json`;
  }
  private snapshot(v: Record<string, unknown>): CallSnapshot {
    return callSnapshot.parse({
      id: v.sid,
      status: v.status,
      duration_seconds: v.duration == null ? null : Number(v.duration),
      cost:
        v.price == null
          ? null
          : { amount: String(v.price), currency: String(v.price_unit) },
      transcript: null,
    });
  }
  async initiate(input: Parameters<PhoneProvider["initiate"]>[0]) {
    if (input.captureTranscript)
      throw new AppError("This adapter does not support transcripts", 400);
    const twiml = `<Response><Say>${xmlText(input.script)}</Say><Hangup/></Response>`;
    if (this.trialScriptUrl) {
      if (!/^[a-f0-9]{64}$/i.test(this.trialScriptDigest) ||
        createHash("sha256").update(input.script).digest("hex") !== this.trialScriptDigest)
        throw new AppError("Hosted trial script does not exactly match the approved script. No call placed.", 409);
    }
    return this.snapshot(
      await this.request(
        this.path(),
        new URLSearchParams({
          To: input.to,
          From: this.from,
          ...(this.trialScriptUrl ? { Url: this.trialScriptUrl } : { Twiml: twiml }),
          Timeout: "20",
          TimeLimit: "120",
          Record: "false",
        }),
      ),
    );
  }
  async hasNoCalls() {
    const result = await this.request(this.path() + "?PageSize=1");
    return Array.isArray(result.calls) && result.calls.length === 0 &&
      result.next_page_uri === null;
  }
  async getCall(id: string) {
    return this.snapshot(await this.request(this.path(id)));
  }
  async cancelCall(id: string) {
    const current = await this.getCall(id);
    if (
      ["completed", "busy", "no-answer", "failed", "canceled"].includes(
        current.status,
      )
    )
      return current;
    return this.snapshot(
      await this.request(
        this.path(id),
        new URLSearchParams({
          Status: current.status === "in-progress" ? "completed" : "canceled",
        }),
      ),
    );
  }
}
