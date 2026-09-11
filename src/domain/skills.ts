import { z } from "zod";
import { planStep, planSpec, type PlanSpec } from "./orchestration";
const name = z.string().regex(/^[a-z][a-z0-9_]{0,29}$/);
export const skillDefinition = z
  .object({
    title: z.string().trim().min(3).max(160),
    instructions: z.string().trim().min(3).max(4000),
    inputs: z
      .array(
        z
          .object({
            name,
            description: z.string().max(300),
            type: z.enum(["string", "number", "boolean"]),
            required: z.boolean(),
          })
          .strict(),
      )
      .max(12),
    outputs: z
      .array(
        z
          .object({
            name,
            step: z.string().max(40),
            path: z.array(name).max(8),
            description: z.string().max(300),
          })
          .strict(),
      )
      .max(12),
    success_criteria: z.array(z.string().min(3).max(300)).min(1).max(12),
    permissions: z.array(z.string().min(1).max(100)).max(24),
    steps: z
      .array(
        planStep.extend({ repeat: z.number().int().min(1).max(3).default(1) }),
      )
      .min(1)
      .max(12),
    subskills: z
      .array(
        z
          .object({ skill_id: z.uuid(), version: z.number().int().positive() })
          .strict(),
      )
      .max(3),
  })
  .strict()
  .superRefine((s, c) => {
    if (
      new Set(s.inputs.map((i) => i.name)).size !== s.inputs.length ||
      new Set(s.outputs.map((i) => i.name)).size !== s.outputs.length
    )
      c.addIssue({
        code: "custom",
        message: "Input/output names must be unique",
      });
    const p = planSpec.safeParse({
      title: s.title,
      steps: s.steps.map(({ repeat, ...step }) => step),
      questions: [],
    });
    if (!p.success)
      c.addIssue({
        code: "custom",
        message: "Invalid workflow dependency order",
      });
  });
export type SkillDefinition = z.infer<typeof skillDefinition>;
export interface SkillVersion {
  version: number;
  definition: SkillDefinition;
  compiled: PlanSpec;
  output_bindings: SkillDefinition["outputs"];
  hash: string;
  created_at: string;
  source_message_id: string | null;
  action_id: string;
  approval_action_id: string | null;
  approved_at: string | null;
}
export interface SkillRecord {
  id: string;
  revision: number;
  versions: SkillVersion[];
}
export const automationDefinition = z
  .object({
    title: z.string().min(3).max(160),
    target: z.discriminatedUnion("kind", [
      z
        .object({
          kind: z.literal("skill"),
          id: z.uuid(),
          version: z.number().int().positive(),
          inputs: z.record(
            name,
            z.union([z.string().max(2000), z.number().finite(), z.boolean()]),
          ),
        })
        .strict(),
      z
        .object({
          kind: z.literal("mission"),
          id: z.uuid(),
          revision: z.number().int().nonnegative(),
        })
        .strict(),
    ]),
    trigger: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("manual") }).strict(),
      z
        .object({
          kind: z.literal("interval"),
          minutes: z.number().int().min(15).max(10080),
          starts_at: z.iso.datetime(),
        })
        .strict(),
    ]),
  })
  .strict();
