# langgraph: Durable multi-step work

Reference source: [langgraph-main](/Users/austin/Downloads/langgraph-main/). Upstream: [langgraph](https://github.com/langchain-ai/langgraph).

Observed package: `langgraph` · snapshot version `1.2.11` · root license `MIT`. Version evidence: `libs/langgraph/pyproject.toml`. These are local snapshot values, not recommended installation pins.

## Relevant source files

- [libs/langgraph/langgraph/graph/state.py](/Users/austin/Downloads/langgraph-main/libs/langgraph/langgraph/graph/state.py)
- [libs/langgraph/langgraph/types.py](/Users/austin/Downloads/langgraph-main/libs/langgraph/langgraph/types.py)
- [libs/checkpoint-postgres/README.md](/Users/austin/Downloads/langgraph-main/libs/checkpoint-postgres/README.md)

## Ary boundary and adoption decision

Relevant components: explicit state transitions, checkpointing, interrupts/resume, and separation of resumable execution from side effects. In the supplied `interrupt()` documentation, resumption starts the node again. Code before an interrupt can run again; replay is not an exactly-once guarantee.

Ary ownership: `AryBrainService`, extraction jobs, `ReflectionService`, and `ActionService`. The existing linear Brain pipeline and database job records remain appropriate. Do not turn every service into an agent or replace the current permission/approval ledger with an orchestration checkpoint.

Decision: pattern reference now. If a specific workflow needs persisted branching and crash-safe resume beyond the current jobs, evaluate the JavaScript `@langchain/langgraph` package behind a dedicated workflow adapter. The supplied core manifest is Python; the repository's JavaScript SDK directory should not be mistaken for the JavaScript local orchestration engine. Use the appropriate maintained package, not a Python port copied into TypeScript.

A future adapter must persist tenant-scoped workflow IDs, reference canonical Ary records instead of checkpointing entire memory databases, and place effectful work behind `ActionService` with durable idempotency keys. After resumption, permissions and exact-request approval validity must be rechecked; a checkpoint must never grant permission.

Acceptance: restart mid-step, duplicate delivery, single-use approval replay, cancellation, and failure recovery without duplicate actions, outcomes, or ROI charges. Current jobs should only be replaced after such a workflow demonstrates a need.

Primary JavaScript documentation checked for the package alternative: [interrupts and resume](https://docs.langchain.com/oss/javascript/langgraph/interrupts).
