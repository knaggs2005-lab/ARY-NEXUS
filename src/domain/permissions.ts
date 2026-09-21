import {
  permissionClasses,
  permissionBehaviors,
  type PermissionClass,
  type PermissionBehavior,
} from "./permission-classes";
import { perceptionSources } from "./perception";
import { designVerbs } from "./design-tool";
import { z } from "zod";
import { premiereVerbs } from "./premiere";
import type { RecordBase } from "./models";
export const permissionLevels = [
  "no_access",
  "observe",
  "recommend",
  "draft",
  "execute_with_approval",
  "autonomous",
] as const;
export type PermissionLevel = 0 | 1 | 2 | 3 | 4 | 5;
export type ActionMode = "observe" | "recommend" | "draft" | "execute";
export interface ToolDefinition {
  permissionClasses?: PermissionClass[];
  actionType: string;
  /** Existing capability restrictions also apply to an additive specialization. */
  permissionParent?: string;
  mode: ActionMode;
  defaultLevel: PermissionLevel;
  description: string;
  riskLevel?: "low" | "medium" | "high";
  simulated?: boolean;
  parallelSafe?: boolean;
  /** Capability ceiling: approved external writes can never become autonomous. */
  alwaysRequiresApproval?: boolean;
}
/** Simulations have their own action types, so testing cannot change real-tool policies. */
export const mockToolDefinitions = {
  "mock.create_task": {
    actionType: "mock_create_task",
    mode: "execute",
    defaultLevel: 4,
    description: "Simulate creating an internal task",
    riskLevel: "low",
    simulated: true,
  },
  "mock.update_task": {
    actionType: "mock_update_task",
    mode: "execute",
    defaultLevel: 4,
    description: "Simulate updating an internal task",
    riskLevel: "low",
    simulated: true,
  },
  "mock.update_project_status": {
    actionType: "mock_update_project_status",
    mode: "execute",
    defaultLevel: 4,
    description: "Simulate a project status update",
    riskLevel: "low",
    simulated: true,
  },
  "mock.draft_message": {
    actionType: "mock_draft_message",
    mode: "draft",
    defaultLevel: 3,
    description: "Prepare an unsent message draft",
    riskLevel: "low",
    simulated: true,
  },
  "mock.create_note": {
    actionType: "mock_create_note",
    mode: "execute",
    defaultLevel: 4,
    description: "Simulate creating an internal note",
    riskLevel: "low",
    simulated: true,
  },
  "mock.fetch_project_summary": {
    actionType: "mock_fetch_project_summary",
    mode: "observe",
    defaultLevel: 1,
    description: "Read a synthetic project summary",
    riskLevel: "low",
    simulated: true,
  },
  "mock.observe": {
    actionType: "mock_read",
    mode: "observe",
    defaultLevel: 1,
    description: "Inspect a fixed synthetic workspace",
  },
  "mock.recommend": {
    actionType: "mock_recommend",
    mode: "recommend",
    defaultLevel: 2,
    description: "Return a deterministic simulated recommendation",
  },
  "mock.draft": {
    actionType: "mock_draft",
    mode: "draft",
    defaultLevel: 3,
    description: "Prepare a simulated draft without saving a task",
  },
  "mock.execute": {
    actionType: "mock_execute",
    mode: "execute",
    defaultLevel: 4,
    description: "Simulate execution or failure; approval required by default",
  },
} satisfies Record<string, ToolDefinition>;
/** Registration is a server capability ceiling. A policy cannot register a tool. */
export const toolRegistry: Record<string, ToolDefinition> = Object.fromEntries(
  [
    [
      "roi.read",
      "read",
      "observe",
      "Read recorded costs and outcome attribution",
    ],
    [
      "roi.record",
      "record",
      "execute",
      "Record accounting evidence; no money movement",
    ],
    [
      "brain.respond",
      "reason",
      "recommend",
      "Answer using bounded retrieved context",
    ],
    ["memory.read", "read", "observe", "Read memories and their evidence"],
    [
      "entity.read",
      "read",
      "observe",
      "Read entities, aliases and relationships",
    ],
    ["conversation.read", "read", "observe", "Read conversation history"],
    [
      "communications.read",
      "read",
      "observe",
      "Read permitted communication source summaries and follow-ups",
    ],
    [
      "activity.read",
      "read",
      "observe",
      "Read goals, tasks, outcomes and activity",
    ],
    [
      "memory.extract",
      "extract",
      "execute",
      "Extract and reconcile durable memories",
    ],
    ["memory.reembed", "update", "execute", "Replace memory embeddings"],
    ["memory.create", "create", "execute", "Create a memory"],
    ["memory.update", "update", "execute", "Update a memory with history"],
    ["memory.archive", "archive", "execute", "Archive a memory"],
    ["memory.link", "link", "execute", "Link a memory to an entity"],
    ["memory.reconcile", "reconcile", "execute", "Resolve a memory conflict"],
    ["entity.create", "create", "execute", "Create a canonical entity"],
    ["entity.link", "link", "execute", "Create or end a relationship"],
    ["entity.alias", "update", "execute", "Add a canonical alias"],
    ["reflection.run", "reflect", "draft", "Propose evidence-backed changes"],
    [
      "reflection.review",
      "update",
      "execute",
      "Apply or reject a reflection proposal",
    ],
    [
      "workspace.seed",
      "create",
      "execute",
      "Add the initial workspace records",
    ],
    [
      "voice.transcribe",
      "transcribe",
      "observe",
      "Transcribe explicitly submitted audio",
    ],
    ["voice.speak", "speak", "execute", "Generate speech from response text"],
  ].map(([name, actionType, mode, description]) => [
    name,
    { actionType, mode, description, defaultLevel: 5 },
  ]),
) as Record<string, ToolDefinition>;
Object.assign(toolRegistry, mockToolDefinitions);
Object.assign(toolRegistry, {
  "orchestrator.plan": {
    actionType: "orchestrator_plan",
    mode: "recommend",
    defaultLevel: 2,
    description:
      "Draft a bounded plan using shared evidence; no tools execute while planning.",
    simulated: false,
  },
  "orchestrator.advance": {
    actionType: "orchestrator_advance",
    mode: "execute",
    defaultLevel: 5,
    description:
      "Advance or pause one plan step through its existing permission and approval gate.",
    simulated: false,
  },
  "orchestrator.remember": {
    actionType: "orchestrator_remember",
    mode: "execute",
    defaultLevel: 4,
    alwaysRequiresApproval: true,
    description:
      "Save the reviewed plan outcome and action references as episodic memory; no confirmed facts rewritten.",
    simulated: false,
  },
  "task.inspect": {
    actionType: "task_inspect",
    mode: "observe",
    defaultLevel: 1,
    description:
      "Read an owned task for current-state inspection and verification.",
    simulated: false,
  },
});
for (const source of perceptionSources)
  toolRegistry[`perception.capture_${source}`] = {
    actionType: `perception_capture_${source}`,
    mode: "execute",
    defaultLevel: 4,
    alwaysRequiresApproval: true,
    description: `Authorize one ${source.replaceAll("_", " ")} image from the specified source. No background capture.`,
    riskLevel: "medium",
    simulated: false,
  };
