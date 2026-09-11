# Ary Perception v1 — September 8, 2026

## Scope and audit

Audited `ARY_NEXUS_ROADMAP.md`, existing ToolRegistry/action request/permission/approval/outcome interfaces, provider telemetry, server authentication/origin handling, desktop media policy and the camera/voice UI. Camera capture already existed for hand tracking and audio for Voice; there was no visual-understanding provider or Perception service. Those working streams and the existing brain remain untouched.

Implemented on-demand, separately approved capture and analysis. No second action pipeline, brain, memory system or camera polling service. No schema migration, production environment edit, package installation, hardware configuration or real screen/camera capture was performed.

## Exact additions

| Files                                                                                     | Purpose                                                                                                                            |
| ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `src/domain/perception.ts`                                                                | Bounded source/frame/request/finding contracts and `VisionProvider`.                                                               |
| `src/infrastructure/perception/frame-store.ts`                                            | Owner-scoped one-use grants and bounded expiring RAM buffers, hashes, claim/cleanup.                                               |
| `src/infrastructure/providers/openai-vision.ts`                                           | Existing Responses transport with image inputs, structured findings, `store:false`, no model tools, existing usage/cost telemetry. |
| `src/services/perception-service.ts`                                                      | Recheck source policy, stage, claim images, analyze and clear; owned action linkage.                                               |
| `src/infrastructure/tools/perception-tools.ts`                                            | Register source grants, analysis and cleanup behind existing approvals/action execution.                                           |
| `src/components/perception/capture.ts`                                                    | Swappable capture interface; one-frame browser capture, image normalization and track cancellation.                                |
| `src/components/perception/perception-panel.tsx`, `perception.module.css`                 | Source/preview/approval/active state, inspect/verify/compare and evidence report.                                                  |
| `tests/perception.test.ts`, `tests/perception-capture.test.ts`                            | 31 focused tests.                                                                                                                  |
| `scripts/perception-fixtures.ts`, `evaluate-perception.ts`, `evaluate-perception-live.ts` | Synthetic image generator, isolated UI acceptance and real-model acceptance. Uses already-installed Sharp only for test images.    |
| `PERCEPTION_TEST_REPORT.md`                                                               | This acceptance record.                                                                                                            |

## Exact existing files extended

