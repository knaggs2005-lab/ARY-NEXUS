# Reflection v1 test report

Reflection v1 is implemented and migration `202609060005_reflection.sql` was applied successfully to the existing Supabase workspace on September 6, 2026.

- **75 automated tests passed**, including 10 reflection service tests and PostgreSQL audit/RLS/transaction checks.
- Production Next.js build, TypeScript, and formatting checks passed.
- All five proposal kinds are covered by isolated fixtures: memory summaries, relationship deactivation, procedural lessons, outcome goal links, and importance adjustments.
- Acceptance preserves evidence, reviewer identity/reason, before/after snapshots and version history. Confirmed memory content and confidence remain unchanged by summary/importance proposals.
- Rejection leaves knowledge untouched. Reviewed proposals are immutable; retrying the same acceptance does not apply changes twice.
- Stale evidence fails closed. PostgreSQL verifies that an invalid review rolls back the memory update and its version-trigger effect atomically.
- Queue tests cover after-extraction enqueueing, lease exclusion/recovery, failed extraction dependencies, and failed commit/retry behavior. Production review APIs return 404.

## Live verification

A normal chat asking “What is Ary Nexus's current architectural priority?” completed using the configured OpenAI provider, without extracting a new durable memory. Its source message automatically created a reflection job, which completed on attempt 1 after the response through Next.js `after()`.

The development panel displayed inspection of six memories, one accepted decision, zero conflicts/corrections, zero completed tasks, and two related outcomes. It showed six pending literal-summary proposals, with evidence snapshots and review reasons required before acceptance or rejection. No proposals were accepted or rejected on the user's behalf, and the workspace retained six active memories. Browser warning/error logs were empty.

The live workspace did not contain completed task/outcome chains or unresolved conflicts for this run; their behavior is verified with isolated automated fixtures rather than fabricated production records.

## Scope and limitations

V1 uses deterministic rules and adds no reflection LLM calls. It does not generate broad semantic generalizations or decide conflicting user facts. Memory updates currently add missing literal summaries; lessons retain observed task outcomes without causal inference. Reflection still reads workspace tables server-side before applying category caps.

Background work uses a durable database queue with Next.js `after()`, not an independent always-running worker. Pending or expired work needs a subsequent chat request or explicit development retry after a server interruption. Failed extraction must be completed first. The development panel and review APIs are unavailable in production; automatic proposal generation is separately controlled by `ARY_REFLECTION_ENABLED`.
