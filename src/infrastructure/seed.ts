import type { Repository } from "../domain/repository";
import { EntityService } from "../services/entity-service";
import { MemoryService } from "../services/memory-service";
/** Only facts from the project brief. The Wag Trails description is intentionally unspecified. */
export async function seed(
  repository: Repository,
  entities: EntityService,
  memories: MemoryService,
) {
  const clevaryn =
    (await entities.findEntity("Clevaryn")) ??
    (await entities.createEntity({
      name: "Clevaryn",
      entity_type: "company",
      description:
        "Company included in the Ary Nexus workspace. Further details await confirmation.",
      metadata: { seed: true },
    }));
  const wag =
    (await entities.findEntity("Wag Trails")) ??
    (await entities.createEntity({
      name: "Wag Trails",
      entity_type: "project",
      description:
        "Seed project. Scope, ownership, and status await confirmation.",
      metadata: { seed: true },
    }));
  const ary =
    (await entities.findEntity("Ary Nexus")) ??
    (await entities.createEntity({
      name: "Ary Nexus",
      entity_type: "project",
      description:
        "The central hub for Ary’s persistent intelligence: memory, entities, relationships, goals, decisions, and actions.",
      metadata: { seed: true },
    }));
  const existing = await repository.list("relationships");
  for (const target of [clevaryn, wag])
    if (
      !existing.some(
        (r) =>
          r.source_entity_id === ary.id &&
          r.target_entity_id === target.id &&
          r.relationship_type === "tracks",
      )
    )
      await entities.linkEntities({
        source_entity_id: ary.id,
        target_entity_id: target.id,
        relationship_type: "tracks",
        strength: 1,
        metadata: {
          seed: true,
          meaning: "Included in this workspace; does not imply ownership",
        },
      });
  const facts = [
    {
      entity: ary,
      content:
        "Ary Nexus is the central hub where Ary’s memory, projects, people, companies, goals, decisions, relationships, tools, actions, and future integrations live.",
      importance_score: 1,
    },
    {
      entity: ary,
      content:
        "Ary is a persistent AI intelligence system. Ary Nexus must prioritize structured long-term memory and working memory retrieval.",
      importance_score: 0.95,
    },
    {
      entity: ary,
      content:
        "Ary Nexus uses Next.js, TypeScript, PostgreSQL, Supabase, and pgvector with a provider-agnostic LLM interface.",
      importance_score: 0.9,
    },
    {
      entity: clevaryn,
      content:
        "Clevaryn is a company included in the Ary Nexus seed workspace.",
      importance_score: 0.6,
    },
    {
      entity: wag,
      content:
        "Wag Trails is included in the Ary Nexus workspace. Its project scope and ownership have not yet been specified.",
      importance_score: 0.6,
    },
  ];
  const stored = await repository.list("memories");
  for (const fact of facts) {
    const memory =
      stored.find((m) => m.content === fact.content) ??
      (await memories.createMemory({
        content: fact.content,
        importance_score: fact.importance_score,
        confidence_score: 1,
        metadata: { seed: true, source: "initial_project_brief" },
      }));
    await memories.linkMemoryToEntity(memory.id, fact.entity.id);
  }
  if (
    !(await repository.list("goals")).some(
      (g) => g.title === "Establish the Ary Nexus memory foundation",
    )
  ) {
    const goal = await repository.insert("goals", {
      entity_id: ary.id,
      title: "Establish the Ary Nexus memory foundation",
      description:
        "Build structured memory, retrieval, relationships, and an inspectable brain pipeline.",
      status: "active",
      progress: 0,
      target_date: null,
      metadata: { seed: true },
    });
    await repository.insert("decisions", {
      entity_id: ary.id,
      goal_id: goal.id,
      title: "Keep the LLM provider replaceable",
      rationale: "The system must use a provider-agnostic LLM interface.",
      status: "accepted",
      confidence_score: 1,
      decided_at: new Date().toISOString(),
      metadata: { seed: true },
    });
    await repository.insert("tasks", {
      entity_id: ary.id,
      goal_id: goal.id,
      title: "Validate retrieval with real project memories",
      description:
        "Add confirmed facts and inspect which memories each response retrieves.",
      status: "pending",
      priority: 1,
      due_at: null,
      metadata: { seed: true },
    });
  }
}