toolRegistry["perception.analyze"] = {
  actionType: "perception_analyze",
  mode: "execute",
  defaultLevel: 4,
  alwaysRequiresApproval: true,
  description:
    "Send only the reviewed images/question to the vision provider. Keep findings in action history, not image bytes or permanent memory.",
  riskLevel: "medium",
  simulated: false,
};
for (const verb of ["stage", "clear"])
  toolRegistry[`perception.${verb}`] = {
    actionType: `perception_${verb}`,
    mode: "observe",
    defaultLevel: 1,
    description: `${verb} temporary owner-scoped visual evidence`,
    simulated: false,
  };
for (const verb of ["inspect", "plan_scene", "execute_scene"])
  toolRegistry[`studio.${verb}`] = {
    actionType: `studio_${verb}`,
    mode:
      verb === "inspect"
        ? "observe"
        : verb === "plan_scene"
          ? "recommend"
          : "execute",
    defaultLevel: verb === "inspect" ? 1 : verb === "plan_scene" ? 2 : 4,
    alwaysRequiresApproval: verb === "execute_scene",
    description: `Studio: ${verb.replaceAll("_", " ")}. Exact reviewed scenes; device-level receipts, no autonomous physical changes.`,
    riskLevel: verb === "execute_scene" ? "medium" : "low",
    simulated: false,
  };
