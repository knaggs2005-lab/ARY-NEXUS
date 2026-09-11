import { timingSafeEqual, createHash } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import { resolve, relative, dirname, basename, extname } from "node:path";
import { z } from "zod";
import { EncryptedCalendarVault, type CalendarVault } from "../calendar/vault";
import { AppError } from "../../domain/validation";
import {
  designState,
  designExecution,
  designVerbs,
  validateDesignPlan,
  type DesignState,
  type DesignVerb,
  type DesignExecution,
  type DesignTool,
} from "../../domain/design-tool";
import type { Json } from "../../domain/models";

export function assertDesignEnabled() {
  if (
    process.platform !== "darwin" ||
    process.env.ARY_DESIGN_ENABLED !== "true"
  )
    throw new AppError(
      "Design bridge is disabled. Enable it explicitly on the local Mac.",
      403,
    );
  if (
    process.env.ARY_STORAGE !== "supabase" ||
    !process.env.ARY_DESIGN_USER_ID ||
    !/^[a-f0-9]{64}$/i.test(process.env.ARY_DESIGN_BRIDGE_TOKEN ?? "") ||
    !/^[a-f0-9]{64}$/i.test(process.env.ARY_INTEGRATION_ENCRYPTION_KEY ?? "")
  )
    throw new AppError(
      "Design owner, bridge token and encrypted receipt storage must be configured.",
      503,
    );
}
export function authorizeDesignBridge(request: Request) {
  assertDesignEnabled();
  const expected = process.env.ARY_DESIGN_BRIDGE_TOKEN!;
  const actual =
    request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (
    request.method !== "POST" ||
    !["http://127.0.0.1:3000", "http://localhost:3000"].includes(
      new URL(request.url).origin,
    ) ||
    request.headers.get("host") !== "127.0.0.1:3000" ||
    request.headers.has("forwarded") ||
    (request.headers.has("x-forwarded-for") &&
      !["127.0.0.1", "::1"].includes(
        request.headers.get("x-forwarded-for")!,
      )) ||
    request.headers.has("origin") ||
    !/^[a-f0-9]{64}$/i.test(actual) ||
    !timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
  )
    throw new AppError("Unauthorized local Design plugin connection", 403);
}
export async function validateDesignFiles(verb: DesignVerb, args: Json) {
  const roots = z
    .array(z.string().startsWith("/"))
    .min(1)
    .parse(JSON.parse(process.env.ARY_DESIGN_ALLOWED_ROOTS ?? "[]"));
  const allowed = await Promise.all(roots.map((p) => realpath(p)));
  const check = async (p: string, output = false) => {
    const canonical = output
      ? resolve(await realpath(dirname(p)), basename(p))
      : await realpath(p);
    if (
      !allowed.some((root) => {
        const part = relative(root, canonical);
        return part !== "" && !part.startsWith("..") && !part.startsWith("/");
      })
    )
      throw new AppError(
        "Design path is outside the configured allowed folders",
        403,
      );
    if (output) {
      try {
        await stat(p);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
        throw e;
      }
      throw new AppError(
        "Export destination already exists; choose a new file",
        409,
      );
    }
    if (!(await stat(canonical)).isFile())
      throw new AppError("Design input must be an existing file");
  };
  if (verb === "open_document") {
    if (extname(String(args.path)).toLowerCase() !== ".c4d")
      throw new AppError("Choose an existing .c4d file");
    await check(String(args.path));
  }
  if (verb === "save" || verb === "export") {
    const suffix = verb === "save" ? ".c4d" : ".obj";
    if (extname(String(args.path)).toLowerCase() !== suffix)
      throw new AppError(`Choose a new ${suffix} output`);
    await check(String(args.path), true);
  }
}
export const bridgePollInput = z.object({ state: designState }).strict();
export const bridgeResultInput = z
  .object({
    operation_id: z.uuid(),
    receipt: z
      .object({
        ok: z.boolean(),
        may_have_changed: z.boolean(),
        result: z.record(z.string(), z.unknown()).default({}),
        error: z.string().max(1500).nullable(),
      })
      .strict(),
  })
  .strict();