| File                                                                | Necessary extension                                                                                                                                                   |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/domain/permissions.ts`                                         | Distinct source and analysis definitions, mandatory approval ceiling, temporary stage/clear permission.                                                               |
| `src/services/action-request-service.ts`                            | Optional Perception registry dependency; source-action scope, request key, real-tool label and no automatic memory conversion. Existing signatures remain compatible. |
| `src/infrastructure/providers/openai.ts`                            | Export existing request/response parser for reuse; no changed model or reasoning behavior.                                                                            |
| `src/server/context.ts`                                             | Wire configured vision provider, action-linked telemetry and request cancellation signal.                                                                             |
| `src/server/http.ts`                                                | Authenticated exact-origin bounded binary frame upload; all analysis still uses existing action endpoint.                                                             |
| `src/components/dashboard.tsx`                                      | Add Perception navigation/rendering.                                                                                                                                  |
| `src/components/commands/command-index.ts`                          | Add same Perception destination to ⌘K.                                                                                                                                |
| `src/components/action-center.tsx`                                  | Show visual findings on the resulting action.                                                                                                                         |
| `desktop/main.cjs`, `desktop/security.cjs`                          | Exact-origin display permission and native user-selected screen picker; deny unsupported fallback.                                                                    |
| `.env.example`, `package.json`, `README.md`, `ARY_NEXUS_ROADMAP.md` | Optional vision settings, two acceptance commands, privacy/setup guidance and honest milestone status.                                                                |

## Verification

- **857 tests / 56 files passed**, including 31 Perception tests. Existing memory/retrieval, entity, temporal facts, graph, action, integration and device-adapter regression tests preserved.
- **TypeScript passed. Formatting passed. Production build passed.** No separate lint script configured.
- Isolated browser acceptance uses real Next UI, approval dialogs, HTTP/action flow and LocalRepository with synthetic uploaded files and a clearly labeled fixture vision provider. Checks source rejection, approved uploads, before/after previews, separate analysis approval, correct audited compare mode, preview removal, image-free audit and no additional provider execution on replay.
- Real-provider acceptance uses the configured environment key and `gpt-5.6-sol`, the existing permission/approval/action services, temporary LocalRepository and synthetic before/after images. **Succeeded**. It identified an Export Media dialog in frame 2, absent in frame 1, and explicitly refused to infer a completed export.

| Real successful call metric               | Result                                                     |
| ----------------------------------------- | ---------------------------------------------------------- |
| Model                                     | `gpt-5.6-sol` / OpenAI Responses                           |
| Latency                                   | **5,856 ms**, one sample, not an average/SLA               |
| Input / output tokens                     | **1,310 / 235**                                            |
| Estimated model cost                      | **$0.00994**, existing price estimate, not an invoice      |
| Replayed successful action                | **1 total provider call**, no extra call                   |
| Image buffers / temporary fixture records | Removed; no Supabase test account or real user record used |

The initial network-restricted live attempt failed with a sanitized network/timeout error and cleaned its fixtures. The single authorized network-enabled rerun succeeded. No model allowlist, billing, key or project setting was changed. Browser harness corrections addressed an overlapping small viewport and an ambiguous selector that did not select the analysis control; the final test uses a precise control selector and checks both its value and the actual audited mode rather than trusting the displayed fixture result.

Focused cases: levels 0–3 denied capture, level 5 still requires approval, rejection, one-use grants, tenant isolation, source-policy revocation before stage/analysis, expiry, input size/type/dimensions, altered frame references, foreign action references, image cleanup on failure, no raw bytes in logs/audit, success replay, exact-origin upload rejection, no provider tool authority, invalid model frame citations, no upload-triggered camera, OS denial translation, wrong display source stopped and late camera permission resolution after cancellation stopped.

## Privacy and limits

- Explicit source approval permits one frame; OS permission/picker still applies. Separate analysis approval sends only selected images/question to the configured provider. No entire database context, model tool calls, automatic device effects or permanent image memory.
- Server image data is RAM-only, unavailable after five minutes; idle cleanup runs every 15 seconds. Images are claimed before analysis, cleared afterward even on failure, and cannot be reanalyzed without recapture. Successful action replay returns the saved report. This is bounded single-process storage; restarts/multi-instance routing require fresh capture. Clearing buffers is best effort, not secure erasure of all runtime copies.
- Findings, questions, hashes and source labels persist in existing action/outcome history. Descriptions can themselves be sensitive. Provider `store:false` does not override account retention/data sharing rules or promise zero retention. Cancellation cannot recall already submitted data.
- Browser canvas normalization removes file metadata from normal UI submissions. Server checks compressed headers and bounds, not a complete image decode; direct API image authenticity is not attested. Source labels are declared/selected provenance, and `received_at` is ingestion time, not proof of original capture time.
- Visual verification means evidence for a visible criterion. It does not change the original action's success, confirm a permanent user fact, prove device causality or prove an export file exists. Confidence is a model estimate, not calibrated certainty.
- Studio input currently means a selected OS camera or uploaded frame. No automatic studio feed, RTSP or remote image URL retrieval. Small text, altered viewpoints, lighting, occlusion and fabricated uploads limit conclusions.
- Camera/screen permission dialogs can remain pending at the OS level after cancellation; late streams are stopped immediately. No further frame is submitted. Electron uses macOS 15+ native system picker when supported, with deny-only fallback. A main-process app restart is required for that new handler.

## Physical acceptance still required

No real microphone, webcam, studio camera, screen, Premiere, CAD or light was activated to produce these results. **Do not mark physical Perception acceptance DONE.** With the user present:

1. Restart Ary desktop. Open Perception. Confirm no camera indicator before choosing a source.
2. Approve exactly one harmless window/screen; choose it in the native picker. Check preview and sharing indicator stops after one frame. Deny once and check the error; verify wrong source type is rejected.
3. Approve one webcam/studio frame, capture, then cancel/leave the panel; verify the OS camera indicator extinguishes. Do not change OS privacy settings automatically.
4. Approve inspection of a harmless visible error. Compare two controlled frames around a known dialog change and link to its owned action. Check evidence, limitations, original action unchanged and no retained image preview after analysis.
5. Reject analysis and confirm no model call; repeat a saved successful request and confirm no second call. Check the Action History report and actual screenshot/camera quality.

Recommended next step is this controlled acceptance, not another integration. No following milestone was started.
