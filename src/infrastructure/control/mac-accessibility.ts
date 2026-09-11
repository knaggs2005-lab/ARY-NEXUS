import { execFile } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import { resolve } from "node:path";
import type {
  ControlAction,
  ControlElement,
  ControlSnapshot,
  DigitalControlProvider,
  VisualControlProvider,
} from "../../domain/digital-control";
import { visualControlProposal } from "../../domain/digital-control";
import { AppError } from "../../domain/validation";
import { desktopAppId } from "../../domain/desktop";
import { scanInstalledApps, resolveInstalledApp } from "../desktop/apps";
import { assertControlApp, controlProcessEnv } from "./security";
import { perceptionFrames } from "../perception/frame-store";
import type { FrameReference } from "../../domain/perception";
import { registerControlStop } from "../../services/action-cancellation";

type NativeResult = {
  pid?: number;
  title?: string;
  elements?: ControlElement[];
  truncated?: boolean;
  image?: string;
  dispatched?: boolean;
};
export type NativeRunner = (
  input: Record<string, unknown>,
  signal?: AbortSignal,
) => Promise<NativeResult>;
/** One fixed binary, JSON over stdin, no shell and no request-selected executable. */
export const runAccessibility: NativeRunner = (input, signal) =>
  new Promise((yes, no) => {
    const child = execFile(
      resolve(process.cwd(), ".native/ary-control"),
      [],
      {
        shell: false,
        env: controlProcessEnv(),
        signal,
        timeout: 15000,
        maxBuffer: 5 * 1024 * 1024,
      },
      (error, stdout) => {
        let result;
        try {
          result = JSON.parse(stdout);
        } catch {
          return no(
            new AppError(
              error?.code === "ENOENT"
                ? "Build the native helper with npm run control:build"
                : `Native control failed (${error?.code ?? "invalid_response"}${error && "signal" in error && error.signal ? ` / ${error.signal}` : ""}); inspect before retrying`,
              503,
            ),
          );
        }
        if (result.error || error)
          return no(
            new AppError(
              result.error || "Native operation failed",
              /AX_PERMISSION|SCREEN_PERMISSION/.test(result.error ?? "")
                ? 403
                : 409,
            ),
          );
        yes(result);
      },
    );
    child.stdin?.on("error", () => {});
    child.stdin?.end(JSON.stringify(input));
  });
