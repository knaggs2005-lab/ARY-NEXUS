# mem0: Memory extraction and retrieval

Reference source: [mem0-main](/Users/austin/Downloads/mem0-main/). Upstream: [mem0](https://github.com/mem0ai/mem0).

Observed package: `mem0ai` · snapshot version `3.1.8` · root license `Apache-2.0`. Version evidence: `mem0-ts/package.json`. These are local snapshot values, not recommended installation pins.

## Relevant source files

- [mem0/memory/main.py](/Users/austin/Downloads/mem0-main/mem0/memory/main.py)
- [mem0/configs/prompts.py](/Users/austin/Downloads/mem0-main/mem0/configs/prompts.py)
- [mem0/vector_stores/pgvector.py](/Users/austin/Downloads/mem0-main/mem0/vector_stores/pgvector.py)

## Ary boundary and adoption decision

Use as a pattern reference for bounded conversation extraction, evidence-bearing candidates, duplicate handling, and memory history. The inspected Python extraction implementation uses additive extraction; do not assume every Mem0 version implements the same update/merge algorithm.

Ary ownership: `src/domain/providers.ts` (`MemoryExtractionProvider`), `src/services/memory-reconciliation-service.ts`, `src/services/memory-service.ts`, and `src/services/graph-retrieval.ts`. Candidate extraction must still pass through Ary's validation, conflict review, stable entity IDs, and versioned persistence.

Package candidate: `mem0ai` (the supplied TypeScript manifest exports an OSS entry point). A full Mem0 memory engine would introduce another persistence model. Its pgvector support alone does not make its schema interchangeable with Ary's Supabase tables. Keep it outside Ary's canonical writes; do not install a memory engine just to reuse a prompt. Revisit only if a supported extraction-only adapter or isolated benchmark proves a concrete improvement.

Acceptance: semantic/paraphrased recall, empty-context suppression, corrections, cross-tenant isolation, idempotent extraction retries, and preservation of user-confirmed facts. Reuse Ary's existing provider, retrieval, and memory tests. No source has been copied in this cataloging step.
