# Learning-source onboarding audit — September 10, 2026

Status: PARTIAL. User requested learning across Ary conversations, work documents and connected apps. This is not model-weight training or permission to execute external actions.

## Existing systems preserved

- AryBrainService already extracts memories after conversation replies through memory.extract and MemoryReconciliationService, retaining source messages and retryable extraction jobs.
- MemoryService/NexusMemoryService preserve evidence, entity links, contradictions and version history. Knowledge is separate; no universal background filesystem importer exists.
- ReflectionService is deterministic and reviewable. Installed-app inspection showed completed reflection jobs, including the latest learning-preference turn, and six pending literal-summary proposals. None were accepted during this source audit.
- OutcomeEngine proposes evidence-based, reversible advice; acceptance does not rewrite core instructions or permissions.
- Existing ToolRegistry/actions, permissions, approvals and audit infrastructure remain unchanged.

## Verified source status

| Source | Observed status |
| --- | --- |
| Ary conversations | Live: learning preference saved as one new memory in the installed Supabase-backed app. |
| Existing projects/tasks | Available inside Ary; not equivalent to importing all past work. |
| Wag Trails project documents | Source-backed extraction completed; reviewed scope correction preserves the historical placeholder. Live paraphrased recall passed with semantic + entity retrieval. |
| Clevaryn project documents | Source-backed positioning and home-page descriptions saved with dated document/hash attribution; live paraphrased recall passed. Empty root README was not used. |
| Ary Nexus documentation | Canonical roadmap inspected; not bulk-imported. |
| Calendar | Personal account OAuth and a live seven-day read passed. Multi-account support implemented and tested; work OAuth succeeded after tester addition. After the owner resolved the Workspace subscription blocker, fresh audited seven-day reads passed for both accounts (work: zero events; personal: one; both complete). See calendar-multi-account.md. |
| Gmail | Personal Gmail connected read-only September 10. Bounded search, one selected-thread read, Clevaryn entity context and attributed summary passed through existing actions. No permanent memory or sending enabled. See GMAIL_TEST_REPORT.md. |
| Screens/cameras | No learning capture enabled. Existing hand tracking was temporarily stopped to stabilize UI navigation; its frames were not ingested. |

## Source-import outcome and recovery

A native multiline entry submitted an introductory message before the excerpts. Ary correctly said no documents were supplied, and extraction reported two saved memories; their contents still require inspection and are not claimed as project facts.

The complete source excerpts were then submitted as one message. That message is retained, but its extraction failed at the configured 20-second model-routing timeout with no partial memory changes. Retry the existing failed extraction job through Memory review; do not resubmit it as a new import. The answer also incorrectly routed to Finance because the source note contained the word financial; no financial records were provided or learned. Neither defect is marked fixed.

### Recovery and live acceptance — September 10, 16:13 PDT

- After the user unlocked/signed in, the installed server reused a broken HTTP/2 connection (`ERR_HTTP2_INVALID_SESSION`). Supabase auth settings were reachable from a fresh process (HTTP 200, 467 ms). Temporary diagnostics contained only error class/status/code, never credentials, and were removed. Restarting Ary's local server and retrying restored authenticated dashboard HTTP 200. The app's misleading authentication/profile error translation remains a defect; no authentication bypass was added.
- Original extraction job `e0255171-23d4-455d-8aba-398df2a1e77d`, source message `7bb6eeb1-a34c-4bbd-8bcd-399a0e7c35ca`, failed again at 20,006 ms. Existing `ARY_MODEL_ROUTER_TASKS` configuration was extended only for extraction: per-attempt and total deadlines are now 60,000 ms. All other task settings, models and permission policies are preserved. `.env.local` remains git-ignored and mode 0600.
- Retrying that same job succeeded: real `gpt-5.6-sol` extraction took 21,167 ms; four candidates, 1,303 input tokens (1,300 cached), 1,295 output tokens, estimated model cost $0.026432; full retry endpoint returned HTTP 200 in 27.8 seconds. No new duplicate source job was submitted. Memory review reports all extraction jobs complete.
- The source-backed scope correction was reviewed through the existing UI. Prior Wag Trails placeholder memory `a5300f38-41de-4a1d-b38c-916a29487784` is superseded with its old active snapshots and the contradicting source quote preserved. Current review queue reports zero unresolved facts. Ownership remains unproven.
- A separate conversation asked what kind of studio Clevaryn is and what Wag Trails helps people do. Real OpenAI reasoning succeeded in 5,621 ms (8,228 ms response latency), retrieved eight memories, estimated reasoning cost $0.018220. Retrieved context shows the Wag Trails README as rank 1 (semantic cosine 0.6599 plus entity), Clevaryn positioning rank 2 (0.5138 plus entity), and the cited home-page description rank 4. The response correctly attributed the project descriptions. Query-only extraction completed with no new durable memories.
- Regression verification: 81 existing tests passed across model-router (33), nexus-memory (34), reflection (10), model-router-brain (4), using the existing isolated verification checkout. No production build was rerun because no application source change remains; temporary auth instrumentation was removed. No new schema or dependency was added.

## Next work

1. Inspect the two introductory-message memories before broader ingestion; source extraction, reviewed history and separate-conversation recall are now verified.
2. Diagnose the source-text/Finance routing false positive before broader ingestion.
3. Connect Calendar read-only through the existing consent flow; configure Gmail separately without enabling sending.
4. Design a bounded, source-selectable document ingestion workflow using existing knowledge/memory/action services, with excludes, change detection, source hashes, pause/delete controls and usage limits. Do not sweep credentials or system/browser stores.

No application code, schemas, model selection or permission policies changed in this onboarding audit. The only runtime configuration change is the bounded extraction deadline override described above. Subsequent Calendar work connected the personal account and added multi-account support; work authorization and subsequent live read both succeeded after the owner resolved the Workspace subscription blocker; personal read was reverified. Later September 10 setup connected personal Gmail read-only and verified search/read/summary; see the current Gmail report. No unattended file watcher or camera learning was enabled.
