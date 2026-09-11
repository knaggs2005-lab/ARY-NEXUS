import { describe, expect, it } from "vitest";
import {
  destinations,
  destinationForTab,
} from "../src/components/nexus/destinations";
import {
  buildCommands,
  exactVoiceDestination,
} from "../src/components/commands/command-index";

describe("Nexus shell presentation routing", () => {
  it("provides eleven distinct primary destinations", () => {
    expect(destinations.map((d) => d.id)).toEqual([
      "NEXUS",
      "ARY",
      "MISSIONS",
      "AGENTS",
      "MEMORY",
      "WORLD",
      "SKILLS",
      "TOOLS",
      "AUTOMATIONS",
      "ACTIVITY",
      "SYSTEM",
    ]);
  });
  it("retains a destination for every original workspace screen", () => {
    for (const tab of [
      "Calls",
      "Creative",
      "Studio",
      "Execution Plans",
      "Perception",
      "Communications",
      "Calendar",
      "Board",
      "Priority",
      "Approvals",
      "Action history",
      "Finance",
      "ROI",
      "Settings",
      "Reflection",
      "Chat",
      "Memory review",
      "Memories",
      "Entities",
      "Relationships",
      "Graph",
      "Activity",
    ])
      expect(destinationForTab(tab).sections).toContain(tab);
  });
  it("maps task and audit contexts distinctly without changing their underlying tabs", () => {
    expect(destinationForTab("Activity").id).toBe("MISSIONS");
    expect(destinationForTab("Action history").id).toBe("ACTIVITY");
    expect(destinationForTab("Approvals").id).toBe("ACTIVITY");
  });
  it("makes the same primary destinations available to typed and voice commands", () => {
    const commands = buildCommands([], [], [], [], []);
    for (const d of destinations) {
      const command = exactVoiceDestination(commands, `open ${d.id}`);
      expect(command?.destination?.tab, d.id).toBe(d.tab);
      expect(command?.execution).toBeUndefined();
    }
  });
  it("preserves the dev-only reflection boundary in the command palette", () => {
    expect(
      buildCommands([], [], [], [], []).some((c) => c.label === "Reflection"),
    ).toBe(false);
    expect(
      buildCommands([], [], [], [], [], true).some(
        (c) => c.label === "Reflection",
      ),
    ).toBe(true);
  });
});
