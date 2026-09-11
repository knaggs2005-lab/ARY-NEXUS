import { isCurrentRelationship } from "./relationship-validity";
import {
  EntityResolutionService,
  entityNameKey,
} from "./entity-resolution-service";
import { z } from "zod";
import type { Repository } from "../domain/repository";
import {
  entityInput,
  relationshipInput,
  required,
  AppError,
} from "../domain/validation";
export class EntityService {
  constructor(private repository: Repository) {}
  async createEntity(input: z.input<typeof entityInput>) {
    const data = entityInput.parse(input);
    if (
      (await this.repository.list("entity_aliases")).some(
        (a) => entityNameKey(a.alias) === entityNameKey(data.name),
      )
    )
      throw new AppError(
        "This name is already an alias; use the existing entity",
        409,
      );
    return this.repository.insert("entities", data);
  }
  async addAlias(entityId: string, raw: string) {
    const alias = z.string().trim().min(1).max(200).parse(raw).toLowerCase();
    required(await this.repository.get("entities", entityId), "Entity");
    const [entities, aliases] = await Promise.all([
      this.repository.list("entities"),
      this.repository.list("entity_aliases"),
    ]);
    if (
      entities.some(
        (e) =>
          e.id !== entityId && entityNameKey(e.name) === entityNameKey(alias),
      ) ||
      aliases.some(
        (a) =>
          entityNameKey(a.alias) === entityNameKey(alias) &&
          a.entity_id !== entityId,
      )
    )
      throw new AppError(
        "Alias is already associated with another entity",
        409,
      );
    return (
      aliases.find((a) => entityNameKey(a.alias) === entityNameKey(alias)) ??
      this.repository.insert("entity_aliases", { entity_id: entityId, alias })
    );
  }
  async resolveMentions(text: string) {
    return new EntityResolutionService(this.repository).resolve(text);
  }
  async resolveEntities(text: string) {
    return (await this.resolveMentions(text)).entities;
  }
  async findEntity(idOrName: string) {
    const key = entityNameKey(idOrName);
    const all = await this.repository.list("entities");
    const id = all.find((e) => e.id === idOrName);
    if (id) return id;
    const direct = all.filter((e) => entityNameKey(e.name) === key);
    if (direct.length) return direct.length === 1 ? direct[0] : null;
    const aliases = await this.repository.list("entity_aliases");
    const ids = new Set(
      aliases
        .filter((a) => entityNameKey(a.alias) === key)
        .map((a) => a.entity_id),
    );
    return ids.size === 1 ? (all.find((e) => ids.has(e.id)) ?? null) : null;
  }
  async searchEntities(query = "") {
    const [entities, aliases] = await Promise.all([
      this.repository.list("entities"),
      this.repository.list("entity_aliases"),
    ]);
    const key = entityNameKey(query);
    const ids = new Set(
      aliases
        .filter((a) => entityNameKey(a.alias).includes(key))
        .map((a) => a.entity_id),
    );
    return entities.filter(
      (e) =>
        entityNameKey(`${e.name} ${e.description}`).includes(key) ||
        ids.has(e.id),
    );
  }

  async linkEntities(input: z.input<typeof relationshipInput>) {
    const data = relationshipInput.parse(input);
    if (
      data.valid_from &&
      data.valid_to &&
      Date.parse(data.valid_from) >= Date.parse(data.valid_to)
    )
      throw new AppError("Validity end must follow start");
    required(
      await this.repository.get("entities", data.source_entity_id),
      "Source entity",
    );
    required(
      await this.repository.get("entities", data.target_entity_id),
      "Target entity",
    );
    return this.repository.insert("relationships", data);
  }
  async endRelationship(id: string) {
    const edge = required(
      await this.repository.get("relationships", id),
      "Relationship",
    );
    if (edge.valid_from && Date.parse(edge.valid_from) >= Date.now())
      throw new AppError("A future relationship cannot end before it begins");
    return this.repository.update("relationships", id, {
      valid_to: new Date().toISOString(),
    });
  }
  async getEntityGraph(rootId?: string, depth = 2) {
    const [nodes, allEdges] = await Promise.all([
      this.repository.list("entities"),
      this.repository.list("relationships"),
    ]);
    const edges = allEdges.filter(isCurrentRelationship);
    if (!rootId) return { nodes, edges };
    required(nodes.find((n) => n.id === rootId) ?? null, "Entity");
    const ids = new Set([rootId]);
    for (let i = 0; i < Math.max(0, Math.min(depth, 5)); i++) {
      const before = new Set(ids);
      for (const edge of edges)
        if (
          before.has(edge.source_entity_id) ||
          before.has(edge.target_entity_id)
        ) {
          ids.add(edge.source_entity_id);
          ids.add(edge.target_entity_id);
        }
    }
    return {
      nodes: nodes.filter((n) => ids.has(n.id)),
      edges: edges.filter(
        (e) => ids.has(e.source_entity_id) && ids.has(e.target_entity_id),
      ),
    };
  }
}

export { isCurrentRelationship } from "./relationship-validity";