for (const verb of ["inspect", "plan", ...designVerbs])
  toolRegistry[`design.${verb}`] = {
    actionType: `design_${verb}`,
    mode:
      verb === "inspect"
        ? "observe"
        : verb === "plan"
          ? "recommend"
          : "execute",
    defaultLevel: verb === "inspect" ? 1 : verb === "plan" ? 2 : 4,
    alwaysRequiresApproval: !["inspect", "plan"].includes(verb),
    description: `Design adapter: ${verb.replaceAll("_", " ")}. Explicit capability and live-state validation.`,
    riskLevel: ["inspect", "plan", "preview"].includes(verb) ? "low" : "medium",
    simulated: false,
  };
for (const tool of ["edit.plan", "edit.prepare_marker"])
  toolRegistry[tool] = {
    actionType: tool.replace(".", "_"),
    mode: "recommend",
    defaultLevel: 2,
    description:
      "Prepare an evidence-based edit recommendation. No timeline execution.",
    riskLevel: "low",
    simulated: false,
  };
for (const verb of [
  "inspect",
  "find_clips",
  "read_timeline",
  "prepare_analysis",
  "analyze_media",
  "plan",
  ...premiereVerbs,
])
  toolRegistry[`premiere.${verb}`] = {
    actionType: `premiere_${verb}`,
    mode: ["inspect", "find_clips", "read_timeline"].includes(verb)
      ? "observe"
      : ["plan", "prepare_analysis"].includes(verb)
        ? "recommend"
        : "execute",
    defaultLevel: ["inspect", "find_clips", "read_timeline"].includes(verb)
      ? 1
      : ["plan", "prepare_analysis"].includes(verb)
        ? 2
        : 4,
    alwaysRequiresApproval: ![
      "inspect",
      "plan",
      "find_clips",
      "read_timeline",
      "prepare_analysis",
    ].includes(verb),
    description: `Premiere native ${verb.replaceAll("_", " ")}. ${verb === "analyze_media" ? "Read a pinned source excerpt; transcription sends only its audio to the configured speech provider after approval. No timeline edit." : verb === "remove_clips" ? "Destructive non-ripple timeline removal. Exact approval and native Undo; never deletes source files." : "Validates live state; changes require exact approval."}`,
    riskLevel: [
      "export_sequence",
      "save_project",
      "remove_clips",
      "analyze_media",
    ].includes(verb)
      ? "high"
      : "low",
    simulated: false,
  };
