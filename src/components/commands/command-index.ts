import type { Entity, EntityAlias, Task } from "../../domain/models";
import type { InstalledApp } from "../../domain/desktop";
import { destinations } from "../nexus/destinations";
import { modules } from "../spatial/modules";
export type Destination = {
  tab: string;
  recordId?: string;
  tool?: string;
  query?: string;
};
export type Command = {
  id: string;
  label: string;
  source:
    "module" | "project" | "task" | "entity" | "app" | "website" | "action";
  aliases: string[];
  detail: string;
  destination?: Destination;
  execution?: {
    tool: "desktop.launch_app" | "desktop.open_website";
    input: Record<string, string>;
  };
};
export type CatalogItem = {
  name: string;
  description: string;
  permission?: { level: number };
  simulated?: boolean;
};
export const normalize = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-US")
    .trim();
const words = (value: string) =>
  normalize(value.replace(/([a-z])([A-Z])/g, "$1 $2"))
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
export function buildCommands(
  entities: Entity[],
  tasks: Task[],
  aliases: EntityAlias[],
  apps: InstalledApp[],
  tools: CatalogItem[],
  reflectionDev = false,
): Command[] {
  const result: Command[] = modules.map((m) => ({
    id: `module:${m.id}`,
    label: m.name,
    source: "module",
    aliases: [m.tab === "Activity" ? "Tasks & outcomes" : m.tab],
    detail: m.detail,
    destination: { tab: m.tab },
  }));
  for (const tab of [
    "Priority",
    "Approvals",
    "Calls",
    "Creative",
    "Studio",
    "Perception",
    "Execution Plans",
    "Board",
    "Memories",
    "Memory review",
    "Relationships",
    "ROI",
    ...(reflectionDev ? ["Reflection"] : []),
  ]) {
    result.push({
      id: `module:${tab}`,
      label: tab,
      source: "module",
      aliases: tab === "ROI" ? ["Economics"] : [],
      detail: "Ary workspace",
      destination: { tab },
    });
  }
  for (const d of destinations) {
    const existing = result.find(
      (command) => normalize(command.label) === normalize(d.id),
    );
    if (existing) existing.destination = { tab: d.tab };
    if (!result.some((command) => normalize(command.label) === normalize(d.id)))
      result.push({
        id: `destination:${d.id}`,
        label: d.id,
        source: "module",
        aliases: [],
        detail: d.detail,
        destination: { tab: d.tab },
      });
  }
  const aliasMap = new Map<string, string[]>();
  for (const alias of aliases)
    aliasMap.set(alias.entity_id, [
      ...(aliasMap.get(alias.entity_id) ?? []),
      alias.alias,
    ]);
  for (const e of entities)
    result.push({
      id: `entity:${e.id}`,
      label: e.name,
      source: e.entity_type === "project" ? "project" : "entity",
      aliases: aliasMap.get(e.id) ?? [],
      detail: e.entity_type,
      destination: { tab: "Entities", recordId: `entity-${e.id}` },
    });
  const websites = new Map<string, Command>();
  for (const entity of entities) {
    for (const field of [entity.metadata.website, entity.metadata.url]) {
      if (typeof field !== "string") continue;
      const website = websiteCommand(field);
      if (website) {
        const existing = websites.get(website.id);
        if (existing) existing.aliases.push(`${entity.name} website`);
        else
          websites.set(website.id, {
            ...website,
            aliases: [...website.aliases, `${entity.name} website`],
          });
      }
    }
  }
  result.push(...websites.values());
  for (const t of tasks)
    result.push({
      id: `task:${t.id}`,
      label: t.title,
      source: "task",
      aliases: [],
      detail: t.status,
      destination: { tab: "Activity", recordId: `task-${t.id}` },
    });
  for (const app of apps)
    result.push({
      id: `app:${app.path}`,
      label: app.name,
      source: "app",
      aliases: [app.id],
      detail: app.id,
      execution: { tool: "desktop.launch_app", input: { app_id: app.id } },
    });
  for (const tool of tools)
    result.push({
      id: `action:${tool.name}`,
      label: tool.name.replace(/[._]/g, " "),
      source: "action",
      aliases: [tool.name],
      detail: `${tool.simulated ? "Simulation · " : ""}${tool.description}${tool.permission?.level === 0 ? " · no access" : ""}`,
      destination: { tab: "Approvals", tool: tool.name },
    });
  return result;
}
export function websiteCommand(query: string): Command | null {
  const raw = query.trim();
  if (!/^https?:\/\//i.test(raw)) return null;
  try {
    const url = new URL(raw);
    if (url.username || url.password || raw.length > 2048) return null;
    return {
      id: `website:${url.href}`,
      label: url.hostname,
      source: "website",
      aliases: [url.href],
      detail: url.href,
      execution: { tool: "desktop.open_website", input: { url: url.href } },
    };
  } catch {
    return null;
  }
}
export type IndexedCommand = {
  command: Command;
  terms: { text: string; initials: string; words: string[] }[];
};
export function indexCommands(commands: Command[]): IndexedCommand[] {
  return commands.map((command) => ({
    command,
    terms: [command.label, ...command.aliases].map((v) => ({
      text: normalize(v),
      initials: words(v)
        .map((w) => w[0])
        .join(""),
      words: words(v),
    })),
  }));
}
export function rankCommands(index: IndexedCommand[], raw: string, limit = 30) {
  const q = normalize(raw);
  const matches: { command: Command; tier: number; reason: string }[] = [];
  for (const item of index) {
    let tier = 99;
    for (const term of item.terms) {
      const rank =
        !q || term.text.startsWith(q)
          ? 0
          : term.initials.startsWith(q)
            ? 1
            : term.words.some((w) => w.startsWith(q))
              ? 2
              : term.text.includes(q)
                ? 3
                : 99;
      tier = Math.min(tier, rank);
    }
    if (tier < 99)
      matches.push({
        command: item.command,
        tier,
        reason: ["Prefix", "Initials", "Word boundary", "Substring"][tier],
      });
  }
  return matches
    .sort(
      (a, b) =>
        a.tier - b.tier ||
        a.command.label.localeCompare(b.command.label) ||
        a.command.id.localeCompare(b.command.id),
    )
    .slice(0, limit);
}
export function voiceQuery(text: string) {
  return text
    .trim()
    .replace(/^(?:ary[, ]+)?(?:open|show|go to|launch)\s+/i, "")
    .replace(/[.!?]+$/, "")
    .trim();
}
export function exactVoiceDestination(commands: Command[], text: string) {
  const q = normalize(voiceQuery(text));
  const hits = commands.filter((c) =>
    [c.label, ...c.aliases].some((a) => normalize(a) === q),
  );
  return hits.length === 1 ? hits[0] : null;
}
export interface CommandPorts {
  navigate: (destination: Destination) => void;
  request: (body: unknown) => Promise<unknown>;
  uuid: () => string;
  executionKeys?: { operationId: string; requestKey: string };
}
/** All modalities share this dispatcher. Tool effects only enter the existing action API. */
export async function dispatchCommand(command: Command, ports: CommandPorts) {
  if (command.execution)
    return ports.request({
      tool: command.execution.tool,
      input: {
        ...command.execution.input,
        operation_id: ports.executionKeys?.operationId ?? ports.uuid(),
      },
      request_key: ports.executionKeys?.requestKey ?? ports.uuid(),
      reason: `User selected ${command.source}: ${command.label}`,
    });
  if (command.destination) ports.navigate(command.destination);
}
