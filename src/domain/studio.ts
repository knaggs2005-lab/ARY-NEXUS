import { z } from "zod";
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
export const studioKinds = [
  "light",
  "camera",
  "teleprompter",
  "display",
  "led_wall",
  "audio",
] as const;
export const studioCommand = z.discriminatedUnion("verb", [
  z
    .object({
      verb: z.literal("intensity"),
      value: z.number().int().min(0).max(1000),
    })
    .strict(),
  z
    .object({
      verb: z.literal("cct"),
      value: z.number().int().min(1800).max(20000),
    })
    .strict(),
  z.object({ verb: z.literal("sleep"), value: z.boolean() }).strict(),
  z.object({ verb: z.literal("preset"), value: id }).strict(),
]);
export const studioDevice = z
  .object({
    id,
    name: z.string().min(1).max(100),
    kind: z.enum(studioKinds),
    adapter: z.enum(["amaran", "home_assistant", "unconfigured"]),
    location_id: id.optional(),
    entity_id: z.uuid().optional(),
    position: z
      .object({ x: z.number().min(0).max(100), y: z.number().min(0).max(100) })
      .strict()
      .optional(),
    ha_entity_id: z
      .string()
      .regex(/^light\.[a-z0-9_]{1,100}$/)
      .optional(),
    node_id: id.optional(),
  })
  .strict();
export const studioStep = z
  .object({
    id,
    device_id: id,
    command: studioCommand,
    depends_on: z.array(id).max(20).default([]),
    required: z.boolean().default(true),
    verify: z
      .record(
        z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
        z.union([z.string().max(120), z.number().finite(), z.boolean()]),
      )
      .refine((v) => Object.keys(v).length > 0 && Object.keys(v).length <= 12)
      .optional(),
  })
  .strict();
export const studioLocation = z
  .object({
    id,
    name: z.string().min(1).max(100),
    kind: z.enum(["studio", "home", "office", "other"]),
    entity_id: z.uuid().optional(),
  })
  .strict();
export type StudioLocation = z.infer<typeof studioLocation>;
export const defaultLocations: StudioLocation[] = [
  { id: "studio", name: "Studio", kind: "studio" },
  { id: "home", name: "Home", kind: "home" },
  { id: "office", name: "Office", kind: "office" },
];
export const studioConfig = z
  .object({
    locations: z.array(studioLocation).min(1).max(30).optional(),
    devices: z.array(studioDevice).max(20),
    scenes: z
      .array(
        z
          .object({
            id,
            name: z.string().min(1).max(100),
            aliases: z.array(z.string().min(1).max(100)).max(10),
            steps: z.array(studioStep).min(1).max(30),
          })
          .strict(),
      )
      .max(10),
  })
  .strict()
  .superRefine((c, ctx) => {
    const unique = (ids: string[]) => new Set(ids).size === ids.length;
    const locations = c.locations ?? defaultLocations;
    const haIds = c.devices
      .filter((d) => d.adapter === "home_assistant")
      .map((d) => d.ha_entity_id);
    if (
      !unique(locations.map((l) => l.id)) ||
      c.devices.some(
        (d) => !locations.some((l) => l.id === (d.location_id ?? "studio")),
      ) ||
      haIds.some((v) => !v) ||
      !unique(haIds as string[]) ||
      c.devices.some(
        (d) => d.adapter === "home_assistant" && d.kind !== "light",
      )
    )
      ctx.addIssue({
        code: "custom",
        message: "Invalid location or Home Assistant device binding",
      });
    if (
      !unique(c.devices.map((d) => d.id)) ||
      !unique(c.scenes.map((s) => s.id))
    )
      ctx.addIssue({ code: "custom", message: "Duplicate studio IDs" });
    const nodes = c.devices
      .filter((d) => d.adapter === "amaran")
      .map((d) => d.node_id);
    if (nodes.some((n) => !n) || !unique(nodes as string[]))
      ctx.addIssue({
        code: "custom",
        message: "Amaran nodes must be explicit and unique",
      });
    for (const s of c.scenes) {
      const seen = new Set<string>();
      for (const step of s.steps) {
        if (
          seen.has(step.id) ||
          !c.devices.some((d) => d.id === step.device_id) ||
          step.depends_on.some((x) => !seen.has(x))
        )
          ctx.addIssue({
            code: "custom",
            message: "Invalid scene references/order",
          });
        seen.add(step.id);
      }
    }
  });