type Receipt = z.infer<typeof bridgeResultInput>["receipt"];
interface Job {
  operation_id: string;
  verb: DesignVerb;
  input: DesignExecution;
  action_id: string;
  fingerprint: string;
  deadline: number;
  status:
    "queued" | "claimed" | "completed" | "failed" | "uncertain" | "expired";
  receipt?: Receipt;
}
/** Transport receipts only. Existing actions/outcomes remain Ary's canonical execution history. */
export class DesignBridge {
  constructor(
    private owner: string,
    private vault: CalendarVault = new EncryptedCalendarVault(
      resolve(".data/design-vault"),
    ),
    private now = () => Date.now(),
  ) {}
  private get key() {
    return `design:${this.owner}`;
  }
  async inspect(): Promise<DesignState> {
    const current = await this.vault.read<{ state: DesignState; at: number }>(
      this.key + ":state",
    );
    if (!current || this.now() - current.at > 10000)
      throw new AppError(
        "Connect the Ary Design plugin in Cinema 4D; live state is unavailable or stale.",
        503,
      );
    return designState.parse(current.state);
  }
  async poll(raw: unknown) {
    const { state } = bridgePollInput.parse(raw);
    return this.vault.lock(this.key, async () => {
      await this.vault.write(this.key + ":state", { state, at: this.now() });
      const jobs = (await this.vault.read<Job[]>(this.key + ":jobs")) ?? [];
      for (const job of jobs)
        if (job.status === "queued" && job.deadline < this.now())
          job.status = "expired";
      const next = jobs.find((j) => j.status === "queued");
      if (next) next.status = "claimed";
      await this.vault.write(this.key + ":jobs", jobs);
      return next
        ? {
            operation_id: next.operation_id,
            verb: next.verb,
            input: next.input,
            action_id: next.action_id,
            deadline: next.deadline,
          }
        : null;
    });
  }
  async complete(raw: unknown) {
    const input = bridgeResultInput.parse(raw);
    if (JSON.stringify(input).length > 100000)
      throw new AppError("Design receipt is too large", 413);
    return this.vault.lock(this.key, async () => {
      const jobs = (await this.vault.read<Job[]>(this.key + ":jobs")) ?? [];
      const job = jobs.find((j) => j.operation_id === input.operation_id);
      if (!job) throw new AppError("Unknown Design operation", 404);
      if (job.receipt) {
        if (JSON.stringify(job.receipt) !== JSON.stringify(input.receipt))
          throw new AppError("Design receipt is immutable", 409);
        return { recorded: true };
      }
      if (job.status !== "claimed")
        throw new AppError("Design operation was not claimed", 409);
      job.receipt = input.receipt;
      job.status = input.receipt.ok
        ? "completed"
        : input.receipt.may_have_changed
          ? "uncertain"
          : "failed";
      await this.vault.write(this.key + ":jobs", jobs);
      return { recorded: true };
    });
  }
  async dispatch(
    verb: DesignVerb,
    input: DesignExecution,
    actionId: string,
    validateFiles: () => Promise<void> = async () => {},
  ) {
    const fingerprint = createHash("sha256")
      .update(JSON.stringify([verb, input]))
      .digest("hex");
    await this.vault.lock(this.key, async () => {
      const jobs = (await this.vault.read<Job[]>(this.key + ":jobs")) ?? [];
      const previous = jobs.find((j) => j.operation_id === input.operation_id);
      if (previous) {
        if (previous.fingerprint !== fingerprint)
          throw new AppError(
            "Operation ID was already used for different Design inputs",
            409,
          );
        return;
      }
      if (
        jobs.some((j) => ["queued", "claimed", "uncertain"].includes(j.status))
      )
        throw new AppError(
          "A Design operation is pending or uncertain. Inspect its receipt before another action; no automatic retry.",
          409,
        );
      const state = await this.inspect();
      if (state.revision !== input.expected_revision)
        throw new AppError(
          "Design changed since review. Inspect and plan again.",
          409,
        );
      validateDesignPlan(verb, input.args, state);
      await validateFiles();
      jobs.push({
        operation_id: input.operation_id,
        verb,
        input,
        action_id: actionId,
        fingerprint,
        deadline: this.now() + 30000,
        status: "queued",
      });
      await this.vault.write(this.key + ":jobs", jobs);
    });
    const until = Date.now() + 35000;
    while (Date.now() < until) {
      const jobs = (await this.vault.read<Job[]>(this.key + ":jobs")) ?? [];
      const job = jobs.find((j) => j.operation_id === input.operation_id)!;
      if (job.receipt) {
        if (!job.receipt.ok)
          throw new AppError(
            `${job.receipt.error || "Design operation failed"}${job.receipt.may_have_changed ? " Changes may exist; automatic retry is blocked." : ""}`,
            409,
          );
        return {
          provider: "cinema4d-python",
          operation_id: job.operation_id,
          original_action_id: job.action_id,
          ...job.receipt.result,
        };
      }
      if (job.status === "expired")
        throw new AppError(
          "Design command expired before pickup. Reinspect before a new request.",
          409,
        );
      await new Promise((r) => setTimeout(r, 150));
    }
    throw new AppError(
      "Design response timed out. Do not repeat the operation; its durable receipt may still arrive.",
      504,
    );
  }
}
export class Cinema4DDesignTool implements DesignTool {
  constructor(
    private owner: string,
    private authorized = () => false,
    private bridge = new DesignBridge(owner),
  ) {}
  assertAvailable() {
    assertDesignEnabled();
    if (this.owner !== process.env.ARY_DESIGN_USER_ID || !this.authorized())
      throw new AppError(
        "Design actions require the configured owner's installed Mac app session.",
        403,
      );
  }
  inspect() {
    this.assertAvailable();
    return this.bridge.inspect();
  }
  async execute(verb: DesignVerb, input: DesignExecution, actionId: string) {
    this.assertAvailable();
    designExecution.parse(input);
    z.enum(designVerbs).parse(verb);
    return this.bridge.dispatch(verb, input, actionId, async () => {
      await validateDesignFiles(verb, input.args);
      if (!["open_document", "save"].includes(verb)) {
        const state = await this.bridge.inspect();
        await validateDesignFiles("open_document", {
          path: state.document_path,
        });
      }
    });
  }
}
