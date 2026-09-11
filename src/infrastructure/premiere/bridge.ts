import { timingSafeEqual, createHash } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import { resolve, relative, dirname, basename, extname } from "node:path";
import { z } from "zod";
import { EncryptedCalendarVault, type CalendarVault } from "../calendar/vault";
import { AppError } from "../../domain/validation";
import {
  premiereState,
  premiereExecution,
  premiereVerbs,
  validatePremierePlan,
  type PremiereState,
  type PremiereVerb,
  type PremiereExecution,
  type PremiereProvider,
} from "../../domain/premiere";
import type { Json } from "../../domain/models";

export function assertPremiereEnabled() {
  if (
    process.platform !== "darwin" ||
    process.env.ARY_PREMIERE_ENABLED !== "true"
  )
    throw new AppError(
      "Premiere bridge is disabled. Enable it explicitly on the local Mac.",
      403,
    );
  if (
    process.env.ARY_STORAGE !== "supabase" ||
    !process.env.ARY_PREMIERE_USER_ID ||
    !/^[a-f0-9]{64}$/i.test(process.env.ARY_PREMIERE_BRIDGE_TOKEN ?? "") ||
    !/^[a-f0-9]{64}$/i.test(process.env.ARY_INTEGRATION_ENCRYPTION_KEY ?? "")
  )
    throw new AppError(
      "Premiere owner, bridge token and encrypted receipt storage must be configured.",
      503,
    );
}
export function authorizePremiereBridge(request: Request) {
  assertPremiereEnabled();
  const expected = process.env.ARY_PREMIERE_BRIDGE_TOKEN!;
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
    throw new AppError("Unauthorized local Premiere plugin connection", 403);
}
export async function validatePremiereFiles(verb: PremiereVerb, args: Json) {
  const roots = z
    .array(z.string().startsWith("/"))
    .min(1)
    .parse(JSON.parse(process.env.ARY_PREMIERE_ALLOWED_ROOTS ?? "[]"));
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
        "Premiere path is outside the configured allowed folders",
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
      throw new AppError("Premiere input must be an existing file");
  };
  if (verb === "open_project") {
    if (extname(String(args.path)).toLowerCase() !== ".prproj")
      throw new AppError("Choose an existing .prproj project");
    await check(String(args.path));
  }
  if (verb === "create_sequence" || verb === "export_sequence") {
    const expected = verb === "create_sequence" ? ".sqpreset" : ".epr";
    if (extname(String(args.preset_path)).toLowerCase() !== expected)
      throw new AppError(`Choose an existing ${expected} preset`);
    await check(String(args.preset_path));
  }
  if (verb === "import_media")
    for (const p of args.paths as string[]) {
      if (!/\.(mov|mp4|mxf|wav|aif|aiff|mp3|png|jpg|jpeg|tif|tiff)$/i.test(p))
        throw new AppError("Unsupported media extension");
      await check(p);
    }
  if (verb === "export_sequence") await check(String(args.output_path), true);
}
export const bridgePollInput = z.object({ state: premiereState }).strict();
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
  verb: PremiereVerb;
  input: PremiereExecution;
  action_id: string;
  fingerprint: string;
  deadline: number;
  status:
    "queued" | "claimed" | "completed" | "failed" | "uncertain" | "expired";
  receipt?: Receipt;
}
/** Transport receipts only. Existing actions/outcomes remain Ary's canonical execution history. */
export class PremiereBridge {
  constructor(
    private owner: string,
    private vault: CalendarVault = new EncryptedCalendarVault(
      resolve(".data/premiere-vault"),
    ),
    private now = () => Date.now(),
  ) {}
  private get key() {
    return `premiere:${this.owner}`;
  }
  async inspect(): Promise<PremiereState> {
    const current = await this.vault.read<{ state: PremiereState; at: number }>(
      this.key + ":state",
    );
    if (!current || this.now() - current.at > 10000)
      throw new AppError(
        "Open and connect the Ary Creative UXP panel in Premiere; live state is unavailable or stale.",
        503,
      );
    return premiereState.parse(current.state);
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
      throw new AppError("Premiere receipt is too large", 413);
    return this.vault.lock(this.key, async () => {
      const jobs = (await this.vault.read<Job[]>(this.key + ":jobs")) ?? [];
      const job = jobs.find((j) => j.operation_id === input.operation_id);
      if (!job) throw new AppError("Unknown Premiere operation", 404);
      if (job.receipt) {
        if (JSON.stringify(job.receipt) !== JSON.stringify(input.receipt))
          throw new AppError("Premiere receipt is immutable", 409);
        return { recorded: true };
      }
      if (job.status !== "claimed")
        throw new AppError("Premiere operation was not claimed", 409);
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
    verb: PremiereVerb,
    input: PremiereExecution,
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
            "Operation ID was already used for different Premiere inputs",
            409,
          );
        return;
      }
      if (
        jobs.some((j) => ["queued", "claimed", "uncertain"].includes(j.status))
      )
        throw new AppError(
          "A Premiere operation is pending or uncertain. Inspect its receipt before another action; no automatic retry.",
          409,
        );
      const state = await this.inspect();
      if (state.revision !== input.expected_revision)
        throw new AppError(
          "Premiere changed since review. Inspect and plan again.",
          409,
        );
      validatePremierePlan(verb, input.args, state);
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
            `${job.receipt.error || "Premiere operation failed"}${job.receipt.may_have_changed ? " Changes may exist; automatic retry is blocked." : ""}`,
            409,
          );
        return {
          provider: "adobe-premiere-uxp",
          operation_id: job.operation_id,
          original_action_id: job.action_id,
          ...job.receipt.result,
        };
      }
      if (job.status === "expired")
        throw new AppError(
          "Premiere command expired before pickup. Reinspect before a new request.",
          409,
        );
      await new Promise((r) => setTimeout(r, 150));
    }
    throw new AppError(
      "Premiere response timed out. Do not repeat the operation; its durable receipt may still arrive.",
      504,
    );
  }
}
export class UxpPremiereProvider implements PremiereProvider {
  constructor(
    private owner: string,
    private authorized = () => false,
    private bridge = new PremiereBridge(owner),
  ) {}
  assertAvailable() {
    assertPremiereEnabled();
    if (this.owner !== process.env.ARY_PREMIERE_USER_ID || !this.authorized())
      throw new AppError(
        "Premiere actions require the configured owner's installed Mac app session.",
        403,
      );
  }
  inspect() {
    this.assertAvailable();
    return this.bridge.inspect();
  }
  async execute(
    verb: PremiereVerb,
    input: PremiereExecution,
    actionId: string,
  ) {
    this.assertAvailable();
    premiereExecution.parse(input);
    z.enum(premiereVerbs).parse(verb);
    return this.bridge.dispatch(verb, input, actionId, async () => {
      await validatePremiereFiles(verb, input.args);
      if (verb !== "open_project") {
        const state = await this.bridge.inspect();
        await validatePremiereFiles("open_project", {
          path: state.project_path,
        });
      }
    });
  }
}
