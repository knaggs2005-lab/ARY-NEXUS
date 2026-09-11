import { it, expect, vi } from "vitest";
import { createRequire } from "node:module";
const { createEngine } = createRequire(import.meta.url)(
  "../premiere-plugin/engine.js",
);
function fixture() {
  let disabled = false,
    present = true,
    locked = false;
  let counter = 0,
    markers = 0;
  const guid = (id: string) => ({ toString: () => id });
  const ticks = (seconds: number) => ({
    seconds,
    ticks: String(Math.round(seconds * 254016000000)),
  });
  const tx = vi.fn((cb: () => void) => cb());
  const media = { name: "Interview", getId: () => "media", bin: false };
  const root: {
    name: string;
    getId: () => string;
    bin: boolean;
    getItems: () => Promise<unknown[]>;
    createBinAction: (name: string) => () => void;
  } = {
    name: "Root",
    getId: () => "root",
    bin: true,
    getItems: async () => [media, ...bins],
    createBinAction: (name) => () => {
      const id = `bin-${++counter}`;
      bins.push({
        name,
        getId: () => id,
        bin: true,
        getItems: async () => [],
        createRenameBinAction: (newName: string) => () => {
          bins[0].name = newName;
        },
      });
    },
  };
  const bins: any[] = [];
  const clip = {
    getStartTime: async () => ticks(0),
    getEndTime: async () => ticks(10),
    getInPoint: async () => ticks(0),
    getOutPoint: async () => ticks(10),
    getProjectItem: async () => media,
    getName: async () => "Interview",
    isDisabled: async () => disabled,
    createSetDisabledAction: (value: boolean) => () => {
      disabled = value;
    },
  };
  const seq = {
    guid: guid("sequence"),
    name: "Interview",
    getVideoTrackCount: async () => 1,
    getAudioTrackCount: async () => 0,
    getVideoTrack: async () => ({
      getTrackItems: () => (present ? [clip] : []),
      isLocked: async () => locked,
    }),
    getPlayerPosition: async () => ticks(0),
    getEndTime: async () => ticks(10),
    getTimebase: async () => "10594584000",
    setPlayerPosition: vi.fn(
      async (_position: { ticks: string; seconds: number }) => true,
    ),
    setSelection: vi.fn(() => true),
  };
  const sequences: any[] = [seq];
  const project = {
    guid: guid("project"),
    name: "Fixture",
    path: "/fixture.prproj",
    getRootItem: async () => root,
    getSequences: async () => sequences,
    getActiveSequence: async () => seq,
    lockedAccess: tx,
    executeTransaction: vi.fn((cb: (c: unknown) => void) => {
      cb({ addAction: (fn: () => void) => fn() });
      return true;
    }),
    openSequence: vi.fn(async () => true),
    createSequenceWithPresetPath: vi.fn(async (name: string) => {
      const created = { guid: guid(`new-${++counter}`), name };
      sequences.push(created);
      return created;
    }),
    createSequenceFromMedia: vi.fn(async (name: string) => {
      const created = { guid: guid(`selects-${++counter}`), name };
      sequences.push(created);
      return created;
    }),
    importFiles: vi.fn(async () => true),
    save: vi.fn(async () => true),
  };
  const manager = {
    isAMEInstalled: true,
    exportSequence: vi.fn(async () => true),
  };
  const ppro = {
    Project: {
      getActiveProject: vi.fn(async () => project),
      open: vi.fn(async () => project),
    },
    ProjectItem: { cast: (i: unknown) => i },
    FolderItem: { cast: (i: any) => (i.bin ? i : null) },
    ClipProjectItem: { cast: (i: unknown) => i },
    SequenceEditor: {
      getEditor: () => ({
        createRemoveItemsAction: (
          _selection: unknown,
          ripple: boolean,
          _type: unknown,
          shift: boolean,
        ) => {
          if (ripple || shift) throw Error("Unsafe removal");
          return () => {
            present = false;
          };
        },
      }),
    },
    Constants: {
      MediaType: { ANY: 0 },
      TrackItemType: { CLIP: 1 },
      ExportType: { QUEUE_TO_AME: 2 },
    },
    TickTime: {
      createWithSeconds: ticks,
      createWithTicks: (value: string) => ({
        ticks: value,
        seconds: Number(value) / 254016000000,
      }),
    },
    Markers: {
      getMarkers: async () => ({
        getMarkers: async () => Array(markers).fill({}),
        createAddMarkerAction: () => () => {
          markers++;
        },
      }),
    },
    TrackItemSelection: {
      createEmptySelection: (cb: (s: unknown) => void) => {
        cb({ addItem: () => true });
        return true;
      },
    },
    EncoderManager: { getManager: () => manager },
  };
  const files = {
    existing: vi.fn(async () => {}),
    newOutput: vi.fn(async () => {}),
  };
  const engine = createEngine(ppro, files);
  const run = async (verb: string, args: unknown) =>
    engine.execute({
      verb,
      input: { args, expected_revision: (await engine.scan()).revision },
      deadline: Date.now() + 30000,
    });
  return {
    engine,
    run,
    ppro,
    files,
    project,
    root,
    seq,
    manager,
    bins,
    clip,
    lock: () => {
      locked = true;
    },
  };
}
it("captures stable state and detects project changes", async () => {
  const f = fixture();
  const first = await f.engine.scan();
  expect((await f.engine.scan()).revision).toBe(first.revision);
  f.project.name = "Changed";
  expect((await f.engine.scan()).revision).not.toBe(first.revision);
});
it("rejects stale or expired operations before touching Premiere", async () => {
  const f = fixture();
  const result = await f.engine.execute({
    verb: "save_project",
    input: { expected_revision: "old", args: {} },
    deadline: Date.now() + 1000,
  });
  expect(result).toMatchObject({ ok: false, may_have_changed: false });
  expect(f.project.save).not.toHaveBeenCalled();
  expect(
    (
      await f.engine.execute({
        verb: "save_project",
        input: { args: {} },
        deadline: 0,
      })
    ).ok,
  ).toBe(false);
});
it("opens an explicit existing project", async () => {
  const f = fixture();
  expect((await f.run("open_project", { path: "/fixture.prproj" })).ok).toBe(
    true,
  );
  expect(f.files.existing).toHaveBeenCalledWith("/fixture.prproj", ".prproj");
  expect(f.ppro.Project.open).toHaveBeenCalledWith("/fixture.prproj");
});
it("opens an existing sequence by exact ID", async () => {
  const f = fixture();
  expect((await f.run("open_sequence", { sequence_id: "sequence" })).ok).toBe(
    true,
  );
  expect(f.project.openSequence).toHaveBeenCalledWith(f.seq);
  expect(
    (await f.run("open_sequence", { sequence_id: "similar-name" }))
      .may_have_changed,
  ).toBe(false);
});
it("creates a sequence with its existing preset, never deletes a sequence", async () => {
  const f = fixture();
  expect(
    (
      await f.run("create_sequence", {
        name: "New",
        preset_path: "/preset.sqpreset",
      })
    ).result.sequence_id,
  ).toMatch(/^new/);
  expect(
    (
      await f.run("create_sequence", {
        name: "New",
        preset_path: "/preset.sqpreset",
      })
    ).ok,
  ).toBe(false);
  expect(f.project.createSequenceWithPresetPath).toHaveBeenCalledTimes(1);
});
it("imports explicit files into the selected bin", async () => {
  const f = fixture();
  expect(
    (await f.run("import_media", { paths: ["/clip.mov"], bin_id: "root" })).ok,
  ).toBe(true);
  expect(f.project.importFiles).toHaveBeenCalledWith(
    ["/clip.mov"],
    true,
    f.root,
    false,
  );
});
it("creates and renames bins using undoable transactions", async () => {
  const f = fixture();
  const created = await f.run("create_bin", {
    parent_id: "root",
    name: "Review",
  });
  expect(created.result.added_items[0].name).toBe("Review");
  expect(
    (await f.run("rename_bin", { bin_id: "bin-1", name: "Selects" })).ok,
  ).toBe(true);
  expect(f.bins[0].name).toBe("Selects");
  expect(
    (await f.run("rename_bin", { bin_id: "root", name: "Bad" }))
      .may_have_changed,
  ).toBe(false);
  expect(f.project.executeTransaction).toHaveBeenCalledTimes(2);
});
it("selects only explicit current track items", async () => {
  const f = fixture();
  expect((await f.run("select_clips", { clip_ids: ["video:0:0"] })).ok).toBe(
    true,
  );
  expect(f.seq.setSelection).toHaveBeenCalledOnce();
  expect(
    (await f.run("select_clips", { clip_ids: ["video:0:9"] })).may_have_changed,
  ).toBe(false);
});
it("creates bounded markers and rejects out-of-sequence time", async () => {
  const f = fixture();
  expect(
    (
      await f.run("create_markers", {
        markers: [{ name: "Review", seconds: 2 }],
      })
    ).ok,
  ).toBe(true);
  expect(
    (
      await f.run("create_markers", {
        markers: [{ name: "Outside", seconds: 99 }],
      })
    ).may_have_changed,
  ).toBe(false);
});
it("rough selects preserves explicit media order and source timeline", async () => {
  const f = fixture();
  const r = await f.run("create_selects", {
    name: "Rough",
    media_ids: ["media"],
    bin_id: "root",
  });
  expect(r.ok).toBe(true);
  expect(r.result.media_ids).toEqual(["media"]);
  expect(f.project.createSequenceFromMedia).toHaveBeenCalledTimes(1);
  expect(f.project.executeTransaction).not.toHaveBeenCalled();
});
it("converts non-drop timecode with fractional frame rate and checks bounds", async () => {
  const f = fixture();
  expect((await f.run("jump_timecode", { timecode: "00:00:01:00" })).ok).toBe(
    true,
  );
  expect(f.seq.setPlayerPosition.mock.calls[0][0].ticks).toBe(
    String(24n * 10594584000n),
  );
  expect((await f.run("jump_timecode", { timecode: "00:00:01:24" })).ok).toBe(
    false,
  );
  expect((await f.run("jump_timecode", { timecode: "00:00:01;00" })).ok).toBe(
    false,
  );
});
it("export returns submitted, not a fabricated completed render", async () => {
  const f = fixture();
  const r = await f.run("export_sequence", {
    preset_path: "/preset.epr",
    output_path: "/new.mp4",
  });
  expect(r).toMatchObject({
    ok: true,
    result: { export_status: "submitted", render_complete: false },
  });
  expect(f.files.newOutput).toHaveBeenCalledWith("/new.mp4");
});
it("saves the actual project and flags an uncertain SDK failure", async () => {
  const f = fixture();
  expect((await f.run("save_project", {})).result.saved_path).toBe(
    "/fixture.prproj",
  );
  f.project.save.mockResolvedValue(false);
  expect(await f.run("save_project", {})).toMatchObject({
    ok: false,
    may_have_changed: true,
  });
});
it("SDK exceptions after a mutation are uncertain, never successful", async () => {
  const f = fixture();
  f.project.importFiles.mockRejectedValue(Error("Interrupted"));
  expect(
    await f.run("import_media", { paths: ["/clip.mov"], bin_id: "root" }),
  ).toMatchObject({ ok: false, may_have_changed: true });
});
it.each(["delete_sequence", "eval", "exec", "shutdown"])(
  "unknown verb %s is never dispatched",
  async (verb) => {
    const f = fixture();
    expect((await f.run(verb, {})).may_have_changed).toBe(false);
    expect(f.project.executeTransaction).not.toHaveBeenCalled();
  },
);

