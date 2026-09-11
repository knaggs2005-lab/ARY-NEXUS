# Ary Creative Bridge

Dedicated UXP panel for Premiere Pro **26.3+**. The installed Mac has Premiere 26.3.2; native acceptance is still pending. This plugin is separate from the existing Clevaryn AI Editor.

## Deliberate local setup

1. Choose a **disposable copy** of a Premiere project and a small media folder. Put copies of the required `.sqpreset`/`.epr` presets and an export folder within allowed roots. Open and save that disposable project in Premiere. Do not test against an unsaved production project.
2. Configure the ignored Ary server environment, without posting secrets in chat:
   - `ARY_STORAGE=supabase` and existing Supabase credentials.
   - `ARY_PREMIERE_USER_ID`: the intended authenticated owner's UUID.
   - `ARY_PREMIERE_ALLOWED_ROOTS`: a JSON array of absolute, deliberately chosen folders. Do not use `/` or the whole home folder.
   - `ARY_PREMIERE_BRIDGE_TOKEN`: a new cryptographically random 32-byte value encoded as 64 hex characters.
   - Existing `ARY_INTEGRATION_ENCRYPTION_KEY`: preserve its value; other integrations already use it. Do not rotate it as part of this setup.
   - `ARY_PREMIERE_ENABLED=true` only when ready for controlled testing.
3. Restart the existing local Ary server on **127.0.0.1:3000** and use the installed Ary desktop app with the configured owner. The normal browser cannot authorize native Premiere actions. The existing desktop session handshake remains authoritative; the separate Desktop Bridge feature flag is not an additional Premiere requirement.
4. In Adobe UXP Developer Tools, add this directory's `manifest.json`, then load **Ary Creative Bridge**. The manifest requests filesystem access for approved absolute files and network access only to Ary's loopback origin. This is a local development plugin, not a signed Marketplace release. Leave the existing Clevaryn plugin unchanged.
5. Open the Ary Creative Bridge panel in Premiere. Enter the same local bridge token and select **Connect**. The token stays in plugin memory and the input clears. It is not written to plugin storage. The panel polls every two seconds and displays project/revision or a connection error.
6. In Ary, open **Creative → Inspect Premiere**. Use the exact IDs displayed, prepare a plan and review it through the existing approval dialog. A fresh plan is required after the inspected project/sequence inventory changes.

Do not weaken the native-origin/host checks to work around a connection failure. The real UXP handshake has not yet been verified on this Mac; capture the status and validate the supported transport before enabling edits. HTTP 403 can mean owner/session, bridge flag, host/origin or token mismatch. Missing/stale state means the UXP panel is disconnected or its inventory is too large. Native SDK/privacy errors are retained in the operation receipt; inspect Premiere and macOS permissions rather than retrying unknown edits.

## Controlled acceptance checklist

- Inspect the intended disposable project; verify its path, sequence, bins and media IDs.
- Prepare a new bin; reject once and confirm nothing changed. Prepare again, approve once, verify the actual bin and Ary's action/outcome receipt.
- Replay the exact approved request and confirm no duplicate bin. Change the active sequence after planning and verify stale execution is rejected.
- On the disposable project only, verify all remaining verbs: open project/sequence, preset-based sequence, import, rename bin, select clips, markers, ordered rough selects, seek, save, and export to a **new** output path.
- For export, verify AME submission separately from completed output. Never label queue acceptance as a rendered file.
- Disconnect before pickup and inspect timeout/expiry behavior. Do not deliberately crash a production project to test uncertain completion. An uncertain native operation blocks further edits; inspect its audit/receipt and actual Premiere state. There is intentionally no reset/delete-guard button.
- For legacy operations, confirm no existing clips were moved, trimmed or deleted. For the new explicitly approved clip removal/state actions, confirm only the exact reviewed instances changed, inspect the remaining timeline and test native Undo. Confirm no unrelated project was modified. Retain evidence in `PREMIERE_TEST_REPORT.md`; only then mark native acceptance complete.

## Supported boundaries

- Every change requires Ary approval, including opening/saving/exporting. Plugin controls connect/disconnect only; they do not offer unaudited edits.
- Hard-coded UXP API calls, no shell, `eval`, arbitrary scripts, menu automation or coordinate clicks.
- New bins, rename and markers use Adobe undoable transactions. Other APIs may have partial effects on failure; errors conservatively mark uncertainty and block automatic retry.
- Exact operation receipts can recover a completed edit if the action database write later fails. Claimed edits are never redelivered. Receipt delivery retries while connected; a process crash may require manual inspection.
- V1 is bounded to small inventories: up to 500 sequences, 2,000 project items, 2,000 active timeline clips, 100 tracks per type, depth 20, and the existing 64 KB HTTP body ceiling. Incomplete/oversized state fails closed. No large-project performance claim.
- Revision checks cover the scanned project, IDs, active sequence, clip positions/in/out/source, player position and marker count. They do not fingerprint every effect, preset file or asset byte. Stop playback before inspection/planning. Local file changes between validation and Adobe use remain a limitation.
- Timecode is **non-drop HH:MM:SS:FF relative to sequence start**. Drop-frame notation and display-start offsets are not supported. Markers use seconds.
- Rough selects copies the chosen source media into a **new sequence**, using existing source in/out marks. This whole-media operation does not perform transcript-directed range edits. Separate reviewed clip-state and non-ripple-removal operations are now available in 0.2.0.
- Encrypted receipts are a single-host transport journal; existing Supabase actions/outcomes remain the canonical action history. Do not delete that journal or rotate its encryption key to retry an uncertain edit.

## Official API references

- [Premiere UXP reference](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/)
- [Project operations](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/project/)
- [Sequence operations](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/sequence/)
- [EncoderManager](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/encodermanager/)
- [UXP manifest permissions](https://developer.adobe.com/premiere-pro/uxp/plugins/concepts/manifest/)

## Version 0.2.0

New optional inventory fields expose source media paths/offline flags, timeline source ranges/track/state and host-supported verbs. The server preserves the prior snapshot contract; new timeline operations require this updated capability report. Upgrade/reload server and plugin together. Source analysis runs in Nexus after approval and does not modify the native timeline.

`set_clips_enabled` and `remove_clips` use native undoable transactions and read-back. Removal permits only `ripple=false`, affects explicitly selected instances, leaves gaps and never deletes source files. Linked audio/video not selected remains. There is no claim of reliable track-lock discovery or cross-process rollback; native acceptance on disposable media is still required. See [the professional integration report](../docs/nexus-premiere-professional.md) for exact bounds and tests.
