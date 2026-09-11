import { z } from "zod";
const instant = z.iso.datetime({ offset: true });
export const calendarWindow = z
  .object({ start: instant, end: instant, connection_id: z.uuid().optional() })
  .strict();
export function validWindow(start: string, end: string, days = 31) {
  const duration = Date.parse(end) - Date.parse(start);
  return duration > 0 && duration <= days * 86400000;
}
export const calendarEventFields = z
  .object({
    summary: z.string().trim().min(1).max(300),
    description: z.string().max(4000).default(""),
    start: instant,
    end: instant,
    time_zone: z
      .string()
      .min(1)
      .max(100)
      .refine((value) => {
        try {
          new Intl.DateTimeFormat("en-US", { timeZone: value });
          return true;
        } catch {
          return false;
        }
      }, "Invalid time zone"),
  })
  .strict()
  .refine(
    (event) => validWindow(event.start, event.end, 7),
    "End must follow start, within seven days",
  );
export const calendarWriteInput = z
  .object({
    connection_id: z.uuid(),
    operation_id: z.uuid(),
    event: calendarEventFields,
  })
  .strict();
export const calendarUpdateInput = calendarWriteInput
  .extend({
    event_id: z.string().regex(/^[a-zA-Z0-9_-]{1,1024}$/),
    etag: z.string().min(1).max(500),
    before: calendarEventFields,
  })
  .strict();
export type CalendarFields = z.infer<typeof calendarEventFields>;
export type CalendarWrite = z.infer<typeof calendarWriteInput>;
export type CalendarUpdate = z.infer<typeof calendarUpdateInput>;
export interface CalendarEvent {
  id: string;
  etag: string;
  summary: string;
  description: string;
  start: string;
  end: string;
  all_day: boolean;
  time_zone: string;
  busy: boolean;
  editable: boolean;
  html_url: string | null;
  people: string[];
  entity_ids: string[];
  operation_id?: string;
  operation_digest?: string;
}
export interface CalendarProvider {
  status(): Promise<{
    configured: boolean;
    connected: boolean;
    writable: boolean;
    connection_id: string | null;
    account: string | null;
    accounts?: { connection_id: string; account: string; writable: boolean }[];
  }>;
  list(window: z.infer<typeof calendarWindow>): Promise<{
    events: CalendarEvent[];
    complete: boolean;
    time_zone: string;
    connection_id: string;
    account?: string;
  }>;
  create(
    input: CalendarWrite,
    entityIds: string[],
  ): Promise<{ event: CalendarEvent; recovered: boolean }>;
  update(
    input: CalendarUpdate,
    entityIds: string[],
  ): Promise<{ event: CalendarEvent; recovered: boolean }>;
}
export function calendarConflicts(events: CalendarEvent[]) {
  const busy = events
    .filter((e) => e.busy)
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  const conflicts: { event_ids: string[]; start: string; end: string }[] = [];
  for (let i = 0; i < busy.length; i++)
    for (let j = i + 1; j < busy.length; j++) {
      const a = busy[i],
        b = busy[j];
      if (Date.parse(b.start) >= Date.parse(a.end)) break;
      if (Date.parse(a.start) < Date.parse(b.end))
        conflicts.push({
          event_ids: [a.id, b.id],
          start: new Date(
            Math.max(Date.parse(a.start), Date.parse(b.start)),
          ).toISOString(),
          end: new Date(
            Math.min(Date.parse(a.end), Date.parse(b.end)),
          ).toISOString(),
        });
    }
  return conflicts;
}
/** Explicit requested window only. No inferred work hours or cross-calendar availability. */
export function recommendBlocks(
  events: CalendarEvent[],
  start: string,
  end: string,
  minutes: number,
) {
  let cursor = Math.max(Date.parse(start), Date.now());
  const finish = Date.parse(end),
    duration = minutes * 60000;
  const blocks: { start: string; end: string; reason: string }[] = [];
  const busy = events
    .filter((e) => e.busy)
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  const add = (until: number) => {
    while (cursor + duration <= until && blocks.length < 3) {
      blocks.push({
        start: new Date(cursor).toISOString(),
        end: new Date(cursor + duration).toISOString(),
        reason:
          "No busy event in the complete primary-calendar result for this requested window. Other calendars are not checked.",
      });
      cursor += duration;
    }
  };
  for (const event of busy) {
    add(Math.min(Date.parse(event.start), finish));
    cursor = Math.max(cursor, Date.parse(event.end));
  }
  add(finish);
  return blocks;
}
