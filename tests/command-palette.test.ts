import { describe, expect, it, vi } from "vitest";
import {
  buildCommands,
  indexCommands,
  rankCommands,
  exactVoiceDestination,
  websiteCommand,
  dispatchCommand,
  type Command,
} from "../src/components/commands/command-index";
import type { Entity, EntityAlias, Task } from "../src/domain/models";
const command = (label: string, id = label): Command => ({
  id,
  label,
  source: "module",
  aliases: [],
  detail: "",
  destination: { tab: "Chat" },
});
const entity = (id: string, name: string, metadata = {}): Entity => ({
  id,
  name,
  entity_type: "project",
  metadata,
  description: "",
  user_id: "owner",
  created_at: "2026-09-08",
  updated_at: "2026-09-08",
});
describe("universal command search", () => {
  it("strictly ranks prefix, initials, word boundary, then substring", () => {
    const ranked = rankCommands(
      indexCommands([
        command("Zulu archive"),
        command("Alpha Rally"),
        command("arbitrary"),
        command("foobar"),
      ]),
      "ar",
    );
    expect(ranked.map((r) => [r.command.label, r.tier])).toEqual([
      ["arbitrary", 0],
      ["Alpha Rally", 1],
      ["Zulu archive", 2],
      ["foobar", 3],
    ]);
    expect(
      rankCommands(indexCommands([command("Something road")]), "ro")[0].tier,
    ).toBe(2);
  });
  it("finds canonical entity by alias without changing its ID", () => {
    const commands = buildCommands(
      [entity("stable", "Wag Trails")],
      [],
      [{ entity_id: "stable", alias: "Wagtrails" } as EntityAlias],
      [],
      [],
    );
    expect(
      rankCommands(indexCommands(commands), "wagtrails")[0].command.destination,
    ).toEqual({ tab: "Entities", recordId: "entity-stable" });
  });
  it("keeps duplicate names distinct and refuses ambiguous spoken destinations", () => {
    const commands = buildCommands(
      [entity("one", "Nexus"), entity("two", "Nexus")],
      [],
      [],
      [],
      [],
    );
    const matches = rankCommands(indexCommands(commands), "Nexus");
    // The shell adds its own NEXUS destination; both same-named entities remain distinct.
    expect(
      matches.filter((hit) => hit.command.source === "project"),
    ).toHaveLength(2);
    expect(
      matches.filter((hit) => hit.command.source === "module"),
    ).toHaveLength(1);
    expect(exactVoiceDestination(commands, "Ary, open Nexus.")).toBeNull();
  });
  it("resolves a unique spoken module alias through the same index", () => {
    const commands = buildCommands([], [], [], [], []);
    expect(
      exactVoiceDestination(commands, "Ary, show Graph!")?.destination?.tab,
    ).toBe("Graph");
    expect(exactVoiceDestination(commands, "open Gra")).toBeNull();
  });
  it("has no irrelevant lexical results; limits rendered candidates", () => {
    expect(
      rankCommands(indexCommands([command("Wag Trails")]), "quantum butter"),
    ).toEqual([]);
    expect(
      rankCommands(
        indexCommands(
          Array.from({ length: 100 }, (_, i) => command(`task ${i}`)),
        ),
        "task",
      ),
    ).toHaveLength(30);
  });
  it("indexes task IDs and observed website metadata; hides development-only navigation", () => {
    const commands = buildCommands(
      [entity("one", "Wag Trails", { website: "https://example.com" })],
      [{ id: "t1", title: "Fix tracking", status: "pending" } as Task],
      [],
      [],
      [],
    );
    expect(
      commands.find((c) => c.source === "task")?.destination?.recordId,
    ).toBe("task-t1");
    expect(commands.find((c) => c.source === "website")?.execution?.tool).toBe(
      "desktop.open_website",
    );
    expect(commands.some((c) => c.label === "Reflection")).toBe(false);
  });
  it.each([
    "javascript:alert(1)",
    "file:///etc/passwd",
    "https://user:pass@example.com",
    "$(touch /tmp/invalid)",
    "not a website",
  ])("rejects unsafe/invalid website %s", (query) =>
    expect(websiteCommand(query)).toBeNull(),
  );
  it("precomputes a large workspace and searches within a conservative interactive budget", () => {
    const indexed = indexCommands(
      Array.from({ length: 10000 }, (_, i) => command(`Project ${i}`)),
    );
    const start = performance.now();
    const results = rankCommands(indexed, "project 99");
    const ms = performance.now() - start;
    expect(results).toHaveLength(30);
    expect(ms).toBeLessThan(150);
  });
});
describe("one command dispatcher", () => {
  it("navigation and action form selection do not execute a tool", async () => {
    const request = vi.fn(),
      navigate = vi.fn();
    const item = buildCommands(
      [],
      [],
      [],
      [],
      [{ name: "create_task", description: "Create real task" }],
    ).find((c) => c.source === "action")!;
    await dispatchCommand(item, { request, navigate, uuid: () => "key" });
    expect(navigate).toHaveBeenCalledWith({
      tab: "Approvals",
      tool: "create_task",
    });
    expect(request).not.toHaveBeenCalled();
  });
  it("an app selection calls only the existing action port with operation and request keys", async () => {
    const request = vi.fn().mockResolvedValue({}),
      navigate = vi.fn();
    const item = buildCommands(
      [],
      [],
      [],
      [
        {
          id: "com.apple.Music",
          path: "/System/Applications/Music.app",
          name: "Music",
        },
      ],
      [],
    ).find((c) => c.source === "app")!;
    await dispatchCommand(item, {
      request,
      navigate,
      uuid: () => "new",
      executionKeys: { operationId: "stable-op", requestKey: "stable-request" },
    });
    expect(request).toHaveBeenCalledWith({
      tool: "desktop.launch_app",
      input: { app_id: "com.apple.Music", operation_id: "stable-op" },
      request_key: "stable-request",
      reason: "User selected app: Music",
    });
    expect(navigate).not.toHaveBeenCalled();
  });
  it("retains caller-supplied execution keys on retry and propagates denial", async () => {
    const item = websiteCommand("https://example.com")!;
    const request = vi
      .fn()
      .mockRejectedValueOnce(Error("denied"))
      .mockResolvedValue({});
    const ports = {
      request,
      navigate: vi.fn(),
      uuid: () => "unused",
      executionKeys: { operationId: "op", requestKey: "request" },
    };
    await expect(dispatchCommand(item, ports)).rejects.toThrow("denied");
    await dispatchCommand(item, ports);
    expect(request.mock.calls[0][0]).toEqual(request.mock.calls[1][0]);
  });
});
