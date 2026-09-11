import { z } from "zod";
import type { Json } from "./models";
import { desktopAppId } from "./desktop";
export const controlKeys = [
  "Tab",
  "Shift+Tab",
  "Enter",
  "Escape",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Space",
  "Backspace",
] as const;
export const controlVerbs = [
  "click",
  "fill",
  "select",
  "check",
  "key",
  "focus_window",
  "download",
  "upload",
] as const;
const target = {
  snapshot_id: z.uuid(),
  element_id: z.string().min(1).max(120),
};
export const controlAction = z
  .object({
    ...target,
    verb: z.enum(controlVerbs),
    value: z
      .string()
      .max(8000)
      .refine((v) => !v.includes("\0"))
      .optional(),
    key: z.enum(controlKeys).optional(),
    checked: z.boolean().optional(),
    file_id: z
      .string()
      .regex(/^[a-zA-Z0-9][a-zA-Z0-9._ -]{0,150}$/)
      .optional(),
  })
  .strict()
  .superRefine((v, c) => {
    if (["fill", "select"].includes(v.verb) && v.value === undefined)
      c.addIssue({ code: "custom", message: "Value required" });
    if (v.verb === "key" && !v.key)
      c.addIssue({ code: "custom", message: "Key required" });
    if (v.verb === "check" && v.checked === undefined)
      c.addIssue({ code: "custom", message: "Checked state required" });
    if (v.verb === "upload" && !v.file_id)
      c.addIssue({
        code: "custom",
        message: "A listed transfer file is required",
      });
  });
export type ControlAction = z.infer<typeof controlAction>;
export interface ControlElement {
  id: string;
  role: string;
  subrole?: string;
  label: string;
  value?: string;
  actions: string[];
  protected?: boolean;
  bounds?: { x: number; y: number; width: number; height: number };
}
export interface ControlSnapshot {
  id: string;
  surface: "browser" | "computer";
  target_id: string;
  title: string;
  text_preview?: string;
  observed_at: string;
  expires_at: string;
  elements: ControlElement[];
  truncated: boolean;
}
export const controlSchemas = {
  "browser.open": z.object({ url: z.url().max(2048) }).strict(),
  "browser.inspect": z.object({ session_id: z.uuid() }).strict(),
  "browser.act": controlAction,
  "browser.close": z.object({ session_id: z.uuid() }).strict(),
  "computer.inspect": z.object({ app_id: desktopAppId }).strict(),
  "computer.act": controlAction,
  "computer.propose_visual": z
    .object({ ...target, question: z.string().trim().min(1).max(1000) })
    .strict(),
  "computer.visual_click": z
    .object({
      proposal_id: z.uuid(),
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1),
    })
    .strict(),
  "control.files": z.object({}).strict(),
};
export interface DigitalControlProvider {
  assertAvailable(): void;
  inspect(target: string, signal?: AbortSignal): Promise<ControlSnapshot>;
  act(input: ControlAction, signal?: AbortSignal): Promise<Json>;
}
export interface BrowserControlProvider extends DigitalControlProvider {
  open(url: string, signal?: AbortSignal): Promise<ControlSnapshot>;
  close(id: string): Promise<Json>;
}
export const visualControlProposal = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    reason: z.string().min(1).max(1000),
    confidence: z.number().min(0).max(1),
  })
  .strict();
export type VisualControlProposal = z.infer<typeof visualControlProposal>;
export interface VisualControlProvider {
  propose(
    question: string,
    image: Buffer,
    signal?: AbortSignal,
  ): Promise<VisualControlProposal>;
}
