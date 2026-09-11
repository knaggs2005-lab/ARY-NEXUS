import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { AppError } from "../../domain/validation";
import type { FrameReference, PerceptionSource } from "../../domain/perception";
export const FRAME_TTL = 5 * 60 * 1000;
export const MAX_FRAME_BYTES = 3 * 1024 * 1024;
type Grant = {
  id: string;
  owner: string;
  source: PerceptionSource;
  source_id: string;
  expires: number;
  policy_hash: string;
  productIds: string[];
};
export type HeldFrame = {
  ref: FrameReference;
  owner: string;
  data: Buffer;
  mime: "image/png" | "image/jpeg";
  grant: Grant;
};
/** Process-local, bounded, expiring storage. Nothing is written to disk or the canonical repository. */
export class FrameStore {
  private grants = new Map<string, Grant>();
  private frames = new Map<string, HeldFrame>();
  constructor(private now: () => number = Date.now) {}
  sweep() {
    for (const [id, g] of this.grants)
      if (g.expires <= this.now()) this.grants.delete(id);
    for (const [id, f] of this.frames)
      if (Date.parse(f.ref.expires_at) <= this.now()) this.remove(f.owner, id);
  }
  grant(
    owner: string,
    source: PerceptionSource,
    source_id: string,
    policy_hash: string,
    productIds: string[],
  ) {
    this.sweep();
    if (
      [...this.grants.values()].filter((g) => g.owner === owner).length >= 8 ||
      this.grants.size >= 128
    )
      throw new AppError("Too many pending capture grants", 429);
    const grant: Grant = {
      id: randomUUID(),
      owner,
      source,
      source_id,
      expires: this.now() + FRAME_TTL,
      policy_hash,
      productIds,
    };
    this.grants.set(grant.id, grant);
    return grant;
  }
  getGrant(owner: string, id: string) {
    this.sweep();
    const g = this.grants.get(id);
    if (!g || g.owner !== owner)
      throw new AppError("Capture grant expired or unavailable", 410);
    return g;
  }
  stage(owner: string, id: string, data: Buffer) {
    const grant = this.getGrant(owner, id),
      image = inspectImage(data);
    if (
      [...this.frames.values()].filter((f) => f.owner === owner).length >= 4 ||
      [...this.frames.values()].reduce((n, f) => n + f.data.length, 0) +
        data.length >
        96 * 1024 * 1024
    )
      throw new AppError("Clear existing images before adding more", 429);
    const ref: FrameReference = {
      id: randomUUID(),
      sha256: createHash("sha256").update(data).digest("hex"),
      source: grant.source,
      source_id: grant.source_id,
      width: image.width,
      height: image.height,
      received_at: new Date(this.now()).toISOString(),
      expires_at: new Date(this.now() + FRAME_TTL).toISOString(),
    };
    this.frames.set(ref.id, {
      owner,
      ref,
      data: Buffer.from(data),
      mime: image.mime,
      grant,
    });
    this.grants.delete(id);
    return structuredClone(ref);
  }
  get(owner: string, ref: FrameReference) {
    this.sweep();
    const f = this.frames.get(ref.id);
    if (!f || f.owner !== owner || !isDeepStrictEqual(f.ref, ref))
      throw new AppError(
        "Image expired, consumed or does not match the reviewed frame",
        410,
      );
    return f;
  }
  take(owner: string, refs: FrameReference[]) {
    const frames = refs.map((ref) => this.get(owner, ref));
    for (const f of frames) this.frames.delete(f.ref.id);
    return frames;
  }
  remove(owner: string, id: string) {
    const f = this.frames.get(id);
    if (f?.owner === owner) {
      f.data.fill(0);
      this.frames.delete(id);
    }
    const g = this.grants.get(id);
    if (g?.owner === owner) this.grants.delete(id);
  }
}
/** Header bounds before accepting compressed data. Browser capture normalizes through canvas. */
export function inspectImage(data: Buffer): {
  mime: "image/png" | "image/jpeg";
  width: number;
  height: number;
} {
  if (data.length < 24 || data.length > MAX_FRAME_BYTES)
    throw new AppError("Use a PNG/JPEG image up to 3 MB", 413);
  let width = 0,
    height = 0,
    mime: "image/png" | "image/jpeg";
  if (
    data
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    data.toString("ascii", 12, 16) === "IHDR"
  ) {
    width = data.readUInt32BE(16);
    height = data.readUInt32BE(20);
    mime = "image/png";
  } else if (data[0] === 255 && data[1] === 216) {
    mime = "image/jpeg";
    let offset = 2;
    while (offset + 4 < data.length) {
      if (data[offset++] !== 255) break;
      const marker = data[offset++];
      if (marker === 217 || marker === 218) break;
      const length = data.readUInt16BE(offset);
      if (length < 2 || offset + length > data.length) break;
      if ([192, 193, 194].includes(marker) && length >= 8) {
        height = data.readUInt16BE(offset + 3);
        width = data.readUInt16BE(offset + 5);
        break;
      }
      offset += length;
    }
  } else throw new AppError("Only PNG and JPEG images are accepted", 415);
  if (!width || !height || width > 2048 || height > 2048)
    throw new AppError("Image dimensions must be at most 2048 × 2048", 413);
  return { mime, width, height };
}
const globalFrames = globalThis as typeof globalThis & {
  aryPerceptionFrames?: FrameStore;
  aryPerceptionReaper?: ReturnType<typeof setInterval>;
};
export const perceptionFrames = (globalFrames.aryPerceptionFrames ??=
  new FrameStore());
globalFrames.aryPerceptionReaper ??= setInterval(
  () => perceptionFrames.sweep(),
  15000,
);
globalFrames.aryPerceptionReaper.unref?.();
