/** Presentation routes only. Existing workspace tabs and action dispatch remain authoritative. */
export const destinations = [
  {
    id: "NEXUS",
    tab: "Graph",
    detail: "Your connected workspace",
    sections: ["Graph"],
  },
  {
    id: "ARY",
    tab: "Chat",
    detail: "Conversation, voice and context",
    sections: ["Chat"],
  },
  {
    id: "MISSIONS",
    tab: "Priority",
    detail: "Priorities, plans and tasks",
    sections: ["Priority", "Execution Plans", "Activity"],
  },
  {
    id: "AGENTS",
    tab: "Agent Runtime",
    detail: "Scoped workers and shared intelligence",
    sections: ["Agent Runtime", "Board"],
  },
  {
    id: "MEMORY",
    tab: "Memory map",
    detail: "Knowledge and its evidence",
    sections: ["Memory map", "Memories", "Memory review", "Reflection"],
  },
  {
    id: "WORLD",
    tab: "World map",
    detail: "People, projects and their context",
    sections: [
      "World map",
      "Entities",
      "Relationships",
      "Communications",
      "Calendar",
      "Finance",
      "ROI",
    ],
  },
  {
    id: "SKILLS",
    tab: "Skills",
    detail: "Available Ary capabilities",
    sections: ["Skills", "Creative", "Perception"],
  },
  {
    id: "TOOLS",
    tab: "Tools",
    detail: "Registered tools and connections",
    sections: ["Tools", "Connections", "Computer & Browser", "Studio", "Calls"],
  },
  {
    id: "AUTOMATIONS",
    tab: "Automations",
    detail: "Coordinated work and scheduling boundaries",
    sections: ["Automations"],
  },
  {
    id: "ACTIVITY",
    tab: "Action history",
    detail: "Requests, decisions and results",
    sections: ["Action history", "Approvals"],
  },
  {
    id: "SYSTEM",
    tab: "Settings",
    detail: "Permissions and workspace controls",
    sections: ["Settings", "Engineering"],
  },
] as const;
export type PrimaryDestination = (typeof destinations)[number]["id"];
export function destinationForTab(tab: string) {
  return (
    destinations.find((d) => (d.sections as readonly string[]).includes(tab)) ??
    destinations[0]
  );
}
export const sectionLabel = (tab: string) =>
  ({
    Graph: "Intelligence map",
    Chat: "Conversation",
    Activity: "Tasks & outcomes",
    Board: "Daily board",
    Settings: "Permissions & settings",
    ROI: "Economics",
  })[tab] ?? tab;
