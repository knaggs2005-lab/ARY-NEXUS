import { createHash } from "node:crypto";
import { AppError } from "../domain/validation";
import type {
  PerceptionSource,
  PerceptionInput,
  FrameReference,
  VisionProvider,
} from "../domain/perception";
import {
  FrameStore,
  perceptionFrames,
} from "../infrastructure/perception/frame-store";
import type { ActionService } from "./action-service";
import type { Repository } from "../domain/repository";
export class PerceptionService {
  constructor(
    private repo: Repository,
    private actions: ActionService,
    private provider: VisionProvider,
    private store: FrameStore = perceptionFrames,
    private signal?: AbortSignal,
  ) {}
  async grant(
    source: PerceptionSource,
    source_id: string,
    productIds: string[],
  ) {
    const p = await this.actions.permissions.resolve(
      `perception.capture_${source}`,
      { workspace: "ary-nexus", productIds },
    );
    // Called only from the approved ToolRegistry handler.
    const g = this.store.grant(
      this.repo.userId,
      source,
      source_id,
      p.policyHash,
      productIds,
    );
    return {
      grant_id: g.id,
      source,
      source_id,
      expires_at: new Date(g.expires).toISOString(),
    };
  }
  private async validateSource(g: {
    source: PerceptionSource;
    policy_hash: string;
    productIds: string[];
  }) {
    const p = await this.actions.permissions.resolve(
      `perception.capture_${g.source}`,
      { workspace: "ary-nexus", productIds: g.productIds },
    );
    if (!p.approvalRequired || p.policyHash !== g.policy_hash)
      throw new AppError(
        "Source permission changed; request fresh capture approval",
        403,
      );
  }
  async stage(grantId: string, bytes: Buffer) {
    try {
      const grant = this.store.getGrant(this.repo.userId, grantId);
      const hash = createHash("sha256").update(bytes).digest("hex");
      return await this.actions.run(
        "perception.stage",
        null,
        async () => {
          await this.validateSource(grant);
          return this.store.stage(this.repo.userId, grantId, bytes);
        },
        { grant_id: grantId, sha256: hash, source: grant.source },
        { productIds: grant.productIds },
        { result: (r) => ({ ...r }) },
      );
    } finally {
      bytes.fill(0);
    }
  }
  async clear(ids: string[]) {
    for (const id of ids) this.store.remove(this.repo.userId, id);
    return { cleared: true };
  }
  async analyze(input: PerceptionInput) {
    const held = input.frames.map((f) => this.store.get(this.repo.userId, f));
    for (const f of held) await this.validateSource(f.grant);
    if (
      input.related_action_id &&
      !(await this.repo.get("actions", input.related_action_id))
    )
      throw new AppError("Related action not found", 404);
    const images = this.store.take(this.repo.userId, input.frames);
    try {
      const result = await this.provider.analyze(
        input,
        images.map(({ data, mime }) => ({ data, mime })),
        this.signal,
      );
      return {
        ...result,
        frames: input.frames,
        related_action_id: input.related_action_id ?? null,
        images_retained: false,
        scope: "Visual evidence only; original action status is unchanged",
      };
    } finally {
      for (const image of images) image.data.fill(0);
    }
  }
  async scope(frames: FrameReference[]) {
    return [
      ...new Set(
        frames.flatMap(
          (f) => this.store.get(this.repo.userId, f).grant.productIds,
        ),
      ),
    ];
  }
}
