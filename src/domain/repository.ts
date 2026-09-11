import type { MissionRepository } from "./mission";
import type { MapReadRepository } from "./nexus-map";
import type { NexusEventRepository } from "./nexus-events";
import type { GraphReadRepository } from "./brain-graph";
import type { Table, Tables, NewRecord, MemoryHit } from "./models";
export type Mutation =
  | {
      kind: "delete_memory";
      table: "memories";
      id: string;
      expected_updated_at: string;
    }
  | {
      [K in Table]:
        | { kind: "insert"; table: K; id?: string; data: NewRecord<Tables[K]> }
        | {
            kind: "update";
            table: K;
            id: string;
            data: Partial<NewRecord<Tables[K]>>;
            expected_updated_at?: string;
          };
    }[Table]
  | { kind: "check"; table: Table; id: string; expected_updated_at: string };
/** A repository is created for ONE authenticated user. Implementations must enforce that scope. */
export interface Repository
  extends
    GraphReadRepository,
    NexusEventRepository,
    MapReadRepository,
    MissionRepository {
  readonly userId: string;
  /** Production adapters fail closed if durable action-key support is not installed. */
  ensureActionExecutionKeys?(): Promise<void>;
  consumeApproval(
    id: string,
    fingerprint: string,
    policyHash: string,
  ): Promise<boolean>;
  /** All mutations commit together; expected_updated_at is a compare-and-swap guard. */
  batch(mutations: Mutation[]): Promise<void>;
  list<K extends Table>(
    table: K,
    filter?: Partial<Tables[K]>,
  ): Promise<Tables[K][]>;
  get<K extends Table>(table: K, id: string): Promise<Tables[K] | null>;
  insert<K extends Table>(
    table: K,
    input: NewRecord<Tables[K]>,
  ): Promise<Tables[K]>;
  update<K extends Table>(
    table: K,
    id: string,
    patch: Partial<NewRecord<Tables[K]>>,
  ): Promise<Tables[K]>;
  /** Independent top-100 semantic/lexical pools, with source ranks. limit=200 preserves their union. */
  search(
    query: string,
    embedding: number[],
    model: string,
    limit: number,
    version?: string,
    minSimilarity?: number,
    scope?: { conversationId?: string },
  ): Promise<MemoryHit[]>;
}
