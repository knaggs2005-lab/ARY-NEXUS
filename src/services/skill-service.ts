import { randomUUID } from "node:crypto";
import {
  skillDefinition,
  automationDefinition,
  bindSkillInputs,
  type SkillDefinition,
  type SkillRecord,
  type SkillVersion,
  type AutomationRecord,
  type AutomationDefinition,
} from "../domain/skills";
import {
  planSpec,
  type PlanSpec,
  type PlanStep,
  type ExecutionPlan,
} from "../domain/orchestration";
import type { Repository } from "../domain/repository";
import type {
  ToolRegistry,
  ToolExecutionContext,
} from "../domain/tool-registry";
import type { OrchestratorService } from "./orchestrator-service";
import { AppError, required } from "../domain/validation";
import { digest } from "./permission-service";
const SKILL = "nexus_skill_v1",
  AUTO = "nexus_automation_v1";
const forbidden =
  /^(?:permissions?\.|skills?\.|automation\.|orchestrator\.|agent\.|mission\.(?!agent$))/;
export class SkillService {
  constructor(
    private repo: Repository,
    private tools: ToolRegistry,
    private coordinator: OrchestratorService,
  ) {}
  async list() {
    return (await this.repo.list("messages"))
      .filter((m) => m.metadata[SKILL])
      .map((m) => m.metadata[SKILL] as unknown as SkillRecord);
  }
  async automations() {
    return (await this.repo.list("messages"))
      .filter((m) => m.metadata[AUTO])
      .map((m) => m.metadata[AUTO] as unknown as AutomationRecord);
  }
  async get(id: string) {
    const m = required(await this.repo.get("messages", id), "Skill");
    if (!m.metadata[SKILL]) throw new AppError("Not a skill", 404);
    return {
      record: m,
      skill: structuredClone(m.metadata[SKILL] as unknown as SkillRecord),
    };
  }
  async version(id: string, version: number, approved = true) {
    const { skill } = await this.get(id);
    const v = required(
      skill.versions.find((v) => v.version === version) ?? null,
      "Skill version",
    );
    if (approved && !v.approved_at)
      throw new AppError("Skill version requires explicit review", 409);
    return v;
  }
  private authority(spec: PlanSpec, permissions: string[]) {
    const names = new Set(
      spec.steps.flatMap((s) => [
        s.tool,
        ...(s.verification ? [s.verification.tool] : []),
      ]),
    );
    const registered = new Set(this.tools.describe().map((t) => t.name));
    for (const n of names)
      if (forbidden.test(n) || !registered.has(n) || !permissions.includes(n))
        throw new AppError(
          `Skill tool is unavailable or outside its declared scope: ${n}`,
          403,
        );
    if (permissions.some((n) => !names.has(n)))
      throw new AppError("Remove unused permission declarations", 400);
  }
  async compile(def: SkillDefinition) {
    let steps: PlanStep[] = [];
    // Expansion uses safe generated IDs, serial joins and pinned immutable subskill snapshots.
    const append = (
      spec: PlanSpec,
      prefix: string,
      repeats: Record<string, number> = {},
    ) => {
      const ids = new Map<string, string>();
      const before = steps.map((s) => s.id);
      for (const s of spec.steps) {
        let prior: string | undefined;
        for (let iteration = 0; iteration < (repeats[s.id] ?? 1); iteration++) {
          const id = `${prefix}${steps.length}`;
          const lookup = (key: string) =>
            key === s.id ? id : (ids.get(key) ?? key);
          const rewrite = (v: unknown): unknown =>
            Array.isArray(v)
              ? v.map(rewrite)
              : v && typeof v === "object"
                ? Object.fromEntries(
                    Object.entries(v).map(([k, x]) => [
                      k,
                      k === "$from" && typeof x === "string"
                        ? lookup(x)
                        : rewrite(x),
                    ]),
                  )
                : v;
          steps.push({
            ...s,
            id,
            input: rewrite(s.input) as Record<string, unknown>,
            depends_on: [
              ...new Set([
                ...s.depends_on.map(lookup),
                ...(prior ? [prior] : before),
              ]),
            ],
            source_action_from: s.source_action_from
              ? lookup(s.source_action_from)
              : null,
            when: s.when ? { ...s.when, step: lookup(s.when.step) } : undefined,
            verification: s.verification
              ? {
                  ...s.verification,
                  input: rewrite(s.verification.input) as Record<
                    string,
                    unknown
                  >,
                }
              : null,
          });
          prior = id;
        }
        ids.set(s.id, prior!);
      }
      return ids;
    };
    for (const sub of def.subskills) {
      const v = await this.version(sub.skill_id, sub.version);
      if (v.definition.inputs.length)
        throw new AppError(
          "Subskills must have bound inputs before composition",
          400,
        );
      append(v.compiled, "sub");
    }
    const ids = append(
      {
        title: def.title,
        steps: def.steps.map(({ repeat, ...s }) => s),
        questions: [],
      },
      "step",
      Object.fromEntries(def.steps.map((s) => [s.id, s.repeat])),
    );
    for (const output of def.outputs)
      if (!ids.has(output.step))
        throw new AppError("Output references an unknown step", 400);
    const compiled = planSpec.parse({ title: def.title, steps, questions: [] });
    this.authority(compiled, def.permissions);
    return {
      spec: compiled,
      outputs: def.outputs.map((o) => ({ ...o, step: ids.get(o.step)! })),
    };
  }
  async save(
    raw: unknown,
    c: ToolExecutionContext,
    id?: string,
    revision?: number,
  ) {
    if (!c.stage || !c.actionId)
      throw new AppError("Skill writes require the action transaction", 403);
    const def = skillDefinition.parse(raw);
    const compiled = await this.compile(def);
    const old = id ? await this.get(id) : null;
    if (old && old.skill.revision !== revision)
      throw new AppError("Skill changed; reload before saving", 409);
    if (old && old.skill.versions.length >= 50)
      throw new AppError("Skill version limit reached", 409);
    const skill: SkillRecord = old?.skill ?? {
      id: randomUUID(),
      revision: 0,
      versions: [],
    };
    skill.revision++;
    skill.versions.push({
      version: skill.versions.length + 1,
      definition: def,
      compiled: compiled.spec,
      output_bindings: compiled.outputs,
      hash: digest({ def, compiled }),
      created_at: new Date().toISOString(),
      source_message_id: c.sourceMessageId ?? null,
      action_id: c.actionId,
      approval_action_id: null,
      approved_at: null,
    });
    if (old)
      c.stage([
        {
          kind: "update",
          table: "messages",
          id: skill.id,
          expected_updated_at: old.record.updated_at,
          data: {
            metadata: { ...old.record.metadata, [SKILL]: skill },
            content: def.title,
          },
        },
      ]);
    else {
      const conversation = randomUUID();
      c.stage([
        {
          kind: "insert",
          table: "conversations",
          id: conversation,
          data: {
            title: `Skill: ${def.title}`,
            metadata: { nexus_artifact: "skill" },
          },
        },
        {
          kind: "insert",
          table: "messages",
          id: skill.id,
          data: {
            conversation_id: conversation,
            role: "system",
            content: def.title,
            metadata: { [SKILL]: skill },
          },
        },
      ]);
    }
    return { skill };
  }
  async approve(
    id: string,
    version: number,
    hash: string,
    c: ToolExecutionContext,
  ) {
    if (!c.stage || !c.actionId)
      throw new AppError("Review requires the existing approval pipeline", 403);
    const { record, skill } = await this.get(id);
    const v = required(
      skill.versions.find((v) => v.version === version) ?? null,
      "Version",
    );
    if (v.hash !== hash)
      throw new AppError("Skill review snapshot changed", 409);
    if (v.approved_at) return { skill };
    this.authority(v.compiled, v.definition.permissions);
    v.approved_at = new Date().toISOString();
    v.approval_action_id = c.actionId;
    skill.revision++;
    c.stage([
      {
        kind: "update",
        table: "messages",
        id,
        expected_updated_at: record.updated_at,
        data: { metadata: { ...record.metadata, [SKILL]: skill } },
      },
    ]);
    return { skill };
  }
  async proposal(goal: string, c: ToolExecutionContext) {
    const p = await this.coordinator.create(goal);
    const d: SkillDefinition = {
      title: p.spec.title,
      instructions: goal,
      inputs: [],
      outputs: [],
      success_criteria: [
        "Verify the expected outcome using step receipts and evidence; unresolved questions prevent execution.",
      ],
      permissions: [
        ...new Set(
          p.spec.steps.flatMap((s) => [
            s.tool,
            ...(s.verification ? [s.verification.tool] : []),
          ]),
        ),
      ],
      steps: p.spec.steps.map((s) => ({
        ...s,
        repeat: 1,
        missing: [...s.missing, ...p.spec.questions].slice(0, 8),
      })),
      subskills: [],
    };
    return this.save(d, c);
  }
  async instantiate(
    id: string,
    version: number,
    inputs: Record<string, unknown>,
  ) {
    const v = await this.version(id, version);
    const declared = new Map(v.definition.inputs.map((i) => [i.name, i]));
    for (const [key, value] of Object.entries(inputs))
      if (!declared.has(key) || typeof value !== declared.get(key)!.type)
        throw new AppError("Invalid skill input type or name", 400);
    for (const i of declared.values())
      if (i.required && !Object.hasOwn(inputs, i.name))
        throw new AppError(`Missing input: ${i.name}`, 400);
    const spec = planSpec.parse(bindSkillInputs(v.compiled, inputs));
    this.authority(spec, v.definition.permissions);
    // Validate static inputs now; result references remain guarded by the existing mission binder.
    for (const s of spec.steps) {
      if (!JSON.stringify(s.input).includes('"$from"'))
        this.tools.validate(s.tool, s.input);
    }
    return { spec, version: v };
  }
  async launch(
    id: string,
    version: number,
    inputs: Record<string, unknown>,
    key: string,
  ) {
    const compiled = await this.instantiate(id, version, inputs);
    const result = await this.coordinator.requests.request({
      tool: "mission.create",
      input: {
        goal: `Skill ${id} v${version}: ${compiled.version.definition.instructions}`.slice(
          0,
          2000,
        ),
        spec: compiled.spec,
      },
      request_key: key,
      reason: `Launch reviewed Skill ${id} v${version}; permissions remain unchanged.`,
    });
    return {
      mission_id: (result.result as unknown as ExecutionPlan).id,
      skill_id: id,
      version,
      output_bindings: compiled.version.output_bindings,
      success_criteria: compiled.version.definition.success_criteria,
    };
  }
  async saveAutomation(raw: unknown, c: ToolExecutionContext) {
    if (!c.stage || !c.actionId)
      throw new AppError("Automation requires the action transaction", 403);
    const definition = automationDefinition.parse(raw);
    let spec: PlanSpec;
    if (definition.target.kind === "skill")
      spec = (
        await this.instantiate(
          definition.target.id,
          definition.target.version,
          definition.target.inputs,
        )
      ).spec;
    else {
      const plan = await this.coordinator.inspect(definition.target.id);
      if (plan.revision !== definition.target.revision)
        throw new AppError("Mission changed; review its latest revision", 409);
      spec = planSpec.parse(plan.spec);
      this.authority(spec, [
        ...new Set(
          spec.steps.flatMap((s) => [
            s.tool,
            ...(s.verification ? [s.verification.tool] : []),
          ]),
        ),
      ]);
    }
    const a: AutomationRecord = {
      id: randomUUID(),
      definition,
      spec,
      enabled: false,
      revision: 1,
      approval_action_id: null,
    };
    const conversation = randomUUID();
    c.stage([
      {
        kind: "insert",
        table: "conversations",
        id: conversation,
        data: {
          title: `Automation: ${definition.title}`,
          metadata: { nexus_artifact: "automation" },
        },
      },
      {
        kind: "insert",
        table: "messages",
        id: a.id,
        data: {
          conversation_id: conversation,
          role: "system",
          content: definition.title,
          metadata: { [AUTO]: a },
        },
      },
    ]);
    return { automation: a };
  }
  async enable(
    id: string,
    revision: number,
    enabled: boolean,
    c: ToolExecutionContext,
  ) {
    if (!c.stage || !c.actionId)
      throw new AppError("Automation change requires action transaction", 403);
    const m = required(await this.repo.get("messages", id), "Automation");
    const a = structuredClone(m.metadata[AUTO] as unknown as AutomationRecord);
    if (!a) throw new AppError("Not an automation", 404);
    if (a.revision !== revision)
      throw new AppError("Automation changed; reload", 409);
    a.enabled = enabled;
    a.revision++;
    a.approval_action_id = c.actionId;
    c.stage([
      {
        kind: "update",
        table: "messages",
        id,
        expected_updated_at: m.updated_at,
        data: { metadata: { ...m.metadata, [AUTO]: a } },
      },
    ]);
    return { automation: a };
  }
  async fire(id: string, invocation: string, now = Date.now()) {
    const a = required(
      (await this.automations()).find((a) => a.id === id) ?? null,
      "Automation",
    );
    if (!a.enabled) throw new AppError("Automation is disabled", 403);
    const t = a.definition.trigger;
    let slot = invocation;
    if (t.kind === "interval") {
      if (now < Date.parse(t.starts_at))
        throw new AppError("Automation is not due", 409);
      slot = String(
        Math.floor((now - Date.parse(t.starts_at)) / (t.minutes * 60000)),
      );
    }
    const key = `automation:${a.id}:${slot}`;
    if (a.definition.target.kind === "skill")
      return this.launch(
        a.definition.target.id,
        a.definition.target.version,
        a.definition.target.inputs,
        key,
      );
    const r = await this.coordinator.requests.request({
      tool: "mission.create",
      input: { goal: `Automation: ${a.definition.title}`, spec: a.spec },
      request_key: key,
      reason: `Reviewed automation ${id}. Draft only; launch from Mission Control.`,
    });
    return { mission_id: (r.result as unknown as ExecutionPlan).id };
  }
  async runDue() {
    const results = [];
    const settled = new Set(
      (await this.repo.list("actions", { tool_name: "automation.fire" }))
        .filter((a) => ["succeeded", "failed", "denied"].includes(a.status))
        .map((a) => a.metadata.execution_key),
    );
    for (const a of (await this.automations()).filter(
      (a) => a.enabled && a.definition.trigger.kind === "interval",
    )) {
      const t = a.definition.trigger;
      if (t.kind !== "interval" || Date.parse(t.starts_at) > Date.now())
        continue;
      const slot = Math.floor(
        (Date.now() - Date.parse(t.starts_at)) / (t.minutes * 60000),
      );
      if (settled.has(`auto-fire:${a.id}:${slot}`)) continue;
      if (results.length >= 20) break;
      try {
        results.push(
          await this.coordinator.requests.request({
            tool: "automation.fire",
            input: { id: a.id, invocation: "scheduled" },
            request_key: `auto-fire:${a.id}:${slot}`,
            reason: "Due reviewed automation; creates a mission draft only.",
          }),
        );
      } catch {
        results.push({ automation_id: a.id, status: "blocked" });
      }
    }
    return results;
  }
}
