import { createHash } from "node:crypto";
import type { z } from "zod";
import {
  gmailSendInput,
  type GmailProvider,
  type MailMessage,
  type MailThread,
} from "../../domain/gmail";
import { AppError } from "../../domain/validation";
import { EncryptedCalendarVault, type CalendarVault } from "../calendar/vault";
import { gmailConfigured, gmailClient } from "./google-auth";
type Connection = {
  id: string;
  account: string;
  refresh_token: string;
  writable: boolean;
};
type Payload = {
  mimeType?: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string; size?: number };
  parts?: Payload[];
};
type RawMessage = {
  id: string;
  threadId: string;
  internalDate?: string;
  payload?: Payload;
  snippet?: string;
};
export function mailText(part: Payload): string {
  if (part.filename) return "";
  if (part.mimeType === "text/plain" && part.body?.data)
    return Buffer.from(part.body.data, "base64url").toString("utf8");
  return (part.parts || []).map(mailText).filter(Boolean).join("\n");
}
export function normalizeMail(message: RawMessage, limit = 12000): MailMessage {
  const header = (name: string) =>
    (message.payload?.headers || []).find((h) => h.name.toLowerCase() === name)
      ?.value || "";
  const raw = mailText(message.payload || {}),
    text = raw.slice(0, limit);
  const date = new Date(Number(message.internalDate));
  return {
    id: message.id,
    thread_id: message.threadId,
    from: header("from"),
    to: header("to"),
    subject: header("subject"),
    date:
      message.internalDate && Number.isFinite(date.getTime())
        ? date.toISOString()
        : "unknown",
    text,
    truncated: raw.length > limit,
    body_available: raw.length > 0,
  };
}
async function boundedJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Empty Gmail response");
  let size = 0;
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 2 * 1024 * 1024) {
      await reader.cancel();
      throw new AppError(
        "Email response exceeds the safe read limit; select a smaller conversation",
        413,
      );
    }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
