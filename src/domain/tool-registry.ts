import { capabilityClasses } from "./permission-classes";
import {
  capabilityMetadata,
  type CapabilityMetadata,
} from "./tool-capabilities";
import { z, type ZodType } from "zod";
import type { Json } from "./models";
import { getToolDefinition } from "./permissions";
import { AppError } from "./validation";
import type { Mutation } from "./repository";

export interface ToolExecutionContext {
  /** Cooperative owner emergency-stop signal. Adapters must never infer rollback from abort. */
  signal?: AbortSignal;
  userId: string;
  productIds: readonly string[];
  conversationId: string | null;
  actionId?: string;
  requestKey?: string;
  agentId?: string;
  sourceMessageId?: string | null;
  sourceActionId?: string | null;
  entityIds?: string[];
  memoryIds?: string[];
  reason?: string;
  stage?: (mutations: Mutation[]) => void;
}

export interface ExecutableTool<Input> {
  inputSchema: ZodType<Input>;
  capability?: Partial<CapabilityMetadata>;
  outputSchema?: Record<string, unknown>;
  validateInput?: (input: Input) => void;
  preflight?: () => void | Promise<void>;
  execute(input: Input, context: ToolExecutionContext): Promise<Json>;
}

/** Server composition only. Possessing metadata does not expose an internal operation for dispatch. */
export class ToolRegistry {
  private readonly tools = new Map<
    string,
    (input: unknown, context: ToolExecutionContext) => Promise<Json>
  >();

  private readonly preflights = new Map<string, () => void | Promise<void>>();

  async prepare(name: string) {
    await this.preflights.get(name)?.();
  }

  private readonly metadata = new Map<string, Partial<CapabilityMetadata>>();
  private readonly outputs = new Map<string, Record<string, unknown>>();
  private readonly validators = new Map<string, (input: unknown) => void>();

  private readonly schemas = new Map<string, ZodType>();

  validate(name: string, input: unknown): void {
    const schema = this.schemas.get(name);
    if (!schema)
      throw new AppError(
        "This tool is not available through action requests",
        403,
      );
    const parsed = schema.safeParse(input);
    if (!parsed.success) throw new AppError("Invalid tool input", 400);
    this.validators.get(name)?.(parsed.data);
  }

  describe() {
    return [...this.schemas].map(([name, schema]) => {
      const definition = getToolDefinition(name)!;
      const input_schema = z.toJSONSchema(schema);
      return {
        ...capabilityMetadata(name),
        ...this.metadata.get(name),
        output_schema: this.outputs.get(name) ?? null,
        name,
        description: definition.description,
        available_actions: [definition.actionType],
        input_schema,
        required_inputs: input_schema.required ?? [],
        risk_level: definition.riskLevel ?? "low",
        simulated: definition.simulated ?? name.startsWith("mock."),
        permission_requirements: {
          classes: capabilityClasses(name, definition),
          mode: definition.mode,
          inherited_policy_tool: definition.permissionParent ?? null,
          default_level: definition.defaultLevel,
          minimum_level: { observe: 1, recommend: 2, draft: 3, execute: 4 }[
            definition.mode
          ],
        },
        approval_required_by_default:
          definition.alwaysRequiresApproval ||
          (definition.mode === "execute" && definition.defaultLevel === 4),
        always_requires_approval: definition.alwaysRequiresApproval ?? false,
      };
    });
  }

  register<Input>(name: string, tool: ExecutableTool<Input>): this {
    if (!getToolDefinition(name))
      throw new Error(`Missing capability definition: ${name}`);
    if (this.tools.has(name))
      throw new Error(`Duplicate executable tool: ${name}`);
    this.schemas.set(name, tool.inputSchema);
    if (tool.capability) this.metadata.set(name, tool.capability);
    if (tool.outputSchema) this.outputs.set(name, tool.outputSchema);
    if (tool.validateInput)
      this.validators.set(name, tool.validateInput as (input: unknown) => void);
    if (tool.preflight) this.preflights.set(name, tool.preflight);
    this.tools.set(name, async (raw, context) => {
      const parsed = tool.inputSchema.safeParse(raw);
      if (!parsed.success) throw new AppError("Invalid tool input", 400);
      tool.validateInput?.(parsed.data);
      return tool.execute(parsed.data, context);
    });
    return this;
  }

  async execute(
    name: string,
    input: unknown,
    context: ToolExecutionContext,
  ): Promise<Json> {
    const execute = this.tools.get(name);
    if (!execute)
      throw new AppError(
        "This tool is not available through action requests",
        403,
      );
    return execute(input, context);
  }
}