toolRegistry.create_task = {
  actionType: "create_task",
  mode: "execute",
  defaultLevel: 4,
  description:
    "Create a real internal task with its project and source evidence",
  riskLevel: "medium",
  simulated: false,
};
toolRegistry.update_task = {
  actionType: "update_task",
  mode: "execute",
  defaultLevel: 4,
  description:
    "Update a real internal task after reviewing changes and its current version",
  riskLevel: "medium",
  simulated: false,
};
toolRegistry.update_project_status = {
  actionType: "update_project_status",
  mode: "execute",
  defaultLevel: 4,
  description:
    "Update an existing project's reviewed state, blockers, notes and goal links",
  riskLevel: "medium",
  simulated: false,
};
toolRegistry["board.meet"] = {
  actionType: "board_meeting",
  mode: "recommend",
  defaultLevel: 2,
  description:
    "Run a bounded advisory board and save one shared daily brief; no execution",
  riskLevel: "low",
};
for (const [action, mode, level] of [
  ["read", "observe", 1],
  ["recommend", "recommend", 2],
  ["create", "execute", 4],
  ["update", "execute", 4],
] as const) {
  toolRegistry[`google_calendar.${action}`] = {
    actionType: `calendar_${action}`,
    mode,
    defaultLevel: level,
    description: `${action} Google Calendar events on the connected primary calendar`,
    riskLevel: mode === "execute" ? "medium" : "low",
    simulated: false,
    alwaysRequiresApproval: mode === "execute",
  };
}
for (const [action, mode, level] of [
  ["search", "observe", 1],
  ["read", "observe", 1],
  ["summarize", "recommend", 2],
  ["draft", "draft", 3],
  ["send", "execute", 4],
  ["evidence", "execute", 4],
] as const) {
  toolRegistry[`gmail.${action}`] = {
    actionType: `gmail_${action}`,
    mode,
    defaultLevel: level,
    description: `${action} selected Gmail context${action === "send" ? "; explicit approval of exact recipients and text required" : ""}`,
    riskLevel: action === "send" ? "high" : "low",
    simulated: false,
    alwaysRequiresApproval: mode === "execute",
  };
}
toolRegistry["finance.read"] = {
  actionType: "finance_read",
  mode: "observe",
  defaultLevel: 1,
  description:
    "Read source-attributed financial snapshots; no external account access or execution",
  riskLevel: "low",
  simulated: false,
};
toolRegistry["finance.import"] = {
  actionType: "finance_import",
  mode: "execute",
  defaultLevel: 4,
  description:
    "Import one reviewed account statement into Ary; no money movement",
  riskLevel: "medium",
  simulated: false,
  alwaysRequiresApproval: true,
};
for (const verb of [
  "list_apps",
  "launch_app",
  "open_website",
  "media",
  "volume",
  "clipboard_read",
  "clipboard_write",
  "hide_others",
  "quit_app",
  "lock_screen",
  "sleep_display",
  "do_not_disturb",
  "create_note",
  "create_reminder",
] as const) {
  toolRegistry[`desktop.${verb}`] = {
    actionType: `desktop_${verb}`,
    mode: verb === "list_apps" ? "observe" : "execute",
    defaultLevel: verb === "list_apps" ? 1 : 4,
    description: `Mac Desktop Bridge: ${verb.replaceAll("_", " ")}. Installed app session and explicit host enablement required.`,
    riskLevel: [
      "clipboard_read",
      "clipboard_write",
      "quit_app",
      "lock_screen",
      "sleep_display",
    ].includes(verb)
      ? "high"
      : "medium",
    simulated: false,
    alwaysRequiresApproval: verb !== "list_apps",
  };
}
export function getToolDefinition(name: string): ToolDefinition | undefined {
  return Object.hasOwn(toolRegistry, name) ? toolRegistry[name] : undefined;
}
export interface PermissionPolicy extends RecordBase {
  permission_class?: PermissionClass | null;
  subject_agent_id?: string | null;
  behavior?: PermissionBehavior | null;
  scope_key: string;
  parent_id: string | null;
  enabled: boolean;
  tool: string | null;
  action_type: string | null;
  workspace: string | null;
  product_entity_id: string | null;
  subject_user_id: string | null;
  level: PermissionLevel;
  reason: string;
}
export interface ActionApproval extends RecordBase {
  action_id: string;
  decision: "approved" | "rejected";
  reason: string;
  fingerprint: string;
  policy_hash: string;
  expires_at: string;
  consumed_at: string | null;
}
export const policyInput = z
  .object({
    tool: z.string().trim().min(1).max(120).nullable().default(null),
    action_type: z.string().trim().min(1).max(80).nullable().default(null),
    workspace: z.literal("ary-nexus").nullable().default(null),
    product_entity_id: z.uuid().nullable().default(null),
    subject_user_id: z.uuid().nullable().default(null),
    permission_class: z.enum(permissionClasses).nullable().optional(),
    subject_agent_id: z.uuid().nullable().optional(),
    behavior: z.enum(permissionBehaviors).nullable().optional(),
    level: z.number().int().min(0).max(5),
    enabled: z.boolean().default(true),
    reason: z.string().trim().min(1).max(1000),
    parent_id: z.uuid().nullable().default(null),
  })
  .strict();
export interface ActionContext {
  /** Server-derived launcher proof; never supplied by a request body. */
  desktopAuthorized?: boolean;
  workspace: string;
  productIds: string[];
  request?: {
    method: string;
    path: string;
    body_hash: string;
    preview?: unknown;
  };
  approvalId?: string;
}
export interface PermissionDecision {
  level: PermissionLevel;
  allowed: boolean;
  approvalRequired: boolean;
  reason: string;
  matchedPolicyIds: string[];
  policyHash: string;
  mode: ActionMode;
}

