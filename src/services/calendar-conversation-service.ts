import type { Repository } from "../domain/repository";
import type { Message, Json } from "../domain/models";
import type { ActionService } from "./action-service";
import { ActionRequestService } from "./action-request-service";
import { AppError } from "../domain/validation";
import {
  midnightInZone,
  GoogleCalendarProvider,
} from "../infrastructure/calendar/google-calendar";
import { calendarConflicts, type CalendarProvider } from "../domain/calendar";
import type { CalendarService } from "./calendar-service";
/** Small explicit Calendar intent bridge. Scheduling writes are prepared in the reviewed Calendar form. */
export class CalendarConversationService {
  constructor(
    private repo: Repository,
    private actions: ActionService,
    private provider: Pick<
      CalendarProvider,
      "status"
    > = new GoogleCalendarProvider(repo.userId),
    private requests = new ActionRequestService(repo, actions),
  ) {}
  async handle(
    text: string,
    source: Message,
    zone = "UTC",
  ): Promise<{ content: string; metadata: Json } | null> {
    if (!/\b(calendars?|events|time blocks?|schedule)\b/i.test(text))
      return null;
    if (
      /\b(create|move|reschedule|update|change|book|add)\b|\bschedule\s+(?:an? |the )?(?:event|meeting|call|appointment|time block)\b/i.test(
        text,
      )
    )
      return {
        content:
          "Open Calendar in Nexus to prepare the event details or select an event to change. I’ll show the exact changes for approval before writing to Google.",
        metadata: { calendar_context: true },
      };
    if (
      !/\b(upcoming|next|today|tomorrow|conflicts?|free|available|show|read|what|recommend|suggest)\b/i.test(
        text,
      )
    )
      return null;
    const now = new Date(source.created_at);
    let start = now.toISOString(),
      end = new Date(now.getTime() + 7 * 86400000).toISOString();
    if (/\b(today|tomorrow)\b/i.test(text)) {
      const p = Object.fromEntries(
        new Intl.DateTimeFormat("en-CA", {
          timeZone: zone,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        })
          .formatToParts(now)
          .map((x) => [x.type, x.value]),
      );
      const date = new Date(`${p.year}-${p.month}-${p.day}T12:00:00Z`);
      if (/\btomorrow\b/i.test(text)) date.setUTCDate(date.getUTCDate() + 1);
      start = midnightInZone(date.toISOString().slice(0, 10), zone);
      date.setUTCDate(date.getUTCDate() + 1);
      end = midnightInZone(date.toISOString().slice(0, 10), zone);
    }
    try {
      const status = await this.provider.status();
      const accounts =
        status.accounts ??
        (status.connection_id && status.account
          ? [
              {
                connection_id: status.connection_id,
                account: status.account,
                writable: status.writable,
              },
            ]
          : []);
      if (!status.connected || !accounts.length)
        throw new AppError(
          "Connect Google Calendar in WORLD → Calendar first.",
        );
      const selected = selectAccounts(text, accounts);
      type Read = Awaited<ReturnType<CalendarService["read"]>>;
      const successes: { account: string; data: Read; actionId: string }[] = [];
      const failures: { account: string; error: string }[] = [];
      // The encrypted vault serializes reads per user; sequential requests also bound provider load.
      for (const account of selected) {
        try {
          const result = await this.requests.request({
            tool: "google_calendar.read",
            input: { start, end, connection_id: account.connection_id },
            reason: text.slice(0, 1000),
            conversation_id: source.conversation_id,
            source_message_id: source.id,
            request_key: `calendar-chat:${source.id}:${account.connection_id}`,
          });
          successes.push({
            account: account.account,
            data: result.result as unknown as Read,
            actionId: result.action_id,
          });
        } catch (e) {
          if (!(e instanceof AppError)) throw e;
          failures.push({ account: account.account, error: e.message });
        }
      }
      const events = successes
        .flatMap(({ account, data }) =>
          data.events.map((event) => ({
            ...event,
            account,
            connection_id: data.connection_id,
          })),
        )
        .sort(
          (a, b) =>
            Date.parse(a.start) - Date.parse(b.start) ||
            a.account.localeCompare(b.account),
        );
      const complete =
        failures.length === 0 && successes.every(({ data }) => data.complete);
      // IDs are only unique within an account. Namespace them before cross-account overlap checks.
      const conflicts = calendarConflicts(
        events.map((event) => ({
          ...event,
          id: `${event.connection_id}:${event.id}`,
        })),
      );
      const shown = events.slice(0, 16);
      const format = (value: string) =>
        new Date(value).toLocaleString("en-US", { timeZone: zone });
      return {
        content: `Primary-calendar context from ${format(start)} to ${format(end)} (${zone}):\n${successes.map(({ account, data }) => `Checked ${account}: ${data.events.length} events${data.complete ? "" : " (incomplete)"}.`).join("\n")}\n${
          shown
            .map(
              (event) =>
                `• [${event.account}] ${event.summary} — ${format(event.start)} to ${format(event.end)}`,
            )
            .join("\n") ||
          (successes.length
            ? "No events returned from the calendars checked."
            : "No calendars could be read.")
        }${events.length > shown.length ? `\nShowing the earliest ${shown.length} of ${events.length} events.` : ""}\n${failures.map(({ account, error }) => `Could not check ${account}: ${error}`).join("\n")}\n${conflicts.length} overlapping busy-event pairs across the calendars read.${complete ? " Only primary calendars were checked; shared and secondary calendars are not included." : " Results are incomplete; combined availability is unknown."} Open Calendar to inspect entity links or prepare an event for approval.`,
        metadata: {
          calendar_context: true,
          calendar_complete: complete,
          calendar_accounts: successes.map(({ account, data, actionId }) => ({
            account,
            connection_id: data.connection_id,
            event_count: data.events.length,
            complete: data.complete,
            action_id: actionId,
          })),
          calendar_failures: failures,
          calendar_events: shown.map((event) => ({
            id: event.id,
            summary: event.summary,
            account: event.account,
            connection_id: event.connection_id,
          })),
          calendar_conflicts: conflicts,
          calendar_action_id: successes[0]?.actionId ?? null,
          calendar_action_ids: successes.map(({ actionId }) => actionId),
        },
      };
    } catch (e) {
      if (e instanceof AppError)
        return {
          content: `I couldn’t read Google Calendar: ${e.message}`,
          metadata: { calendar_context: true, calendar_error: true },
        };
      throw e;
    }
  }
}