type Held = {
  owner: string;
  app: string;
  pid: number;
  snapshot: ControlSnapshot;
  used: boolean;
  allowed: string;
};
type Proposal = {
  owner: string;
  held: Held;
  element: ControlElement;
  frame: FrameReference;
  point: { x: number; y: number; reason: string; confidence: number };
  used: boolean;
};
const global = globalThis as typeof globalThis & {
  aryNativeSnapshots?: Map<string, Held>;
  aryVisualProposals?: Map<string, Proposal>;
};
const snapshots = (global.aryNativeSnapshots ??= new Map<string, Held>());
const proposals = (global.aryVisualProposals ??= new Map<string, Proposal>());
function sweep() {
  for (const [id, h] of snapshots)
    if (h.used || Date.parse(h.snapshot.expires_at) <= Date.now())
      snapshots.delete(id);
  for (const [id, p] of proposals)
    if (
      Date.parse(p.frame.expires_at) <= Date.now() ||
      !snapshots.has(p.held.snapshot.id)
    ) {
      perceptionFrames.remove(p.owner, p.frame.id);
      proposals.delete(id);
    }
}
registerControlStop("native", async (owner) => {
  for (const [id, h] of snapshots) if (h.owner === owner) snapshots.delete(id);
  for (const [id, p] of proposals)
    if (p.owner === owner) {
      perceptionFrames.remove(owner, p.frame.id);
      proposals.delete(id);
    }
});
export class MacAccessibility implements DigitalControlProvider {
  constructor(
    private owner: string,
    private guard: () => void,
    private allowed: string[],
    private vision: VisualControlProvider,
    private run: NativeRunner = runAccessibility,
    private scan = scanInstalledApps,
  ) {}
  assertAvailable() {
    this.guard();
    if (!this.allowed.length)
      throw new AppError(
        "Configure ARY_CONTROL_ALLOWED_APPS with explicit bundle IDs",
        503,
      );
  }
  private async app(id: string) {
    this.assertAvailable();
    desktopAppId.parse(id);
    assertControlApp(id, this.allowed);
    resolveInstalledApp(await this.scan(), id);
  }
  async inspect(id: string, signal?: AbortSignal): Promise<ControlSnapshot> {
    await this.app(id);
    sweep();
    if (
      [...snapshots.values()].filter((h) => h.owner === this.owner).length >= 8
    )
      throw new AppError(
        "Too many active inspections; wait two minutes or stop control",
        429,
      );
    const result = await this.run({ verb: "inspect", app_id: id }, signal);
    if (!result.pid || !Array.isArray(result.elements))
      throw new AppError("Invalid Accessibility response", 502);
    const value: ControlSnapshot = {
      id: randomUUID(),
      surface: "computer",
      target_id: id,
      title: result.title ?? id,
      observed_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 120000).toISOString(),
      elements: result.elements,
      truncated: result.truncated === true,
    };
    snapshots.set(value.id, {
      owner: this.owner,
      app: id,
      pid: result.pid,
      snapshot: value,
      used: false,
      allowed: JSON.stringify(this.allowed),
    });
    return value;
  }
  private target(id: string, elementId: string) {
    sweep();
    const h = snapshots.get(id),
      element = h?.snapshot.elements.find((e) => e.id === elementId);
    if (
      !h ||
      h.owner !== this.owner ||
      h.used ||
      h.allowed !== JSON.stringify(this.allowed) ||
      !element
    )
      throw new AppError(
        "Native inspection expired, changed or already used; inspect again",
        409,
      );
    return { h, element };
  }
  private command(h: Held, element: ControlElement, verb: string) {
    return {
      verb,
      app_id: h.app,
      pid: h.pid,
      element_id: element.id,
      expected: element,
    };
  }
  async act(input: ControlAction, signal?: AbortSignal) {
    const { h, element } = this.target(input.snapshot_id, input.element_id);
    await this.app(h.app);
    if (
      element.protected ||
      !element.actions.includes(input.verb) ||
      !["click", "fill", "key", "focus_window"].includes(input.verb)
    )
      throw new AppError("Unsupported native action", 403);
    signal?.throwIfAborted();
    this.target(input.snapshot_id, input.element_id);
    h.used = true;
    await this.run(
      {
        ...this.command(h, element, "act"),
        action: input.verb,
        value: input.value,
        key: input.key,
      },
      signal,
    );
    return {
      dispatched: true,
      method: "AXUIElement",
      app_id: h.app,
      verification:
        "Inspect the resulting state; dispatch alone is not business success",
    };
  }
  /** Explicitly approved window capture and model proposal. No model-generated action is executed here. */
  async propose(
    id: string,
    elementId: string,
    question: string,
    signal?: AbortSignal,
    provenance: { productIds: readonly string[]; policyHash: string } = {
      productIds: [],
      policyHash: "isolated-provider",
    },
  ) {
    const { h, element } = this.target(id, elementId);
    await this.app(h.app);
    if (element.role !== "AXWindow")
      throw new AppError("Select an inspected window", 400);
    if (
      h.snapshot.elements.some(
        (e) =>
          ![
            "AXCloseButton",
            "AXMinimizeButton",
            "AXZoomButton",
            "AXFullScreenButton",
          ].includes(e.subrole ?? "") &&
          e.actions.some((a) => a !== "focus_window") &&
          e.id.startsWith(element.id + "."),
      )
    )
      throw new AppError(
        "Structural controls are available; use Accessibility targets first",
        409,
      );
    const capture = await this.run(this.command(h, element, "capture"), signal);
    const data = Buffer.from(capture.image ?? "", "base64");
    let frame: FrameReference | undefined;
    try {
      const grant = perceptionFrames.grant(
        this.owner,
        "window",
        `${h.app}:${element.id}`,
        provenance.policyHash,
        [...provenance.productIds],
      );
      frame = perceptionFrames.stage(this.owner, grant.id, data);
      const point = visualControlProposal.parse(
        await this.vision.propose(question, data, signal),
      );
      signal?.throwIfAborted();
      const proposal_id = randomUUID();
      proposals.set(proposal_id, {
        owner: this.owner,
        held: h,
        element,
        frame,
        point,
        used: false,
      });
      return {
        proposal_id,
        app_id: h.app,
        window: element.label,
        frame,
        point,
        notice:
          "Proposal only. Review the exact point in the visible target window before separately approving a click.",
      };
    } catch (e) {
      if (frame) perceptionFrames.remove(this.owner, frame.id);
      throw e;
    } finally {
      data.fill(0);
    }
  }
  async visualClick(
    id: string,
    point: { x: number; y: number },
    signal?: AbortSignal,
    productIds: readonly string[] = [],
  ) {
    sweep();
    const p = proposals.get(id);
    if (
      !p ||
      p.owner !== this.owner ||
      p.used ||
      p.point.confidence < 0.5 ||
      point.x !== p.point.x ||
      point.y !== p.point.y
    )
      throw new AppError("Visual proposal unavailable or changed", 409);
    this.target(p.held.snapshot.id, p.element.id);
    await this.app(p.held.app);
    const original = perceptionFrames.get(this.owner, p.frame);
    if (original.grant.productIds.some((id) => !productIds.includes(id)))
      throw new AppError(
        "Use the original source project scope for visual control",
        403,
      );
    const capture = await this.run(
        this.command(p.held, p.element, "capture"),
        signal,
      ),
      data = Buffer.from(capture.image ?? "", "base64");
    try {
      if (
        createHash("sha256").update(data).digest("hex") !== original.ref.sha256
      )
        throw new AppError(
          "Window pixels changed; capture and review a new proposal",
          409,
        );
    } finally {
      data.fill(0);
    }
    signal?.throwIfAborted();
    this.target(p.held.snapshot.id, p.element.id);
    if (p.used) throw new AppError("Visual proposal already used", 409);
    p.used = true;
    p.held.used = true;
    perceptionFrames.remove(this.owner, p.frame.id);
    await this.run(
      {
        ...this.command(p.held, p.element, "visual_click"),
        x: point.x,
        y: point.y,
      },
      signal,
    );
    return {
      dispatched: true,
      method: "reviewed_visual_point",
      app_id: p.held.app,
      proposal_id: id,
      verification: "Mouse dispatch is not proof of downstream success",
    };
  }
}