export function encodeMail(
  input: z.infer<typeof gmailSendInput>,
  account: string,
  messageId: string,
) {
  const fold = (values: string[]) => values.join(",\r\n ");
  // RFC 2047: fold encoded words without splitting UTF-8 characters; keep header lines <=76.
  const subjectParts: string[] = [];
  let part = "";
  for (const character of input.subject) {
    if (Buffer.byteLength(part + character) > 39) {
      subjectParts.push(part);
      part = "";
    }
    part += character;
  }
  if (part) subjectParts.push(part);
  const subject = subjectParts
    .map((p) => `=?UTF-8?B?${Buffer.from(p).toString("base64")}?=`)
    .join("\r\n ");
  const headers = [
    `From: ${account}`,
    `To: ${fold(input.to)}`,
    ...(input.cc.length ? [`Cc: ${fold(input.cc)}`] : []),
    `Subject: ${subject}`,
    `Message-ID: <${messageId}>`,
    `Date: ${new Date().toUTCString()}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
  ];
  const encoded =
    Buffer.from(input.body)
      .toString("base64")
      .match(/.{1,76}/g)
      ?.join("\r\n") || "";
  return Buffer.from(headers.join("\r\n") + "\r\n\r\n" + encoded).toString(
    "base64url",
  );
}
export class GoogleGmailProvider implements GmailProvider {
  constructor(
    private userId: string,
    private vault: CalendarVault = new EncryptedCalendarVault(),
    private fetcher: typeof fetch = fetch,
    private accessToken?: () => Promise<string>,
  ) {}
  private key() {
    return "gmail:connection:" + this.userId;
  }
  async status() {
    const configured = gmailConfigured(),
      c = configured ? await this.vault.read<Connection>(this.key()) : null;
    return {
      configured,
      connected: !!c,
      writable: c?.writable || false,
      connection_id: c?.id || null,
      account: c?.account || null,
    };
  }
  private async connected<T>(
    connectionId: string | undefined,
    write: boolean,
    work: (
      get: (path: string, init?: RequestInit) => Promise<unknown>,
      c: Connection,
    ) => Promise<T>,
  ) {
    return this.vault.lock(this.key(), async () => {
      const c = await this.vault.read<Connection>(this.key());
      if (!c) throw new AppError("Connect Gmail first", 409);
      if (connectionId && connectionId !== c.id)
        throw new AppError("Gmail account changed. Review a new request.", 409);
      if (write && !c.writable)
        throw new AppError("Gmail send consent is not enabled", 403);
      let token: string;
      try {
        if (this.accessToken) token = await this.accessToken();
        else {
          const auth = gmailClient();
          auth.setCredentials({ refresh_token: c.refresh_token });
          token = (await auth.getAccessToken()).token!;
          if (!token) throw new Error();
        }
      } catch {
        throw new AppError(
          "Gmail authorization failed; reconnect your account",
          401,
        );
      }
      const get = async (path: string, init: RequestInit = {}) => {
        try {
          const response = await this.fetcher(
            "https://gmail.googleapis.com/gmail/v1/users/me" + path,
            {
              ...init,
              headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
              },
              signal: AbortSignal.timeout(15000),
              redirect: "error",
              cache: "no-store",
            },
          );
          if (!response.ok)
            throw new AppError(
              `Gmail request failed (${response.status}). Inspect the action before retrying.`,
              502,
            );
          return await boundedJson(response);
        } catch (e) {
          if (e instanceof AppError) throw e;
          throw new AppError(
            "Gmail request failed or timed out; any send may be uncertain",
            502,
          );
        }
      };
      return work(get, c);
    });
  }
  async search(input: { query: string; page?: string }) {
    return this.connected(undefined, false, async (get, c) => {
      const q = new URLSearchParams({
        q: input.query,
        maxResults: "12",
        ...(input.page ? { pageToken: input.page } : {}),
      });
      const value = (await get("/threads?" + q)) as {
        threads?: { id: string; snippet?: string }[];
        nextPageToken?: string;
      };
      return {
        connection_id: c.id,
        threads: (value.threads || []).map((t) => ({
          id: t.id,
          snippet: t.snippet || "Conversation",
        })),
        next_page: value.nextPageToken || null,
      };
    });
  }
  async thread(input: {
    connection_id: string;
    thread_id: string;
  }): Promise<MailThread> {
    return this.connected(input.connection_id, false, async (get, c) => {
      const raw = (await get(
        "/threads/" + encodeURIComponent(input.thread_id) + "?format=full",
      )) as { id: string; messages?: RawMessage[] };
      const selected = (raw.messages || []).slice(-12);
      let remaining = 40000;
      const messages = selected.map((m) => {
        const parsed = normalizeMail(m, Math.min(12000, remaining));
        remaining -= parsed.text.length;
        return parsed;
      });
      return {
        id: raw.id,
        connection_id: c.id,
        account: c.account,
        messages,
        truncated:
          (raw.messages?.length || 0) > 12 || messages.some((m) => m.truncated),
      };
    });
  }
  async send(raw: z.infer<typeof gmailSendInput>) {
    const input = gmailSendInput.parse(raw);
    return this.connected(input.connection_id, true, async (get, c) => {
      if (input.from_account !== c.account)
        throw new AppError(
          "The reviewed sending account does not match the connected Gmail account",
          409,
        );
      const key = `gmail:send:${this.userId}:${c.id}:${input.operation_id}`;
      const hash = createHash("sha256")
        .update(
          JSON.stringify([
            input.to,
            input.cc,
            input.subject,
            input.body,
            input.source_thread_id,
          ]),
        )
        .digest("hex");
      const messageId = `ary-${createHash("sha256").update(key).digest("hex")}@ary-nexus.local`;
      type Receipt = {
        digest: string;
        state: "sending" | "sent";
        message_id?: string;
        thread_id?: string;
      };
      const old = await this.vault.read<Receipt>(key);
      if (old) {
        if (old.digest !== hash)
          throw new AppError(
            "This send operation already belongs to different recipients or text",
            409,
          );
        if (old.state === "sent")
          return {
            message_id: old.message_id!,
            thread_id: old.thread_id!,
            recovered: true,
          };
        const found = (await get(
          "/messages?" +
            new URLSearchParams({
              q: `in:sent rfc822msgid:${messageId}`,
              maxResults: "2",
            }),
        )) as { messages?: { id: string; threadId: string }[] };
        if (found.messages?.length === 1) {
          const sent = found.messages[0];
          await this.vault.write(key, {
            digest: hash,
            state: "sent",
            message_id: sent.id,
            thread_id: sent.threadId,
          });
          return {
            message_id: sent.id,
            thread_id: sent.threadId,
            recovered: true,
          };
        }
        throw new AppError(
          "Send status is uncertain. No resend was attempted. Check Gmail Sent before creating any new send operation.",
          409,
        );
      }
      // Persist the guard BEFORE network dispatch. Gmail has no transaction with Ary's receipt store.
      await this.vault.write(key, { digest: hash, state: "sending" });
      const sent = (await get("/messages/send", {
        method: "POST",
        body: JSON.stringify({ raw: encodeMail(input, c.account, messageId) }),
      })) as { id?: string; threadId?: string };
      if (!sent.id || !sent.threadId)
        throw new AppError(
          "Gmail did not return a complete send receipt. Status is uncertain.",
          502,
        );
      await this.vault.write(key, {
        digest: hash,
        state: "sent",
        message_id: sent.id,
        thread_id: sent.threadId,
      });
      return {
        message_id: sent.id,
        thread_id: sent.threadId,
        recovered: false,
      };
    });
  }
}
