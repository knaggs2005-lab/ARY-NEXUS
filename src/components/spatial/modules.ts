export const modules = [
  {
    id: "home",
    name: "Home",
    code: "01",
    symbol: "◌",
    tab: "Chat",
    detail: "A conversation with everything you know.",
    metric: "memories",
  },
  {
    id: "brain",
    name: "Brain",
    code: "02",
    symbol: "◇",
    tab: "Graph",
    detail: "Memory, entities and their connections.",
    metric: "entities",
  },
  {
    id: "projects",
    name: "Projects",
    code: "03",
    symbol: "▦",
    tab: "Entities",
    detail: "Living projects. Grounded in real progress.",
    metric: "projects",
  },
  {
    id: "tasks",
    name: "Tasks",
    code: "04",
    symbol: "≋",
    tab: "Activity",
    detail: "Intent becomes reviewed, traceable work.",
    metric: "tasks",
  },
  {
    id: "calendar",
    name: "Calendar",
    code: "05",
    symbol: "▤",
    tab: "Calendar",
    detail: "Google Calendar context. Event changes require approval.",
    metric: null,
  },
  {
    id: "communications",
    name: "Communications",
    code: "06",
    symbol: "⌁",
    tab: "Communications",
    detail: "Selected Gmail context. Every send requires explicit approval.",
    metric: null,
  },
  {
    id: "finance",
    name: "Finance",
    code: "07",
    symbol: "↗",
    tab: "Finance",
    detail: "Source-backed accounts and changes. No money movement.",
    metric: null,
  },
  {
    id: "agents",
    name: "Agents",
    code: "08",
    symbol: "◎",
    tab: "Agent Runtime",
    detail:
      "Scoped workers and durable assignments. Shared central intelligence.",
    metric: null,
  },
  {
    id: "activity",
    name: "Activity",
    code: "09",
    symbol: "↳",
    tab: "Action history",
    detail: "The evidence behind every action.",
    metric: "actions",
  },
  {
    id: "system",
    name: "System",
    code: "10",
    symbol: "⊞",
    tab: "Settings",
    detail: "Permissions, approvals and your boundaries.",
    metric: null,
  },
] as const;
export type ModuleId = (typeof modules)[number]["id"];
export type WorkspaceTab =
  NonNullable<(typeof modules)[number]["tab"]> | "Priority";
export interface WorkspaceSummary {
  memories: number;
  entities: number;
  projects: number;
  tasks: number;
  actions: number;

  blockedProjects: number;
  connected: boolean;
}
export const emptySummary: WorkspaceSummary = {
  memories: 0,
  entities: 0,
  projects: 0,
  tasks: 0,
  actions: 0,

  blockedProjects: 0,
  connected: false,
};
export interface ShellBridge {
  active: boolean;
  navigation: { tab: WorkspaceTab; revision: number } | null;
  onSummary: (summary: WorkspaceSummary) => void;
  onReveal?: () => void;
  onOrbit?: () => void;
}
