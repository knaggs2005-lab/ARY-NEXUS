/* Dedicated Adobe UXP adapter. No shell, eval, menu IDs, or coordinate automation. */
const VERBS = [
  "open_project",
  "open_sequence",
  "create_sequence",
  "import_media",
  "create_bin",
  "rename_bin",
  "select_clips",
  "create_markers",
  "create_selects",
  "jump_timecode",
  "export_sequence",
  "save_project",
  "set_clips_enabled",
  "remove_clips",
];
function createEngine(ppro, files) {
  let signature = "",
    revision = "",
    generation = 0;
  const session = Date.now().toString(36);
  let handles;
  function transaction(project, label, build) {
    let ok = false;
    project.lockedAccess(() => {
      ok = project.executeTransaction(build, label);
    });
    if (!ok) throw Error("Premiere rejected the undoable transaction.");
  }
  async function scan() {
    const project = await ppro.Project.getActiveProject();
    const items = [],
      sequences = [],
      clips = [],
      details = [];
    const itemMap = new Map(),
      sequenceMap = new Map(),
      clipMap = new Map();
    let complete = true,
      sequence = null;
    async function visit(item, parent, depth) {
      if (items.length >= 2000 || depth > 20) {
        complete = false;
        return;
      }
      const id = String(ppro.ProjectItem.cast(item).getId());
      let bin = null;
      try {
        bin = ppro.FolderItem.cast(item);
      } catch {}
      items.push({
        id,
        name: String(item.name),
        parent_id: parent,
        kind: bin ? "bin" : "media",
      });
      if (!bin) {
        try {
          const media = ppro.ClipProjectItem.cast(item);
          if (media && typeof media.getMediaFilePath === "function")
            items[items.length - 1].media_path = await media.getMediaFilePath();
          if (media && typeof media.isOffline === "function")
            items[items.length - 1].offline = await media.isOffline();
        } catch {
          /* Non-media project items have no readable source path. */
        }
      }
      itemMap.set(id, bin || item);
      if (bin)
        for (const child of await bin.getItems())
          await visit(child, id, depth + 1);
    }
    if (project) {
      await visit(await project.getRootItem(), null, 0);
      const all = await project.getSequences();
      if (all.length > 500) complete = false;
      for (const s of all.slice(0, 500)) {
        const id = s.guid.toString();
        sequences.push({ id, name: String(s.name) });
        sequenceMap.set(id, s);
      }
      sequence = await project.getActiveSequence();
      if (sequence) {
        for (const kind of ["video", "audio"]) {
          const count = await (kind === "video"
            ? sequence.getVideoTrackCount()
            : sequence.getAudioTrackCount());
          if (count > 100) {
            complete = false;
            break;
          }
          for (let t = 0; t < count; t++) {
            const track = await (kind === "video"
              ? sequence.getVideoTrack(t)
              : sequence.getAudioTrack(t));
            const locked =
              typeof track.isLocked === "function"
                ? await track.isLocked()
                : null;
            const allClips = await track.getTrackItems(
              ppro.Constants.TrackItemType.CLIP,
              false,
            );
            for (let n = 0; n < allClips.length; n++) {
              if (clips.length >= 2000) {
                complete = false;
                break;
              }
              const c = allClips[n],
                id = `${kind}:${t}:${n}`;
              const start = await c.getStartTime(),
                end = await c.getEndTime();
              clips.push({
                id,
                name: await c.getName(),
                start: String(start.ticks),
                end: String(end.ticks),
                source_id: String((await c.getProjectItem()).getId()),
                source_in: String((await c.getInPoint()).ticks),
                source_out: String((await c.getOutPoint()).ticks),
                track_kind: kind,
                track_index: t,
                ...(locked === null ? {} : { locked }),
                ...(typeof c.isDisabled === "function"
                  ? { disabled: await c.isDisabled() }
                  : {}),
              });
              clipMap.set(id, c);
              details.push([
                String((await c.getInPoint()).ticks),
                String((await c.getOutPoint()).ticks),
                (await c.getProjectItem()).getId(),
              ]);
            }
          }
        }
        details.push(String((await sequence.getPlayerPosition()).ticks));
        const markers = await ppro.Markers.getMarkers(sequence);
        details.push((await markers.getMarkers()).length);
      }
    }
    const editor = sequence && ppro.SequenceEditor?.getEditor(sequence);
    const supported = VERBS.filter((v) => {
      if (v === "create_sequence")
        return !!project?.createSequenceWithPresetPath;
      if (v === "create_selects") return !!project?.createSequenceFromMedia;
      if (v === "set_clips_enabled")
        return (
          clips.length > 0 &&
          [...clipMap.values()].every(
            (c) =>
              typeof c.createSetDisabledAction === "function" &&
              typeof c.isDisabled === "function",
          )
        );
      if (v === "remove_clips") return !!editor?.createRemoveItemsAction;
      return true;
    });
    const state = {
      project_id: project ? project.guid.toString() : null,
      project_name: project ? String(project.name) : "",
      project_path: project ? String(project.path) : "",
      sequence_id: sequence ? sequence.guid.toString() : null,
      sequences,
      items,
      clips,
      complete,
      supported_verbs: supported,
      ticks_per_second: "254016000000",
      ...(sequence ? { timebase: String(await sequence.getTimebase()) } : {}),
    };
    const next = JSON.stringify([state, details]);
    if (signature !== next) {
      signature = next;
      revision = `${session}-${++generation}`;
    }
    handles = { project, sequence, itemMap, sequenceMap, clipMap };
    return { revision, ...state };
  }
  const exact = (map, id, label) => {
    const value = map.get(id);
    if (!value) throw Error(`${label} is no longer available.`);
    return value;
  };
  const requireTrue = (ok) => {
    if (!ok) throw Error("Premiere did not confirm this operation.");
  };
  async function execute(job) {
    let changed = false;
    try {
      if (
        !job ||
        !VERBS.includes(job.verb) ||
        !job.input ||
        !job.input.args ||
        Date.now() > job.deadline
      )
        throw Error("Invalid or expired Premiere action.");
      const before = await scan();
      if (before.revision !== job.input.expected_revision || !before.complete)
        throw Error(
          "Premiere state changed after review. Reinspect and obtain a new approval.",
        );
      const { project, sequence, itemMap, sequenceMap, clipMap } = handles;
      if (!before.supported_verbs.includes(job.verb))
        throw Error("Native operation unavailable on this host.");
      const a = job.input.args,
        verb = job.verb;
      if (verb !== "open_project" && !project)
        throw Error("No active project.");
      if (
        [
          "set_clips_enabled",
          "remove_clips",
          "select_clips",
          "create_markers",
          "jump_timecode",
          "export_sequence",
        ].includes(verb) &&
        !sequence
      )
        throw Error("No active sequence.");
      const bin = (id) => {
        const item = exact(itemMap, id, "Bin");
        if (!before.items.some((i) => i.id === id && i.kind === "bin"))
          throw Error("Expected a bin.");
        return item;
      };
      const details = {};
      // API calls execute once after all operation-specific preconditions have passed.
      if (verb === "open_project") {
        await files.existing(a.path, ".prproj");
        changed = true;
        const opened = await ppro.Project.open(a.path);
        if (!opened) throw Error("Project did not open.");
        details.project_id = opened.guid.toString();
      } else if (verb === "open_sequence") {
        const target = exact(sequenceMap, a.sequence_id, "Sequence");
        changed = true;
        requireTrue(await project.openSequence(target));
      } else if (verb === "create_sequence") {
        if (before.sequences.some((s) => s.name === a.name))
          throw Error("Sequence name already exists.");
        await files.existing(a.preset_path, ".sqpreset");
        changed = true;
        const created = await project.createSequenceWithPresetPath(
          a.name,
          a.preset_path,
        );
        if (!created) throw Error("Sequence creation was not confirmed.");
        details.sequence_id = created.guid.toString();
      } else if (verb === "import_media") {
        const target = bin(a.bin_id);
        for (const path of a.paths) await files.existing(path);
        changed = true;
        requireTrue(await project.importFiles(a.paths, true, target, false));
        details.imported_paths = a.paths;
      } else if (verb === "create_bin") {
        const parent = bin(a.parent_id);
        if (
          before.items.some(
            (i) => i.parent_id === a.parent_id && i.name === a.name,
          )
        )
          throw Error("A sibling with that name exists.");
        changed = true;
        transaction(project, "Ary: create bin", (c) =>
          c.addAction(parent.createBinAction(a.name, false)),
        );
      } else if (verb === "rename_bin") {
        const target = bin(a.bin_id);
        const original = before.items.find((i) => i.id === a.bin_id);
        if (!original.parent_id) throw Error("Cannot rename the project root.");
        if (
          before.items.some(
            (i) =>
              i.id !== a.bin_id &&
              i.parent_id === original.parent_id &&
              i.name === a.name,
          )
        )
          throw Error("A sibling with that name exists.");
        changed = true;
        transaction(project, "Ary: rename bin", (c) =>
          c.addAction(target.createRenameBinAction(a.name)),
        );
        details.bin_id = a.bin_id;
      } else if (verb === "select_clips") {
        const targets = a.clip_ids.map((id) => exact(clipMap, id, "Clip"));
        changed = true;
        requireTrue(
          ppro.TrackItemSelection.createEmptySelection((selection) => {
            for (const clip of targets)
              requireTrue(selection.addItem(clip, false));
            requireTrue(sequence.setSelection(selection));
          }),
        );
        details.selected_clip_ids = a.clip_ids;
      } else if (verb === "set_clips_enabled" || verb === "remove_clips") {
        if (!before.supported_verbs.includes(verb))
          throw Error("Native timeline operation unavailable.");
        if (
          !Array.isArray(a.clip_ids) ||
          !a.clip_ids.length ||
          a.clip_ids.length > 100 ||
          new Set(a.clip_ids).size !== a.clip_ids.length
        )
          throw Error("Invalid clip selection.");
        if (verb === "set_clips_enabled" && typeof a.enabled !== "boolean")
          throw Error("Invalid enabled state.");
        if (verb === "remove_clips" && a.ripple !== false)
          throw Error("Ripple removal is not supported.");
        const targets = a.clip_ids.map((id) => exact(clipMap, id, "Clip"));
        const selected = before.clips.filter((c) => a.clip_ids.includes(c.id));
        if (selected.some((c) => c.locked === true))
          throw Error("Selected track is locked.");
        if (verb === "set_clips_enabled") {
          const ops = targets.map((c) => c.createSetDisabledAction(!a.enabled));
          changed = true;
          transaction(project, "Ary: reviewed clip state", (compound) =>
            ops.forEach((op) => compound.addAction(op)),
          );
        } else {
          const editor = ppro.SequenceEditor.getEditor(sequence);
          requireTrue(
            ppro.TrackItemSelection.createEmptySelection((selection) => {
              targets.forEach((c) => requireTrue(selection.addItem(c, false)));
              const op = editor.createRemoveItemsAction(
                selection,
                false,
                ppro.Constants.MediaType.ANY,
                false,
              );
              changed = true;
              transaction(
                project,
                "Ary: reviewed non-ripple removal",
                (compound) => compound.addAction(op),
              );
            }),
          );
        }
        details.reviewed_clips = selected;
        details.undo =
          "Premiere native Undo; do not automatically retry uncertain results";
      } else if (verb === "create_markers") {
        const end = (await sequence.getEndTime()).seconds;
        if (a.markers.some((m) => m.seconds > end))
          throw Error("Marker falls outside the sequence.");
        const markers = await ppro.Markers.getMarkers(sequence);
        changed = true;
        transaction(project, "Ary: create markers", (c) => {
          for (const m of a.markers)
            c.addAction(
              markers.createAddMarkerAction(
                m.name,
                "Comment",
                ppro.TickTime.createWithSeconds(m.seconds),
                ppro.TickTime.createWithSeconds(0),
                m.comments || "",
              ),
            );
        });
        details.markers = a.markers;
      } else if (verb === "create_selects") {
        const target = bin(a.bin_id);
        if (before.sequences.some((s) => s.name === a.name))
          throw Error("Sequence name already exists.");
        const media = a.media_ids.map((id) => {
          if (!before.items.some((i) => i.id === id && i.kind === "media"))
            throw Error("Expected source media.");
          return ppro.ClipProjectItem.cast(exact(itemMap, id, "Media"));
        });
        if (media.some((m) => !m))
          throw Error("Selects require compatible media items.");
        changed = true;
        const created = await project.createSequenceFromMedia(
          a.name,
          media,
          target,
        );
        if (!created) throw Error("Selects creation was not confirmed.");
        details.sequence_id = created.guid.toString();
        details.media_ids = a.media_ids;
        details.assembly =
          "Ordered source items using their existing in/out marks. No autonomous shot selection or source timeline edits.";
      } else if (verb === "jump_timecode") {
        if (!/^\d{2}:[0-5]\d:[0-5]\d:\d{2}$/.test(a.timecode))
          throw Error("Use non-drop HH:MM:SS:FF, relative to sequence start.");
        const base = BigInt(await sequence.getTimebase()),
          fps = Number(254016000000n) / Number(base),
          parts = a.timecode.split(":").map(Number);
        const nominal = Math.round(fps);
        if (parts[3] >= nominal)
          throw Error("Timecode frame number exceeds the sequence frame rate.");
        const frames = BigInt(
          (parts[0] * 3600 + parts[1] * 60 + parts[2]) * nominal + parts[3],
        );
        const position = ppro.TickTime.createWithTicks(String(frames * base));
        if (position.seconds > (await sequence.getEndTime()).seconds)
          throw Error("Timecode is beyond sequence end.");
        changed = true;
        requireTrue(await sequence.setPlayerPosition(position));
        details.timecode = a.timecode;
      } else if (verb === "export_sequence") {
        await files.existing(a.preset_path, ".epr");
        await files.newOutput(a.output_path);
        const manager = ppro.EncoderManager.getManager();
        if (!manager.isAMEInstalled)
          throw Error("Adobe Media Encoder is required for queued export.");
        changed = true;
        requireTrue(
          await manager.exportSequence(
            sequence,
            ppro.Constants.ExportType.QUEUE_TO_AME,
            a.output_path,
            a.preset_path,
            true,
          ),
        );
        details.export_status = "submitted";
        details.output_path = a.output_path;
        details.preset_path = a.preset_path;
        details.render_complete = false;
      } else if (verb === "save_project") {
        if (!before.project_path)
          throw Error(
            "Save the project to an explicit path in Premiere first.",
          );
        changed = true;
        requireTrue(await project.save());
        details.saved_path = before.project_path;
      }
      const after = await scan();
      if (
        verb === "set_clips_enabled" &&
        a.clip_ids.some(
          (id) => after.clips.find((c) => c.id === id)?.disabled !== !a.enabled,
        )
      )
        throw Error(
          "Clip state read-back did not confirm the requested change.",
        );
      if (verb === "remove_clips") {
        const signature = (c) =>
          JSON.stringify([
            c.name,
            c.source_id,
            c.source_in,
            c.source_out,
            c.track_kind,
            c.track_index,
            c.start,
            c.end,
            c.disabled,
          ]);
        const expected = before.clips
          .filter((c) => !a.clip_ids.includes(c.id))
          .map(signature)
          .sort();
        if (
          JSON.stringify(expected) !==
          JSON.stringify(after.clips.map(signature).sort())
        )
          throw Error(
            "Timeline read-back differs from the approved non-ripple removal. Inspect before retry.",
          );
      }
      return {
        ok: true,
        may_have_changed: changed,
        error: null,
        result: {
          verb,
          before_revision: before.revision,
          after_revision: after.revision,
          project_id: after.project_id,
          sequence_id: after.sequence_id,
          ...details,
          added_items: after.items.filter(
            (i) => !before.items.some((b) => b.id === i.id),
          ),
          simulated: false,
        },
      };
    } catch (error) {
      return {
        ok: false,
        may_have_changed: changed,
        error: String(error.message || error).slice(0, 1500),
        result: {},
      };
    }
  }
  return { scan, execute };
}
module.exports = { createEngine, VERBS };
