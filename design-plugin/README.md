# Ary Design — Cinema 4D adapter

This is the one native implementation of Ary's `DesignTool` port. Installed Cinema 4D: **2026.2**. It uses the official Cinema 4D Python API through a local MessageData plugin, on the main thread. No caller-supplied Python, macros, menu IDs, shell command strings, or screen coordinates are accepted.

**Native acceptance is pending.** The restricted read-only c4dpy version probe crashed before returning a version. The unrestricted probe reached a license-method prompt. No license method/account was selected; that probe was stopped. No scene was opened or modified and no plugin was installed/enabled during implementation.

## Capability boundary

| Generic operation        | Cinema 4D v1 implementation                                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Inspect document/scene   | Active document, session document ID, object GUIDs, unit scale, supported objects, revision and undo token.                     |
| Open document            | Explicit allowed `.c4d`; load detached, reject unsupported content, then activate. Existing open documents are not closed.      |
| Select object            | One exact inspected object ID; no name guessing.                                                                                |
| Create object            | Top-level box primitive with explicit name and local dimensions in mm.                                                          |
| Modify dimensions        | Absolute local dimensions of an unscaled top-level box; inherited/frozen scale, animation and unsupported objects are rejected. |
| Change material/property | Built-in object **display color** only. No material graph, shader, Python parameter or generic attribute setter.                |
| Export                   | New OBJ path, using Cinema 4D's exporter. STEP unsupported. No fake CAD solid output.                                           |
| Save                     | New `.c4d` version path; never overwrite an existing file. Save an untitled scene first before other operations.                |
| Undo                     | Only the latest unchanged Ary geometry/property edit, identified by its operation token. Not arbitrary global undo.             |
| Render/preview           | Refresh the active native viewport. No rendered image, offline render or camera/renderer inference.                             |

The scene must contain only supported boxes/groups, no tags, materials or animation. Inspection may describe unsupported objects; mutations fail closed. V1 is a deterministic primitive design adapter, not a general CAD kernel or manufacturing-grade bracket editor.

## Local activation after licensing

1. Confirm Cinema 4D opens with an active license. Do not change licensing automatically as part of setup.
2. Choose a disposable scene and specific input/output folders. Avoid whole-home or root-directory allowlists. Prepare a simple scene without materials, tags, cameras, lights or animation. An empty document can first be saved to a new allowed path through the approved `save` action.
3. Set the existing Ary server's ignored local environment:
   - `ARY_DESIGN_ENABLED=true` only for controlled acceptance.
   - `ARY_STORAGE=supabase` and `ARY_DESIGN_USER_ID` for the intended authenticated owner.
   - `ARY_DESIGN_BRIDGE_TOKEN`: a new random 32-byte secret encoded as 64 hex characters.
   - `ARY_DESIGN_ALLOWED_ROOTS`: JSON array of explicitly chosen absolute folders.
   - Preserve existing `ARY_INTEGRATION_ENCRYPTION_KEY` and other integration settings. Do not rotate this shared key casually.
4. Copy `bridge.example.json` to ignored `bridge.local.json` in this plugin folder; set `enabled`, the same bridge token and matching `allowed_roots`. Protect this file so only the owner can read it. Do not paste the token into chat, logs, source control or shared screenshots. Server encryption key is never copied into the plugin.
5. Add this plugin directory to Cinema 4D's plugin search paths through its existing preferences and restart Cinema 4D deliberately. This is a local development plugin, using ID **1000001**; obtain a unique official Maxon plugin ID before distribution. Registration fails on an ID collision; do not overwrite another plugin.
6. Start Ary's loopback server at **127.0.0.1:3000**, restart it after environment changes, and sign into the installed Ary Mac app as the configured owner. Ordinary browser sessions cannot authorize native actions.
7. In Creative → Design, inspect first, copy exact IDs, prepare a plan and use the existing approval dialog. No plugin-side direct execution button exists. Plugin connection errors appear in Cinema 4D's console; Ary explains stale/disconnected state. Polling uses a fixed loopback URL, no proxies, a short timeout and the main-thread SDK timer.

Disable `enabled` in the local plugin config and restart Cinema 4D, and set the Ary server feature flag false, to disconnect deliberately. An already executing operation may complete. Disconnection is not rollback.

## Safety/recovery model

Inspect is observe level; plan is recommend plus a separately checked inspect permission. **Every change requires approval**, even permission level 5, including selection, preview, save/export and undo. Exact operation/revision IDs are preserved through the current ToolRegistry → ActionRequestService → permissions/approval → adapter → audit/outcome flow.

The server validates owner, installed desktop session, enable flag, loopback host, absence of browser Origin/proxy headers, bearer token and allowed real paths. The plugin also checks verbs, argument keys, numeric values, object IDs, current scene revision, paths and scene restrictions. No external enqueue endpoint exists. Output files must not exist; OBJ material-sidecar collisions are also rejected in the plugin. Local file changes between validation and SDK access remain a race limitation.

The encrypted `.data/design-vault` stores transport state/claims/receipts using the existing vault primitive. Each operation is claimed durably once before delivery. Receipt transmission can retry; edits cannot. A completed receipt can be recovered after a database failure without editing again. A failed operation that may have changed geometry/files blocks new operations until operator inspection; there is intentionally no unsafe reset/delete-journal API. Do not erase this journal to retry.

Geometry/property changes use `StartUndo`/`AddUndo`/`EndUndo`. Native operations cannot atomically commit with Supabase. If a native API partially changes something, the receipt reports uncertainty rather than claiming rollback. Undo is an approved explicit operation, not automatic failure recovery. Undo tokens are session-local and invalidated by intervening state changes. Document IDs are session-local; object GUIDs are native IDs scoped to the inspected document.

Inventory: at most 200 objects, hierarchy depth 20 and existing 64 KB HTTP ceiling. Large/unsupported state fails closed. Revision checks include the scanned structure/values, native dirty counters and document identity; they are not a complete file/content signature. No multi-host or large-scene performance claim. Main-thread polling and viewport redraw can affect responsiveness. The plugin reads only its local configuration and approved files, and never starts a shell or accepts executable source.

## Controlled acceptance

On a disposable licensed document, verify inspection and actual unit conversion first. Save to a new allowed file if untitled. Reject a proposed 50×20×10 mm box, then prepare/approve it and inspect the actual dimensions. Prepare a width change to 60 mm, approve it and verify receipt and native state. Verify unchanged edit undo, external-change undo rejection, selection/color, new-path save and OBJ export, viewport redraw and refusal of STEP/scripts/overwrite. Confirm actual exported units and file contents in a compatible viewer before using geometry downstream. Record real evidence in `DESIGN_TOOL_TEST_REPORT.md`; fixture tests do not establish native acceptance.

Official references:

- [Cinema 4D 2026.2 MessageData](https://developers.maxon.net/docs/py/2026_2_0/modules/c4d.plugins/BaseData/MessageData/index.html)
- [BaseObject API](https://developers.maxon.net/docs/py/2026_2_0/modules/c4d/C4DAtom/GeListNode/BaseList2D/BaseObject/index.html)
- [Document load/save/export API](https://developers.maxon.net/docs/py/2026_1_0/modules/c4d.documents/index.html)
- [Document undo API](https://developers.maxon.net/docs/py/2026_1_0/modules/c4d.documents/BaseDocument/index.html)
- [c4dpy and licensing](https://developers.maxon.net/docs/py/2026_1_0/manuals/manual_py_c4dpy.html)
