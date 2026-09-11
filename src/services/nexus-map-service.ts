import type { Repository } from "../domain/repository";
import {
  mapQuery,
  mapNode,
  mapEdge,
  type MapKind,
  type MapRecordKind,
  type NexusMap,
} from "../domain/nexus-map";
import { GraphQueryService } from "./graph-query-service";
import { ActionService } from "./action-service";
import type { ActionRequestService } from "./action-request-service";
import { boardRoles } from "../domain/board";
import { readAgentViews } from "./agent-runtime-service";
import { AppError } from "../domain/validation";
const entityKinds = [
  "person",
  "company",
  "project",
  "product",
  "goal",
  "decision",
  "task",
];
/** Bounded read projection over existing records and registry. No discovery side effects or execution. */
export class NexusMapService {
  constructor(
    private repo: Repository,
    private actions: ActionService,
    private tools: Pick<ActionRequestService, "catalog">,
  ) {}
  async query(raw: unknown): Promise<NexusMap> {
    const q = mapQuery.parse(raw);
    const result: NexusMap = {
      nodes: [],
      edges: [],
      meta: {
        generatedAt: new Date().toISOString(),
        more: false,
        cursor: null,
        warnings: [],
      },
    };
    const wanted = (kind: string) =>
      (!q.kind || q.kind === kind) &&
      (q.lens === "nexus" ||
        !["ary", "agent", "tool", "skill", "automation"].includes(kind)) &&
      (q.lens !== "world" || kind !== "memory");
    const add = async (label: string, work: () => Promise<void>) => {
      try {
        await work();
      } catch (error) {
        result.meta.warnings.push(
          `${label}: ${error instanceof AppError && error.status === 403 ? "access restricted" : "source unavailable"}`,
        );
      }
    };
    const match = (label: string) =>
      label.toLowerCase().includes(q.q.toLowerCase());
    if (wanted("ary") && match("Ary"))
      result.nodes.push(
        mapNode(
          "system:ary",
          "ARY",
          "ary",
          "Existing AryBrainService",
          "Shared intelligence. Activity is reported by the event bus.",
          "Chat",
          { importance: 1, status: "available" },
        ),
      );
    await Promise.all([
      ...(["application", "device"] as const).map((kind) =>
        !q.root && (wanted(kind) || (kind === "device" && wanted("location")))
          ? add(kind, async () => {
              const tool =
                kind === "application" ? "desktop.list_apps" : "studio.inspect";
              const decision = await this.actions.permissions.resolve(tool, {
                workspace: "ary-nexus",
                productIds: [],
              });
              if (decision.level < 1) throw new AppError("Restricted", 403);
              const observed = await this.actions.run(
                "activity.read",
                null,
                () => this.repo.readMapInspection(tool),
              );
              const matching = observed.filter(
                (r) => wanted(r.kind) && match(r.label),
              );
              for (const r of matching.slice(q.page * 24, q.page * 24 + 24)) {
                result.nodes.push(
                  mapNode(
                    r.id,
                    r.label,
                    r.kind,
                    "Saved inspection receipt",
                    r.detail,
                    kind === "device" ? "Studio" : "Action history",
                    { status: r.status, recency: r.updatedAt },
                  ),
                );
                if (r.locationId)
                  result.edges.push(
                    mapEdge(r.id, r.locationId, "located_in", "reference"),
                  );
                for (const id of r.entityIds)
                  result.edges.push(
                    mapEdge(r.id, id, "represents", "reference"),
                  );
              }
              if (matching.length > (q.page + 1) * 24) result.meta.more = true;
            })
          : Promise.resolve(),
      ),
      !q.kind || entityKinds.includes(q.kind) || q.root
        ? add("Entities", async () => {
            const g = await this.actions.run("entity.read", null, () =>
              new GraphQueryService(this.repo).query({
                q: q.q,
                root: q.root,
                depth: q.depth,
                after: q.root ? undefined : q.after,
                types: q.kind && entityKinds.includes(q.kind) ? [q.kind] : [],
                limit: 48,
                edge_limit: 160,
              }),
            );
            result.nodes.push(
              ...g.nodes.map((n) =>
                mapNode(
                  n.id,
                  n.label,
                  n.type as MapKind,
                  "Canonical entity",
                  `${n.connectedMemoryCount} connected memories · ${n.activeBlockerCount} active blockers`,
                  "Entities",
                  { ...n, kind: n.type as MapKind, recordId: n.id },
                ),
              ),
            );
            result.edges.push(
              ...g.edges.map((e) => ({
                ...e,
                provenance: "stored" as const,
                evidence: e.evidenceMemoryId ? [e.evidenceMemoryId] : [],
              })),
            );
            result.meta.more ||= g.meta.nodesTruncated || g.meta.edgesTruncated;
            result.meta.cursor = g.meta.nextCursor;
          })
        : Promise.resolve(),
      ...(["memory", "mission", "facets"] as MapRecordKind[]).map((kind) =>
        !q.root &&
        (!q.kind ||
          q.kind === kind ||
          (kind === "facets" &&
            [
              "location",
              "device",
              "application",
              "skill",
              "automation",
              "organization",
              "object",
            ].includes(q.kind)))
          ? add(kind, async () => {
              const permission =
                kind === "memory"
                  ? "memory.read"
                  : kind === "mission"
                    ? "conversation.read"
                    : "entity.read";
              const page = await this.actions.run(permission, null, () =>
                this.repo.readMapRecords(
                  kind,
                  q.q,
                  q.kind ? q.after : undefined,
                  kind === "facets" ? q.kind : undefined,
                ),
              );
              for (const r of page.records.filter((r) => wanted(r.kind))) {
                const id = kind === "facets" ? r.id : `${r.kind}:${r.id}`;
                result.nodes.push(
                  mapNode(
                    id,
                    r.label,
                    r.kind,
                    kind === "facets"
                      ? "Canonical entity metadata"
                      : `Canonical ${r.kind}`,
                    r.detail,
                    r.kind === "mission"
                      ? "Execution Plans"
                      : r.kind === "memory"
                        ? "Memories"
                        : "Entities",
                    { recordId: r.id, status: r.status, recency: r.updatedAt },
                  ),
                );
                for (const target of r.entityIds)
                  result.edges.push(
                    mapEdge(id, target, "references", "reference"),
                  );
                for (const memory of r.memoryIds)
                  result.edges.push(
                    mapEdge(id, `memory:${memory}`, "uses_memory", "reference"),
                  );
              }
              result.meta.more ||= page.more;
              if (q.kind && page.more)
                result.meta.cursor = page.records.at(-1)?.id ?? null;
            })
          : Promise.resolve(),
      ),
      q.lens === "nexus" &&
      !q.root &&
      (!q.kind || ["tool", "skill", "application", "agent"].includes(q.kind))
        ? add("Capabilities", async () => {
            const permission = await this.actions.permissions.resolve(
              "activity.read",
              { workspace: "ary-nexus", productIds: [] },
            );
            if (!permission.allowed) throw new AppError("Restricted", 403);
            const catalog = (await this.tools.catalog()).filter(
              (t) => !t.simulated,
            );
            if (wanted("agent")) {
              const workers = await this.actions.run(
                "conversation.read",
                null,
                () => readAgentViews(this.repo),
              );
              for (const { agent, status } of workers
                .filter((v) => match(v.agent.name))
                .slice(q.page * 24, q.page * 24 + 24)) {
                result.nodes.push(
                  mapNode(
                    `agent:${agent.id}`,
                    agent.name,
                    "agent",
                    "Persisted Agent Runtime profile",
                    `${agent.specialization}: ${agent.purpose}`,
                    "Agent Runtime",
                    { recordId: agent.id, status, recency: agent.created_at },
                  ),
                );
                result.edges.push(
                  mapEdge(
                    agent.parent_id ? `agent:${agent.parent_id}` : "system:ary",
                    `agent:${agent.id}`,
                    "delegates_to",
                    "stored",
                  ),
                );
                for (const mission of agent.missions)
                  result.edges.push(
                    mapEdge(
                      `agent:${agent.id}`,
                      `mission:${mission}`,
                      "assigned_to",
                      "stored",
                    ),
                  );
              }
              if (workers.length > (q.page + 1) * 24) result.meta.more = true;
            }
            if (wanted("agent"))
              for (const name of boardRoles.filter(match)) {
                result.nodes.push(
                  mapNode(
                    `agent:${name}`,
                    name,
                    "agent",
                    "Registered Board role",
                    "Advisory role sharing Ary memory; not an independent running agent.",
                    "Board",
                    { status: "available" },
                  ),
                );
                result.edges.push(
                  mapEdge(
                    "system:ary",
                    `agent:${name}`,
                    "advisory_role",
                    "capability",
                  ),
                );
              }
            const visible = catalog
              .filter((t) => match(`${t.name} ${t.description}`))
              .sort((a, b) => a.name.localeCompare(b.name));
            const page = visible.slice(q.page * 24, q.page * 24 + 24);
            if (wanted("tool"))
              for (const t of page) {
                result.nodes.push(
                  mapNode(
                    `tool:${t.name}`,
                    t.name,
                    "tool",
                    "Existing ToolRegistry",
                    `${t.description} · Permission level ${t.permission.level}. Registration does not imply a live connection.`,
                    "Approvals",
                    {
                      tool: t.name,
                      status:
                        t.permission.level === 0
                          ? "restricted"
                          : t.permission.approvalRequired
                            ? "approval_required"
                            : "registered",
                    },
                  ),
                );
              }
            if (wanted("skill"))
              for (const t of page) {
                const id = `skill:${t.name}`;
                result.nodes.push(
                  mapNode(
                    id,
                    t.available_actions[0],
                    "skill",
                    "ToolRegistry capability",
                    t.description,
                    "Approvals",
                    { tool: t.name, status: "registered" },
                  ),
                );
                result.edges.push(
                  mapEdge(id, `tool:${t.name}`, "implemented_by", "capability"),
                );
              }
            if (
              (wanted("tool") || wanted("skill")) &&
              visible.length > (q.page + 1) * 24
            )
              result.meta.more = true;
          })
        : Promise.resolve(),
    ]);
    if (
      q.lens === "nexus" &&
      !q.root &&
      (!q.kind || ["skill", "automation"].includes(q.kind))
    )
      await add("Saved workflows", async () => {
        const records = await this.actions.run("skill.read", null, () =>
          this.repo.list("messages"),
        );
        const artifacts = records
          .filter(
            (m) => m.metadata.nexus_skill_v1 || m.metadata.nexus_automation_v1,
          )
          .filter((m) => match(m.content))
          .slice(q.page * 24, q.page * 24 + 24);
        for (const m of artifacts) {
          const skill = m.metadata.nexus_skill_v1 as
            import("../domain/skills").SkillRecord | undefined;
          const auto = m.metadata.nexus_automation_v1 as
            import("../domain/skills").AutomationRecord | undefined;
          if (skill && wanted("skill")) {
            const v = skill.versions.at(-1)!;
            const id = `saved-skill:${skill.id}`;
            result.nodes.push(
              mapNode(
                id,
                v.definition.title,
                "skill",
                "Versioned Skill",
                `v${v.version} · ${v.approved_at ? "Reviewed" : "Draft"}. ${v.definition.instructions}`,
                "Skills",
                {
                  recordId: skill.id,
                  status: v.approved_at ? "reviewed" : "draft",
                  recency: m.updated_at,
                },
              ),
            );
            for (const tool of v.definition.permissions)
              result.edges.push(
                mapEdge(id, `tool:${tool}`, "requires_capability", "reference"),
              );
          }
          if (auto && wanted("automation")) {
            const id = `automation:${auto.id}`;
            result.nodes.push(
              mapNode(
                id,
                auto.definition.title,
                "automation",
                "Pinned trigger",
                `${auto.definition.trigger.kind}; creates Mission drafts only`,
                "Automations",
                {
                  recordId: auto.id,
                  status: auto.enabled ? "enabled" : "disabled",
                  recency: m.updated_at,
                },
              ),
            );
            result.edges.push(
              mapEdge(
                id,
                auto.definition.target.kind === "skill"
                  ? `saved-skill:${auto.definition.target.id}`
                  : `mission:${auto.definition.target.id}`,
                "triggers_draft",
                "reference",
              ),
            );
          }
        }
      });
    // Explicit facets take precedence over their generic entity representation; canonical ID is unchanged.
    if (result.nodes.length > 180) result.meta.more = true;
    result.nodes = [
      ...new Map(
        result.nodes
          .sort(
            (a, b) =>
              Number(a.source.includes("metadata")) -
              Number(b.source.includes("metadata")),
          )
          .map((n) => [n.id, n]),
      ).values(),
    ]
      .sort((a, b) => a.id.localeCompare(b.id))
      .slice(0, 180);
    const ids = new Set(result.nodes.map((n) => n.id));
    result.edges = result.edges
      .filter((e) => ids.has(e.source) && ids.has(e.target))
      .slice(0, 300);
    return result;
  }
}