export type AutomationDefinition = z.infer<typeof automationDefinition>;
export interface AutomationRecord {
  id: string;
  definition: AutomationDefinition;
  spec: PlanSpec;
  enabled: boolean;
  revision: number;
  approval_action_id: string | null;
}
/** Fixed scalar bindings. No expressions, scripts, prototype paths, or policy mutations. */
export function bindSkillInputs(
  value: unknown,
  inputs: Record<string, unknown>,
  depth = 0,
): unknown {
  if (depth > 24) throw new Error("Skill input nesting exceeds limit");
  if (Array.isArray(value))
    return value.map((v) => bindSkillInputs(v, inputs, depth + 1));
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    if ("$input" in o) {
      if (
        Object.keys(o).length !== 1 ||
        typeof o.$input !== "string" ||
        !Object.hasOwn(inputs, o.$input)
      )
        throw new Error("Missing or invalid skill input");
      return inputs[o.$input];
    }
    return Object.fromEntries(
      Object.entries(o).map(([k, v]) => {
        if (["__proto__", "constructor", "prototype"].includes(k))
          throw new Error("Unsafe input field");
        return [k, bindSkillInputs(v, inputs, depth + 1)];
      }),
    );
  }
  return value;
}
export function skillExamples(): SkillDefinition[] {
  const rows = [
    [
      "Clevaryn prospecting",
      "Sales Ary",
      "Review supplied prospect evidence for Clevaryn. Identify qualified leads and propose follow-ups. Never invent prospects or contact anyone.",
    ],
    [
      "Client onboarding",
      "CEO Ary",
      "Review client commitments and propose an onboarding checklist, owners and missing information.",
    ],
    [
      "Content pipeline",
      "CMO Ary",
      "Review the content brief and propose research, production, review and publishing milestones. Do not publish.",
    ],
    [
      "Research",
      "Research Ary",
      "Investigate the supplied research question using available shared evidence. Distinguish findings, uncertainties and missing sources.",
    ],
    [
      "Podcast preparation",
      "Developer Ary",
      "Review podcast equipment and preparation requirements. Identify missing configuration and propose readiness checks; do not claim devices are ready without telemetry.",
    ],
    [
      "Morning briefing",
      "Analyst Ary",
      "Review current goals, blockers and commitments using shared memory. Produce a concise prioritized morning brief with evidence and uncertainty.",
    ],
  ];
  const examples: SkillDefinition[] = rows.map(
    ([title, role, instructions]) => ({
      title,
      instructions,
      inputs: [
        {
          name: "brief",
          description: "Evidence, scope and expected result",
          type: "string",
          required: true,
        },
      ],
      outputs: [
        {
          name: "findings",
          step: "review",
          path: ["result"],
          description: "Advisory findings from shared Ary memory",
        },
      ],
      success_criteria: [
        "Findings identify supporting evidence and missing information; user reviews proposed next steps.",
      ],
      permissions: ["mission.agent"],
      steps: [
        {
          id: "review",
          title: "Review evidence and prepare findings",
          tool: "mission.agent",
          input: { role, objective: { $input: "brief" } },
          depends_on: [],
          critical: true,
          missing: [],
          source_action_from: null,
          verification: null,
          repeat: 1,
        },
      ],
      subskills: [],
    }),
  );
  for (const e of examples) {
    e.steps.push({
      ...e.steps[0],
      id: "synthesize",
      title: "Review findings and identify the next decision",
      input: {
        role: "Analyst Ary",
        objective: { $from: "review", path: ["result", "summary"] },
      },
      depends_on: ["review"],
    });
    e.outputs[0].step = "synthesize";
  }
  const podcast = examples[4];
  podcast.inputs = [];
  podcast.permissions = ["studio.inspect", "studio.plan_scene"];
  podcast.steps = [
    {
      ...podcast.steps[0],
      id: "inspect",
      title: "Check configured podcast equipment",
      tool: "studio.inspect",
      input: { scene: "podcast" },
    },
    {
      ...podcast.steps[0],
      id: "prepare",
      title: "Prepare an exact scene proposal for review",
      tool: "studio.plan_scene",
      input: { scene: "podcast" },
      depends_on: ["inspect"],
    },
  ];
  podcast.outputs = [
    {
      name: "scene_plan",
      step: "prepare",
      path: ["result"],
      description:
        "Evidence-backed proposal; applying devices remains a separately approved Studio action",
    },
  ];
  podcast.success_criteria = [
    "Inspect actual device telemetry and produce an exact scene plan. Configuration gaps must remain visible; no claim of physical readiness without verification.",
  ];
  return examples;
}
