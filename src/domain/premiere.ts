import { z } from "zod";
import type { Json } from "./models";
const id = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z0-9{}:_-]+$/);
const name = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[^\x00-\x1f/\\]+$/);
const path = z
  .string()
  .min(2)
  .max(2048)
  .regex(/^\/[^\x00-\x1f]+$/);
export const premiereVerbs = [
  "open_project",
  "open_sequence",
  "create_sequence",
  "import_media",
  "create_bin",
  "rename_bin",
  "select_clips",
  "create_markers",
  "create_selects",
  "jump_timecode",
  "export_sequence",
  "save_project",
  "set_clips_enabled",
  "remove_clips",
] as const;
export type PremiereVerb = (typeof premiereVerbs)[number];
export const premiereArguments = {
  open_project: z.object({ path }).strict(),
  open_sequence: z.object({ sequence_id: id }).strict(),
  create_sequence: z.object({ name, preset_path: path }).strict(),
  import_media: z
    .object({ paths: z.array(path).min(1).max(100), bin_id: id })
    .strict(),
  create_bin: z.object({ name, parent_id: id }).strict(),
  rename_bin: z.object({ bin_id: id, name }).strict(),
  select_clips: z.object({ clip_ids: z.array(id).min(1).max(100) }).strict(),
  create_markers: z
    .object({
      markers: z
        .array(
          z
            .object({
              name,
              seconds: z.number().min(0).max(86400),
              comments: z.string().max(2000).default(""),
            })
            .strict(),
        )
        .min(1)
        .max(100),
    })
    .strict(),
  create_selects: z
    .object({ name, media_ids: z.array(id).min(1).max(100), bin_id: id })
    .strict(),
  jump_timecode: z
    .object({ timecode: z.string().regex(/^\d{2}:[0-5]\d:[0-5]\d:\d{2}$/) })
    .strict(),
  export_sequence: z.object({ preset_path: path, output_path: path }).strict(),
  save_project: z.object({}).strict(),
  set_clips_enabled: z
    .object({ clip_ids: z.array(id).min(1).max(100), enabled: z.boolean() })
    .strict(),
  remove_clips: z
    .object({ clip_ids: z.array(id).min(1).max(100), ripple: z.literal(false) })
    .strict(),
};
export const premiereState = z
  .object({
    revision: id,
    project_id: id.nullable(),
    project_name: z.string().max(500),
    project_path: z.string().max(2048),
    sequence_id: id.nullable(),
    sequences: z
      .array(z.object({ id, name: z.string().max(500) }).strict())
      .max(500),
    items: z
      .array(
        z
          .object({
            id,
            name: z.string().max(500),
            parent_id: id.nullable(),
            kind: z.enum(["bin", "media"]),
            media_path: z.string().max(2048).optional(),
            offline: z.boolean().optional(),
          })
          .strict(),
      )
      .max(2000),
    clips: z
      .array(
        z
          .object({
            id,
            name: z.string().max(500),
            start: z.string().max(30),
            end: z.string().max(30),
            source_id: id.optional(),
            source_in: z.string().max(30).optional(),
            source_out: z.string().max(30).optional(),
            track_kind: z.enum(["video", "audio"]).optional(),
            track_index: z.number().int().min(0).max(99).optional(),
            disabled: z.boolean().optional(),
            locked: z.boolean().optional(),
          })
          .strict(),
      )
      .max(2000),
    complete: z.boolean(),
    supported_verbs: z.array(z.enum(premiereVerbs)).max(30).optional(),
    timebase: z.string().regex(/^\d+$/).max(30).optional(),
    ticks_per_second: z.literal("254016000000").optional(),
  })
  .strict();
export type PremiereState = z.infer<typeof premiereState>;
export const premierePlanInput = z
  .object({
    verb: z.enum(premiereVerbs),
    args: z.record(z.string(), z.unknown()),
  })
  .strict();
export const premiereExecution = z
  .object({
    operation_id: z.uuid(),
    expected_revision: id,
    args: z.record(z.string(), z.unknown()),
  })
  .strict();
export type PremiereExecution = z.infer<typeof premiereExecution>;
export interface PremiereAdapter {
  assertAvailable(): void;
  inspect(): Promise<PremiereState>;
  execute(
    verb: PremiereVerb,
    input: PremiereExecution,
    actionId: string,
  ): Promise<Json>;
}
/** Compatibility name retained for existing adapters and callers. */
export type PremiereProvider = PremiereAdapter;
export function validatePremierePlan(
  verb: PremiereVerb,
  args: Json,
  state: PremiereState,
) {
  premiereArguments[verb].parse(args);
  if (!state.complete)
    throw Error(
      "Premiere inventory is incomplete; narrow the project before planning actions.",
    );
  if (verb !== "open_project" && !state.project_id)
    throw Error("Open a Premiere project first.");
  if (
    [
      "set_clips_enabled",
      "remove_clips",
      "select_clips",
      "create_markers",
      "jump_timecode",
      "export_sequence",
    ].includes(verb) &&
    !state.sequence_id
  )
    throw Error("Open the intended sequence first.");
  for (const key of ["bin_id", "parent_id"])
    if (
      args[key] &&
      !state.items.some((i) => i.id === args[key] && i.kind === "bin")
    )
      throw Error("The selected bin is not in the current project.");
  if (
    args.sequence_id &&
    !state.sequences.some((s) => s.id === args.sequence_id)
  )
    throw Error("Sequence is no longer available.");
  for (const media of (args.media_ids as string[] | undefined) ?? [])
    if (!state.items.some((i) => i.id === media && i.kind === "media"))
      throw Error("Selected media is not in the current project.");
  for (const clip of (args.clip_ids as string[] | undefined) ?? [])
    if (!state.clips.some((i) => i.id === clip))
      throw Error("Selected clip is not in the active sequence.");
  if (
    ["create_sequence", "create_selects"].includes(verb) &&
    state.sequences.some((s) => s.name === args.name)
  )
    throw Error("A sequence with that name already exists.");
  if (state.supported_verbs && !state.supported_verbs.includes(verb))
    throw Error(
      "This Premiere host does not support the requested native operation.",
    );
  if (["set_clips_enabled", "remove_clips"].includes(verb)) {
    if (!state.supported_verbs?.includes(verb))
      throw Error(
        "Update and reconnect the UXP bridge before timeline changes.",
      );
    const ids = args.clip_ids as string[];
    if (new Set(ids).size !== ids.length)
      throw Error("Choose each clip only once.");
    if (ids.some((id) => state.clips.find((c) => c.id === id)?.locked === true))
      throw Error("Track is locked.");
    return `Premiere ${verb} in ${state.project_name}, sequence ${state.sequence_id}. Exact clips: ${JSON.stringify(state.clips.filter((c) => ids.includes(c.id)))}. ${verb === "remove_clips" ? "Remove only these timeline instances without ripple; leaves gaps. Linked audio/video not selected remains unchanged. Source files are not deleted." : `Set enabled=${args.enabled} only on the selected instances.`} Native undoable transaction; inspect result before any retry. Revision ${state.revision}.`;
  }
  return `Premiere ${verb.replaceAll("_", " ")} in ${state.project_name || "the selected project"}. Inputs: ${JSON.stringify(args)}. Revalidate revision ${state.revision} before execution. Existing timeline clips will not be deleted, moved or trimmed.`;
}
