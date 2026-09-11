import { z } from "zod";
import type { Json } from "./models";
const id = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z0-9:_-]+$/);
const path = z
  .string()
  .max(2048)
  .regex(/^\/[^\x00-\x1f]+$/);
const dimensions = z.tuple([
  z.number().positive().max(100000),
  z.number().positive().max(100000),
  z.number().positive().max(100000),
]);
export const designVerbs = [
  "open_document",
  "select_object",
  "create_object",
  "modify_dimensions",
  "change_property",
  "export",
  "save",
  "undo",
  "preview",
] as const;
export type DesignVerb = (typeof designVerbs)[number];
export const designArguments = {
  open_document: z.object({ path }).strict(),
  select_object: z.object({ object_id: id }).strict(),
  create_object: z
    .object({
      kind: z.literal("box"),
      name: z
        .string()
        .trim()
        .min(1)
        .max(100)
        .regex(/^[^\x00-\x1f]+$/),
      dimensions_mm: dimensions,
    })
    .strict(),
  modify_dimensions: z
    .object({ object_id: id, dimensions_mm: dimensions })
    .strict(),
  change_property: z
    .object({
      object_id: id,
      property: z.literal("display_color"),
      rgb: z.tuple([
        z.number().min(0).max(1),
        z.number().min(0).max(1),
        z.number().min(0).max(1),
      ]),
    })
    .strict(),
  export: z.object({ path, format: z.enum(["obj", "step"]) }).strict(),
  save: z.object({ path }).strict(),
  undo: z.object({ undo_token: id }).strict(),
  preview: z.object({ mode: z.literal("viewport") }).strict(),
};
export const designState = z
  .object({
    adapter: z.string().min(1).max(100),
    revision: id,
    document_id: id.nullable(),
    document_name: z.string().max(500),
    document_path: z.string().max(2048),
    mm_per_unit: z.number().positive().nullable(),
    complete: z.boolean(),
    safe_scene: z.boolean(),
    undo_token: id.nullable(),
    export_formats: z.array(z.enum(["obj", "step"])).max(2),
    objects: z
      .array(
        z
          .object({
            id,
            name: z.string().max(500),
            kind: z.string().max(100),
            dimensions_mm: dimensions.nullable(),
            selected: z.boolean(),
            editable: z.boolean(),
          })
          .strict(),
      )
      .max(200),
  })
  .strict();
export type DesignState = z.infer<typeof designState>;
export const designExecution = z
  .object({
    operation_id: z.uuid(),
    expected_revision: id,
    args: z.record(z.string(), z.unknown()),
  })
  .strict();
export type DesignExecution = z.infer<typeof designExecution>;
/** Application-neutral port; adapters declare capabilities and reject unsupported operations. */
export interface DesignTool {
  assertAvailable(): void;
  inspect(): Promise<DesignState>;
  execute(
    verb: DesignVerb,
    input: DesignExecution,
    actionId: string,
  ): Promise<Json>;
}
export function validateDesignPlan(
  verb: DesignVerb,
  args: Json,
  state: DesignState,
) {
  designArguments[verb].parse(args);
  if (!state.complete) throw Error("Design inventory is incomplete");
  if (verb !== "open_document" && (!state.document_id || !state.safe_scene))
    throw Error(
      "Open a supported document without expressions, animation, materials or unsupported geometry",
    );
  if (
    args.object_id &&
    !state.objects.some(
      (o) =>
        o.id === args.object_id && (verb === "select_object" || o.editable),
    )
  )
    throw Error("Object is missing or not editable by this adapter");
  if (
    ["create_object", "modify_dimensions"].includes(verb) &&
    !state.mm_per_unit
  )
    throw Error("Document unit conversion is unknown");
  if (
    verb === "export" &&
    !state.export_formats.includes(args.format as "obj" | "step")
  )
    throw Error(`Adapter does not support ${args.format} export`);
  if (verb === "undo" && args.undo_token !== state.undo_token)
    throw Error(
      "Only the latest unchanged Ary geometry/property edit can be undone",
    );
  return `${state.adapter}: ${verb.replaceAll("_", " ")} in ${state.document_name || "the selected document"}. Exact inputs: ${JSON.stringify(args)}. Dimensions are local, in millimeters. Validate revision ${state.revision} again before execution. All changes require approval.`;
}
