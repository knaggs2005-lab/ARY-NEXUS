# Brain graph query verification — 2026-09-06

- Full automated suite: **96 tests passed**. TypeScript, production build, and formatting checks passed.
- Graph-specific checks: **20 tests** covering both local JSON and real PostgreSQL/PGlite execution, with the same synthetic fixture.
- Migration 006 runs after 001–005 and can be reapplied without changing facts or identities.
- Live authenticated Supabase query: **3 nodes, 2 edges**. Ary Nexus has 4 current connected memories, importance 1, and its active foundation goal. Wag Trails and Clevaryn each have 1 connected memory and importance 0.6.
- Live indexed search: `Nexus` filtered to projects returns only the existing Ary Nexus ID. `quasar telescope` returns no nodes or edges.
- Live two-hop Ary Nexus neighborhood: succeeded, same three workspace entities.
- Development sample inspector: **7 nodes, 7 current edges**; sample trail import shows its dataset-review blocker and linked sample goal.
- Automated temporal checks exclude future/expired/archived memories and stale evidence from current edges; ended/inactive edges are available through historical filtering. Completed blockers disappear.
- Security checks: other tenants cannot discover nodes through roots, scopes or search; anonymous RPC access fails. The sample API is hidden in production.
- Bounds: a fixture with 550 hub neighbors and a cycle returns at most 100 nodes and the requested 20 edges, with truncation flags. Search pagination has no duplicate IDs across pages.

Limits: no production-scale latency SLO was measured. Large hub aggregates still scan indexed related records to compute exact counts. Blocker/goal details are capped at 10 per node; count fields expose overflow. Historical edge filtering uses latest stored records and validity/evidence state, not a past audit snapshot. Existing entity statuses remain unknown until explicitly supplied. The legacy SVG still uses the development dashboard snapshot; the new visual renderer should consume the bounded brain-graph API.