// Calls can never acquire autonomous initiation authority, even at permission level 5.
Object.assign(toolRegistry, {
  "phone.initiate": {
    actionType: "phone_initiate",
    mode: "execute",
    defaultLevel: 4,
    riskLevel: "high",
    alwaysRequiresApproval: true,
    simulated: false,
    description:
      "Place one explicitly requested call and deliver the exact approved automated-assistant script",
  },
  "phone.reconcile": {
    actionType: "phone_reconcile", mode: "execute", defaultLevel: 4,
    riskLevel: "high", alwaysRequiresApproval: true, simulated: false,
    description: "Reconcile one HTTP 400 rejection against an empty provider call inventory. Does not dial; future calls need fresh approval.",
  },
  "phone.refresh": {
    actionType: "phone_refresh",
    mode: "observe",
    defaultLevel: 1,
    simulated: false,
    description:
      "Read provider status and consented transcript for an existing owned call",
  },
  "phone.cancel": {
    actionType: "phone_cancel",
    mode: "execute",
    defaultLevel: 5,
    simulated: false,
    description:
      "Stop one existing owned call at the user's request; never initiate or redial",
  },
  "phone.read": {
    actionType: "phone_read",
    mode: "observe",
    defaultLevel: 1,
    simulated: false,
    description: "View Ary Calls configuration and recorded calls",
  },
});

// Explicitly reviewed read-only concurrency. Mutations and same-domain reads remain serialized.
for (const name of [
  "task.inspect",
  "studio.inspect",
  "premiere.inspect",
  "design.inspect",
  "google_calendar.read",
])
  if (toolRegistry[name]) toolRegistry[name].parallelSafe = true;
Object.assign(toolRegistry, {
  "orchestrator.replan": {
    actionType: "orchestrator_replan",
    mode: "draft",
    defaultLevel: 3,
    description:
      "Record a visible reviewed revision of remaining plan steps; completed evidence is immutable.",
    simulated: false,
  },
  "orchestrator.review_steps": {
    actionType: "orchestrator_review_steps",
    mode: "execute",
    defaultLevel: 5,
    description:
      "Explicit owner review of exact related pending step snapshots. Each existing approval is recorded independently; no tool executes here.",
    simulated: false,
  },
});

Object.assign(toolRegistry, {
  "mission.create": {
    actionType: "mission_create",
    mode: "draft",
    defaultLevel: 3,
    simulated: false,
    description:
      "Persist a durable objective in the existing plan store. No execution.",
  },
  "mission.control": {
    actionType: "mission_control",
    mode: "execute",
    defaultLevel: 5,
    simulated: false,
    description:
      "Plan, start, pause, resume, checkpoint or cancel an owner-selected mission; each step keeps its own approval.",
  },
  "mission.submit": {
    actionType: "mission_submit",
    mode: "draft",
    defaultLevel: 3,
    simulated: false,
    description:
      "Submit evidence to a declared mission wait. A submission can never approve an action.",
  },
  "mission.tick": {
    actionType: "mission_tick",
    mode: "execute",
    defaultLevel: 5,
    simulated: false,
    description:
      "Process one durable checkpoint for an already activated mission; no privilege escalation.",
  },
  "mission.agent": {
    actionType: "mission_agent",
    mode: "recommend",
    defaultLevel: 2,
    simulated: false,
    description:
      "Submit a bounded advisory question to an existing Board role using shared memory; no tool delegation.",
  },
  "agent.create": {
    actionType: "agent_create",
    mode: "draft",
    defaultLevel: 3,
    simulated: false,
    description:
      "Create a scoped persistent agent or one-assignment worker for a functional specialization.",
  },
  "agent.submit": {
    actionType: "agent_submit",
    mode: "draft",
    defaultLevel: 3,
    simulated: false,
    description:
      "Assign an objective as an existing durable mission; explicit planning and start remain required.",
  },
  "agent.delegate": {
    actionType: "agent_delegate",
    mode: "draft",
    defaultLevel: 3,
    simulated: false,
    description:
      "Create a narrower child worker and its durable assignment within parent budgets.",
  },
  "agent.terminate": {
    actionType: "agent_terminate",
    mode: "execute",
    defaultLevel: 5,
    simulated: false,
    description:
      "Terminate a selected worker subtree and request cancellation of its future mission steps.",
  },
});