/** Conservative account targeting. Ambiguous role/domain matches ask for an exact email. */
function selectAccounts<T extends { account: string }>(
  text: string,
  accounts: T[],
): T[] {
  const emails = text.match(
    /[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
  );
  if (emails?.length) {
    const names = [...new Set(emails.map((email) => email.toLowerCase()))];
    if (
      names.some(
        (name) => !accounts.some((item) => item.account.toLowerCase() === name),
      )
    )
      throw new AppError(
        "One of those email accounts is not connected. Select a connected account in Calendar.",
      );
    return accounts.filter((item) =>
      names.includes(item.account.toLowerCase()),
    );
  }
  if (/\bboth\b/i.test(text)) return accounts;
  const personal = /\b(personal|gmail)\b/i.test(text);
  const work = /\b(work|business|company)\b/i.test(text);
  if (personal && work) return accounts;
  let matches: T[];
  if (personal || work) {
    matches = accounts.filter(
      (item) => /@(gmail|googlemail)\.com$/i.test(item.account) === personal,
    );
  } else {
    // Only an exact domain label qualifies; similar company names never select an account.
    const words: string[] = text.toLowerCase().match(/[a-z0-9-]+/g) ?? [];
    matches = accounts.filter((item) => {
      const domain = item.account.split("@")[1]?.toLowerCase();
      return (
        domain &&
        !/^(gmail|googlemail)\.com$/.test(domain) &&
        words.includes(domain.split(".")[0])
      );
    });
    if (!matches.length) return accounts;
  }
  if (matches.length !== 1)
    throw new AppError(
      "That calendar account is missing or ambiguous. Specify its exact email address, or ask for both calendars.",
    );
  return matches;
}
