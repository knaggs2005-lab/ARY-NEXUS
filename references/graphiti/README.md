# graphiti: Temporal knowledge and graph retrieval

Reference source: [graphiti-main](/Users/austin/Downloads/graphiti-main/). Upstream: [graphiti](https://github.com/getzep/graphiti).

Observed package: `graphiti-core` · snapshot version `0.24.1` · root license `Apache-2.0`. Version evidence: `pyproject.toml`. These are local snapshot values, not recommended installation pins.

## Relevant source files

- [graphiti_core/edges.py](/Users/austin/Downloads/graphiti-main/graphiti_core/edges.py)
- [graphiti_core/search/search.py](/Users/austin/Downloads/graphiti-main/graphiti_core/search/search.py)
- [graphiti_core/search/search_config_recipes.py](/Users/austin/Downloads/graphiti-main/graphiti_core/search/search_config_recipes.py)
- [graphiti_core/utils/maintenance/dedup_helpers.py](/Users/austin/Downloads/graphiti-main/graphiti_core/utils/maintenance/dedup_helpers.py)

## Ary boundary and adoption decision

Relevant components: fact validity/expiration and episode provenance in `edges.py`; semantic, lexical, and BFS candidate retrieval with RRF in `search.py`; search recipes and entity deduplication helpers.

Ary ownership: memory/relationship validity fields and version/evidence tables, `EntityService`, `MemoryReconciliationService`, `graph-retrieval.ts`, and `GraphQueryService`. Keep event validity distinct from when Ary learned or revised a fact. An entity candidate must resolve to an existing canonical UUID; similar names alone cannot authorize a merge.

Decision: retain temporal and retrieval patterns. Do not install `graphiti-core` now: the supplied runtime is Python and its manifest uses graph-store dependencies such as Neo4j, with optional alternative drivers. This is not a drop-in Postgres/pgvector service. No second graph database, custom Graphiti driver, or parallel source of truth is justified for the current requirements.

Acceptance: graph-only recall, bounded 1–2 hop paths, tenant/status/time filters, explicit historical relationships, evidence retention, and ambiguous-name suppression. Compare behavior with Ary's hybrid retrieval and database tests.