Object.assign(toolRegistry, {
  "knowledge.read": {
    actionType: "knowledge_read",
    mode: "observe",
    defaultLevel: 1,
    description:
      "Read curated reference knowledge; distinct from learned memory",
  },
  ...Object.fromEntries(
    [
      [
        "memory.capture",
        "Capture a classified memory with explicit source/scope",
      ],
      [
        "memory.consolidate",
        "Create a reviewed summary preserving the original memories and evidence",
      ],
      [
        "memory.forget",
        "Archive a memory from future retrieval while retaining history",
      ],
      [
        "memory.delete_record",
        "Delete one memory and its evidence/history; source conversations and audits remain",
      ],
      [
        "knowledge.capture",
        "Save a curated reference or append a reviewed knowledge revision",
      ],
    ].map(([name, description]) => [
      name,
      {
        actionType: name.replaceAll(".", "_"),
        mode: "execute",
        defaultLevel: 4,
        alwaysRequiresApproval: true,
        riskLevel: name === "memory.delete_record" ? "high" : "low",
        description,
      },
    ]),
  ),
});

Object.assign(toolRegistry, {
  "memory.inspect": {
    actionType: "read",
    mode: "observe",
    defaultLevel: 1,
    description:
      "Explain memory sources, confidence, time, links, conflicts and versions",
  },
  "knowledge.search": {
    actionType: "knowledge_read",
    mode: "observe",
    defaultLevel: 1,
    description: "Retrieve curated references separately from learned facts",
  },
});

toolRegistry["knowledge.archive"] = {
  actionType: "knowledge_archive",
  mode: "execute",
  defaultLevel: 4,
  alwaysRequiresApproval: true,
  description: "Retire a curated reference, retaining revision history",
};

for (const [tool, parent] of Object.entries({
  "memory.capture": "memory.create",
  "memory.consolidate": "memory.create",
  "memory.forget": "memory.archive",
  "memory.delete_record": "memory.archive",
  "memory.inspect": "memory.read",
  "knowledge.search": "knowledge.read",
})) {
  toolRegistry[tool].permissionParent = parent;
  toolRegistry[tool].actionType = toolRegistry[parent].actionType;
}

toolRegistry["memory.classify"] = {
  actionType: "update",
  permissionParent: "memory.update",
  mode: "execute",
  defaultLevel: 4,
  alwaysRequiresApproval: true,
  description:
    "Classify an existing memory in place; preserve its ID, content, source and embedding",
};

for (const name of ["tools.read", "tools.discover"])
  toolRegistry[name] = {
    actionType: "read",
    mode: "observe",
    defaultLevel: 1,
    description:
      name === "tools.read"
        ? "Inspect capability metadata and observed tool health"
        : "Find capabilities by meaning without executing them",
    riskLevel: "low",
  };
for (const name of ["mcp.inspect", "mcp.invoke"])
  toolRegistry[name] = {
    actionType: "mcp_external",
    mode: "execute",
    defaultLevel: 4,
    alwaysRequiresApproval: true,
    riskLevel: "high",
    parallelSafe: false,
    description:
      name === "mcp.inspect"
        ? "Connect to an owner-configured MCP server and verify its declared tools"
        : "Call an explicitly allowlisted MCP capability with a pinned schema after approval",
  };

