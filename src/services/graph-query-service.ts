import {
  graphQuerySchema,
  type GraphReadRepository,
} from "../domain/brain-graph";

/** Independent read model: no LLM calls, identity creation, or knowledge mutations. */
export class GraphQueryService {
  constructor(private readonly repository: GraphReadRepository) {}
  query(input: unknown = {}) {
    return this.repository.queryGraph(graphQuerySchema.parse(input));
  }
  neighborhood(entityId: string, input: Record<string, unknown> = {}) {
    return this.query({ ...input, root: entityId });
  }
  searchNodes(query: string, input: Record<string, unknown> = {}) {
    return this.query({ ...input, q: query, root: undefined });
  }
}
