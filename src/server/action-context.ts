import { desktopRequestAuthorized } from "../infrastructure/desktop/security";
import type { Repository } from "../domain/repository";
import type { ActionContext } from "../domain/permissions";
import { createHash } from "node:crypto";
import { AppError } from "../domain/validation";
/** Context comes from the authenticated request and owned record links, never an LLM permission claim. */
export async function actionContext(
  request: Request,
  repo: Repository,
): Promise<ActionContext> {
  const url = new URL(request.url);
  let raw = "";
  let body_hash = "";
  if (request.body) {
    const reader = request.clone().body!.getReader();
    const hash = createHash("sha256");
    let size = 0;
    const chunks: Uint8Array[] = [];
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 5 * 1024 * 1024) {
        void reader.cancel();
        throw new AppError("Request too large", 413);
      }
      hash.update(value);
      if (size <= 65536) chunks.push(value);
    }
    body_hash = hash.digest("hex");
    if (
      size <= 65536 &&
      request.headers.get("content-type")?.includes("application/json")
    )
      raw = Buffer.concat(chunks).toString();
  }
  const ids = new Set<string>();
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  for (const segment of url.pathname.split("/"))
    if (uuid.test(segment)) ids.add(segment);
  for (const key of ["root", "scope"]) {
    const value = url.searchParams.get(key);
    if (value && uuid.test(value)) ids.add(value);
  }
  try {
    const input = JSON.parse(raw);
    for (const key of [
      "entity_id",
      "source_entity_id",
      "target_entity_id",
      "memory_id",
      "product_entity_id",
    ]) {
      if (typeof input[key] === "string" && uuid.test(input[key]))
        ids.add(input[key]);
    }
  } catch {
    /* Non-JSON audio has no entity scope. */
  }
  const products = new Set<string>();
  if (ids.size) {
    const [entities, links, relations] = await Promise.all([
      repo.list("entities"),
      repo.list("memory_entities"),
      repo.list("relationships"),
    ]);
    for (const link of links)
      if (ids.has(link.memory_id)) ids.add(link.entity_id);
    // Current explicit project/company/product neighbors also constrain linked record actions.
    for (const edge of relations)
      if (
        !edge.valid_to &&
        (ids.has(edge.target_entity_id) || ids.has(edge.source_entity_id))
      ) {
        products.add(edge.target_entity_id);
        products.add(edge.source_entity_id);
      }
    for (const entity of entities)
      if (
        ["company", "project", "product"].includes(entity.entity_type) &&
        (ids.has(entity.id) || products.has(entity.id))
      )
        products.add(entity.id);
      else products.delete(entity.id);
  }
  return {
    workspace: "ary-nexus",
    desktopAuthorized: desktopRequestAuthorized(request),
    productIds: [...products].sort(),
    request: {
      method: request.method,
      path: url.pathname + url.search,
      body_hash,
      preview: raw
        ? raw
        : { content_type: request.headers.get("content-type") },
    },
    approvalId: request.headers.get("x-ary-approval-id") ?? undefined,
  };
}