// Generic UI interactions can have any downstream effect. Denials of any class
// must not be bypassed by replacing a purpose-built tool with a mouse click.
for (const [name, description, read] of [
  [
    "browser.open",
    "Open an isolated browser on an owner-allowed website",
    false,
  ],
  [
    "browser.inspect",
    "Read bounded structured controls in an owned browser",
    true,
  ],
  ["browser.act", "Interact with an exact inspected browser target", false],
  ["browser.close", "Close an Ary-owned browser session", false],
  [
    "computer.inspect",
    "Inspect windows, menus and controls in an owner-allowed Mac app",
    true,
  ],
  [
    "computer.act",
    "Use a fixed Accessibility operation on an inspected native control",
    false,
  ],
  [
    "computer.propose_visual",
    "Capture an approved window lacking structural controls and propose one reviewed point",
    false,
  ],
  [
    "computer.visual_click",
    "Click the exact reviewed point only if the captured window is unchanged",
    false,
  ],
  [
    "control.files",
    "List supported files in the owner-configured transfer folder",
    true,
  ],
] as const) {
  toolRegistry[name] = {
    actionType: name.replaceAll(".", "_"),
    mode: read ? "observe" : "execute",
    defaultLevel: 4,
    alwaysRequiresApproval: true,
    riskLevel: read ? "medium" : "high",
    parallelSafe: false,
    simulated: false,
    description,
    permissionClasses: read
      ? ["READ"]
      : name === "browser.close"
        ? ["EXECUTE"]
        : [...permissionClasses],
    ...(["computer.propose_visual", "computer.visual_click"].includes(name)
      ? { permissionParent: "perception.capture_window" }
      : {}),
  };
}

// Skills declare capability needs; these definitions never modify a user's policies.
Object.assign(
  toolRegistry,
  Object.fromEntries(
    [
      [
        "skill.read",
        "observe",
        "Read owner-scoped versioned Skills and Automations",
      ],
      ["skill.save", "draft", "Save a new immutable draft Skill revision"],
      [
        "skill.propose",
        "draft",
        "Propose a reusable workflow using the existing planner; no execution",
      ],
      [
        "skill.approve",
        "execute",
        "Approve this exact Skill version. Does not approve its future tool actions",
      ],
      [
        "skill.launch",
        "draft",
        "Instantiate a reviewed Skill as a Mission draft",
      ],
      ["automation.save", "draft", "Save a disabled, pinned automation"],
      [
        "automation.enable",
        "execute",
        "Enable or disable a pinned trigger that creates Mission drafts only",
      ],
      [
        "automation.fire",
        "draft",
        "Deliver a trigger idempotently to the existing MissionEngine",
      ],
    ].map(([name, mode, description]) => [
      name,
      {
        actionType: name.replaceAll(".", "_"),
        mode,
        description,
        defaultLevel: mode === "execute" ? 4 : mode === "observe" ? 1 : 3,
        alwaysRequiresApproval: mode === "execute",
        simulated: false,
      },
    ]),
  ),
);

Object.assign(
  toolRegistry,
  Object.fromEntries(
    [
      [
        "outcome.inspect",
        "observe",
        "Read up to twenty selected outcomes and advisory recommendations",
      ],
      [
        "outcome.read",
        "observe",
        "Compare owner-scoped outcomes and their source evidence",
      ],
      [
        "outcome.assess",
        "execute",
        "Append an outcome assessment or correction; preserve prior versions",
      ],
      [
        "outcome.propose",
        "draft",
        "Propose advisory improvements from repeated evidence; no instruction changes",
      ],
      [
        "outcome.review",
        "execute",
        "Accept, reject or withdraw an exact advisory recommendation; never edit core instructions",
      ],
    ].map(([name, mode, description]) => [
      name,
      {
        actionType: name.replaceAll(".", "_"),
        mode,
        description,
        defaultLevel: mode === "execute" ? 4 : mode === "observe" ? 1 : 3,
        alwaysRequiresApproval: mode === "execute",
        simulated: false,
      },
    ]),
  ),
);

// Preparation and interpretation never authorize external communication.
Object.assign(toolRegistry, {
  "communications.plan": {
    actionType: "communication_plan",
    mode: "draft",
    defaultLevel: 3,
    permissionClasses: ["READ", "WRITE"],
    description:
      "Prepare an unsent contact-linked communication plan; external delivery requires separate exact approval",
    simulated: false,
  },
  "communications.debrief": {
    actionType: "communication_debrief",
    mode: "recommend",
    defaultLevel: 2,
    permissionClasses: ["READ"],
    description:
      "Analyze selected captured communication evidence; propose reviewed commitments, memory and follow-ups",
    simulated: false,
  },
});