it("reads source ranges, tracks and disabled state", async () => {
  const f = fixture(),
    s = await f.engine.scan();
  expect(s.clips[0]).toMatchObject({
    source_id: "media",
    track_kind: "video",
    track_index: 0,
    disabled: false,
    source_in: "0",
  });
  expect(s.supported_verbs).toContain("remove_clips");
});
it("sets clip state in a native transaction and verifies it", async () => {
  const f = fixture();
  expect(
    await f.run("set_clips_enabled", {
      clip_ids: ["video:0:0"],
      enabled: false,
    }),
  ).toMatchObject({ ok: true });
  expect((await f.engine.scan()).clips[0].disabled).toBe(true);
  expect(f.project.executeTransaction).toHaveBeenCalledOnce();
});
it("native removal is non-ripple with exact read-back", async () => {
  const f = fixture();
  expect(
    await f.run("remove_clips", { clip_ids: ["video:0:0"], ripple: false }),
  ).toMatchObject({ ok: true });
  expect((await f.engine.scan()).clips).toHaveLength(0);
});
it("refuses ripple, duplicate clips and locked targets before mutation", async () => {
  for (const args of [
    { clip_ids: ["video:0:0"], ripple: true },
    { clip_ids: ["video:0:0", "video:0:0"], ripple: false },
  ]) {
    const f = fixture();
    expect(await f.run("remove_clips", args)).toMatchObject({
      ok: false,
      may_have_changed: false,
    });
    expect(f.project.executeTransaction).not.toHaveBeenCalled();
  }
  const f = fixture();
  f.lock();
  expect(
    await f.run("set_clips_enabled", {
      clip_ids: ["video:0:0"],
      enabled: false,
    }),
  ).toMatchObject({ ok: false, may_have_changed: false });
});
it("does not claim success when the native transaction is rejected", async () => {
  const f = fixture();
  f.project.executeTransaction.mockImplementation(() => false);
  expect(
    await f.run("set_clips_enabled", {
      clip_ids: ["video:0:0"],
      enabled: false,
    }),
  ).toMatchObject({ ok: false, may_have_changed: true });
  expect((await f.engine.scan()).clips[0].disabled).toBe(false);
});
it("a no-op native change fails read-back instead of claiming success", async () => {
  const f = fixture();
  f.clip.createSetDisabledAction = () => () => {};
  expect(
    await f.run("set_clips_enabled", {
      clip_ids: ["video:0:0"],
      enabled: false,
    }),
  ).toMatchObject({ ok: false, may_have_changed: true });
});
