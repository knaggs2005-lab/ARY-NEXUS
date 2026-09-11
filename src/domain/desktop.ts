import { z } from "zod";
import type { Json } from "./models";

// Names are identifiers, never programs, script fragments or filesystem paths.
export const desktopAppId = z
  .string()
  .min(3)
  .max(200)
  .regex(
    /^[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)+$/,
    "Invalid application ID; select a scanned app",
  );
const operation = { operation_id: z.uuid() };
const text = z
  .string()
  .max(16000)
  .refine((v) => !v.includes("\0"));
export const desktopSchemas = {
  list_apps: z.object({}).strict(),
  launch_app: z.object({ ...operation, app_id: desktopAppId }).strict(),
  open_website: z
    .object({
      ...operation,
      url: z
        .string()
        .max(2048)
        .url()
        .refine((v) => {
          const u = new URL(v);
          return (
            ["https:", "http:"].includes(u.protocol) &&
            !u.username &&
            !u.password
          );
        }, "Only HTTP(S) websites without credentials are allowed"),
    })
    .strict(),
  media: z
    .object({
      ...operation,
      player: z.enum(["music", "spotify"]),
      command: z.enum(["play", "pause", "next", "previous"]),
    })
    .strict(),
  volume: z
    .object({ ...operation, level: z.number().int().min(0).max(100) })
    .strict(),
  clipboard_read: z.object({}).strict(),
  clipboard_write: z.object({ ...operation, text }).strict(),
  hide_others: z.object({ ...operation, app_id: desktopAppId }).strict(),
  quit_app: z.object({ ...operation, app_id: desktopAppId }).strict(),
  lock_screen: z.object(operation).strict(),
  sleep_display: z.object(operation).strict(),
  do_not_disturb: z.object({ ...operation, enabled: z.boolean() }).strict(),
  create_note: z
    .object({
      ...operation,
      title: z.string().trim().min(1).max(300),
      body: text,
    })
    .strict(),
  create_reminder: z
    .object({
      ...operation,
      title: z.string().trim().min(1).max(300),
      notes: text,
      due_at: z.iso.datetime({ offset: true }).optional(),
    })
    .strict(),
};
export type DesktopVerb = keyof typeof desktopSchemas;
export interface InstalledApp {
  id: string;
  name: string;
  path: string;
}
export interface DesktopProvider {
  assertAvailable(): void;
  execute(verb: DesktopVerb, input: Record<string, unknown>): Promise<Json>;
}