export type StudioConfig = z.infer<typeof studioConfig>;
export type StudioDevice = z.infer<typeof studioDevice>;
export type StudioCommand = z.infer<typeof studioCommand>;
export type StudioStep = z.infer<typeof studioStep>;
export type Observation = {
  device_id: string;
  observed_at: string;
  status: "available" | "unavailable";
  state: Record<string, string | number | boolean>;
  capabilities: string[];
  recovery?: "inspection_retried";
  detail: string;
};
export interface StudioAdapter {
  inspect(device: StudioDevice): Promise<Observation>;
  execute(
    device: StudioDevice,
    command: StudioCommand,
  ): Promise<{
    confirmation: "provider_acknowledged" | "observed";
    detail: string;
  }>;
}
export type StudioPlan = {
  version: 1;
  id: string;
  scene_id: string;
  scene_name: string;
  config_revision: string;
  created_at: string;
  observations: Observation[];
  steps: (StudioStep & {
    device_name: string;
    blocked_reason: string | null;
  })[];
  executable: boolean;
};
export type StudioReport = {
  plan_id: string;
  scene_id: string;
  action_id: string;
  status: "success" | "partial" | "failure" | "uncertain";
  started_at: string;
  finished_at: string;
  readiness?: SceneReadiness;
  steps: {
    id: string;
    device_id: string;
    status: "succeeded" | "failed" | "skipped" | "uncertain";
    detail: string;
    confirmation: string | null;
    timestamp: string;
  }[];
};
/** No exception means success. All non-proven transport failures are uncertain. */
export class StudioNotSent extends Error {}
export const defaultStudioConfig: StudioConfig = {
  devices: [
    {
      id: "key-light",
      name: "Key light",
      kind: "light",
      adapter: "unconfigured",
    },
    { id: "camera", name: "Camera", kind: "camera", adapter: "unconfigured" },
    {
      id: "audio",
      name: "Audio routing",
      kind: "audio",
      adapter: "unconfigured",
    },
  ],
  scenes: [
    {
      id: "podcast",
      name: "Podcast mode",
      aliases: ["podcast mode", "podcast"],
      steps: [
        {
          id: "key",
          device_id: "key-light",
          command: { verb: "intensity", value: 450 },
          depends_on: [],
          required: true,
        },
        {
          id: "camera",
          device_id: "camera",
          command: { verb: "preset", value: "podcast" },
          depends_on: [],
          required: true,
        },
        {
          id: "audio",
          device_id: "audio",
          command: { verb: "preset", value: "podcast" },
          depends_on: [],
          required: true,
        },
      ],
    },
    {
      id: "recording",
      name: "Recording setup",
      aliases: ["recording mode", "recording setup"],
      steps: [
        {
          id: "key",
          device_id: "key-light",
          command: { verb: "intensity", value: 600 },
          depends_on: [],
          required: true,
        },
        {
          id: "camera",
          device_id: "camera",
          command: { verb: "preset", value: "recording" },
          depends_on: [],
          required: true,
        },
      ],
    },
  ],
};

export interface SceneReadiness {
  scene_id: string;
  status: "ready" | "not_ready" | "unverified";
  checked_at: string;
  checks: {
    step_id: string;
    device_id: string;
    required: boolean;
    status: "matched" | "mismatch" | "unavailable" | "unverified";
    reason: string;
    observation: Observation | null;
  }[];
}