// Remote workers never acquire Ary approval or execution authority.
Object.assign(toolRegistry, {
  "worker.submit": {
    actionType: "worker_submit",
    mode: "execute",
    defaultLevel: 4,
    alwaysRequiresApproval: true,
    riskLevel: "high",
    simulated: false,
    permissionClasses: ["COMMUNICATE", "EXECUTE"],
    description:
      "Send only the reviewed objective/context to a restricted external advisory worker. No remote action authority.",
  },
  "worker.recover": {
    actionType: "worker_recover",
    mode: "execute",
    defaultLevel: 4,
    alwaysRequiresApproval: true,
    riskLevel: "high",
    simulated: false,
    permissionClasses: ["COMMUNICATE", "EXECUTE"],
    description:
      "Recover an uncertain worker submission using the original saved context and idempotency key. Never create an unkeyed duplicate.",
  },
  "worker.refresh": {
    actionType: "worker_refresh",
    mode: "observe",
    defaultLevel: 1,
    simulated: false,
    description:
      "Reconcile an owned delegated job and queue Ary review of proposals; never grant remote approval.",
  },
  "worker.cancel": {
    actionType: "worker_cancel",
    mode: "execute",
    defaultLevel: 5,
    simulated: false,
    description:
      "Request cancellation of an owned cloud job; remote termination requires confirmation.",
  },
  "worker.review": {
    actionType: "worker_review",
    mode: "execute",
    defaultLevel: 4,
    alwaysRequiresApproval: true,
    simulated: false,
    description:
      "Review untrusted worker findings only. Acceptance does not execute proposed actions; remote pending tool runs are stopped.",
  },
  "worker.read": {
    actionType: "worker_read",
    mode: "observe",
    defaultLevel: 1,
    simulated: false,
    description: "Inspect owned cloud worker jobs and connection diagnostics.",
  },
});

// Supervised development: no merge, push, deploy or arbitrary shell capability.
for (const [verb, description] of Object.entries({
  verify: "Independently read back a durable stage and candidate hash",
  source: "Inspect bounded non-secret repository source at an exact commit",
  cleanup:
    "Remove only a clean completed owned worktree; preserve branch and evidence",
  unlock:
    "Release a terminal development reservation after all operations are known complete; retain files",
  observe: "Cite canonical evidence for an engineering observation",
  inspect: "Inspect a development run and its canonical mission",
  propose: "Record an evidence-linked improvement proposal",
  plan: "Record immutable scope, acceptance, risks and rollback",
  build: "Owner approval to build the exact development plan; no merge",
  build_protected:
    "ADMIN approval for protected scope; core authorization and secrets remain forbidden",
  workspace: "Create a reserved isolated development Git worktree",
  patch: "Record a bounded patch proposal within approved scope",
  patch_ready: "Read the immutable patch hash at the mission wait",
  implement: "Apply the exact approved patch in the isolated worktree only",
  test: "Run fixed tests/typecheck/format/build in an offline OS sandbox",
  review:
    "Independently review the candidate using the configured model; no author conversation",
  release:
    "Assemble exact diff, validation, review and rollback evidence; never merge",
  decide: "Owner records accept/reject for a release candidate; does not merge",
  finalize: "Record the release decision outcome without changing main",
})) {
  const observe = ["source", "inspect", "verify", "patch_ready"].includes(verb);
  const draft = ["observe", "propose", "plan", "patch"].includes(verb);
  toolRegistry[`development.${verb}`] = {
    actionType: `development_${verb}`,
    mode: observe ? "observe" : draft ? "draft" : "execute",
    defaultLevel: observe ? 1 : draft ? 3 : 4,
    alwaysRequiresApproval: !observe && !draft,
    permissionClasses:
      verb === "build_protected"
        ? ["ADMIN", "WRITE", "EXECUTE"]
        : observe
          ? ["READ"]
          : draft
            ? ["READ", "WRITE"]
            : ["EXECUTE", "WRITE"],
    riskLevel: ["test", "build_protected"].includes(verb) ? "high" : "medium",
    simulated: false,
    description,
  };
}
