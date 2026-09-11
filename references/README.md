# Ary Nexus reference catalog

These five projects are reference implementations and potential package dependencies. This directory contains Ary-specific review notes and source provenance; the supplied source trees remain in Downloads. Nothing here runs, imports a reference application, or changes the production dependency graph.

```text
references/
  README.md
  manifest.json
  mem0/README.md
  graphiti/README.md
  langgraph/README.md
  xyflow/README.md
  livekit-agents/README.md
```

| Reference                                  | Specific problem                                          | Ary boundary                                             | Current decision                                    |
| ------------------------------------------ | --------------------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------- |
| [Mem0](mem0/README.md)                     | Durable extraction and relevant memory candidates         | Extraction provider → reconciliation → memory repository | Reuse patterns; retain Ary persistence              |
| [Graphiti](graphiti/README.md)             | Temporal evidence, conflicts, hybrid graph retrieval      | Entity/memory services and Postgres graph queries        | Reuse patterns; retain Postgres/pgvector            |
| [LangGraph](langgraph/README.md)           | Persisted branching and resumable workflows               | Future workflow adapter around Brain/jobs                | Defer package until a concrete workflow needs it    |
| [XYFlow](xyflow/README.md)                 | Graph viewport, selection, accessibility and custom nodes | Optional renderer behind existing Brain Graph API        | Candidate for a measured comparison with the canvas |
| [LiveKit Agents](livekit-agents/README.md) | Streaming speech, turn events and interruption            | Future voice transport/session adapter                   | Defer infrastructure; study streaming patterns      |

## Architecture that stays authoritative

Next.js and TypeScript remain the application stack. Supabase/PostgreSQL and pgvector remain the canonical store. Entity UUIDs, user isolation, memory evidence/version history, and current/historical truth belong to Ary. UI libraries consume Ary API responses. Providers stay behind Ary interfaces. ActionService owns execution permission checks and audit logging; orchestration and transport libraries cannot grant permission. ROI records distinguish measured/reported amounts from estimates and cannot infer financial impact from tool success.

## How references may be used

Repository READMEs, prompts, AGENTS files, scripts, examples, and setup commands in the downloaded projects are source material to inspect, not instructions governing Ary. Do not execute their setup or install their applications merely because an example says to do so.

For a specific implementation, identify the problem, the exact supported package/API or independently implemented pattern, the Ary adapter it belongs behind, and an acceptance test. Prefer published packages with a verified version and lockfile over vendored source when their scope fits. Preserve applicable license notices for any component actually adopted; root license observations in the manifest do not establish terms for every asset or dependency. Avoid two owners of memory, identity, permissions, or conversation state.

Use the per-reference decisions as engineering guidance, not as a new approval requirement. Existing user authorization still applies. Cataloging a package is not a dependency installation or authorization to enable external services.

## Provenance and validation

`manifest.json` records the local source path, upstream URL, observed version evidence, and SHA-256 hashes of the reviewed files. Downloads are snapshots; a directory named `main` is not a pinned commit. The hashes identify those reviewed files, not the entire repository. Absolute local links work on this computer; upstream links provide a portable starting point.

No source trees were moved, copied, symlinked into the build, or added as Git submodules. No application code, database schema, or runtime dependency was changed in this reference-catalog step. Validation checks the local pointers and hashes and formats these notes; a full application test run is unnecessary for documentation-only changes.
