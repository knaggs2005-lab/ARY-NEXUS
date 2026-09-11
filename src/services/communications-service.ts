import type { Repository } from "../domain/repository";
import type { Action, Entity, Json } from "../domain/models";
import type {
  CommunicationEntry,
  CommunicationsSnapshot,
} from "../domain/communications";
import { ActionService } from "./action-service";
import { PermissionService } from "./permission-service";

const object = (value: unknown): Json =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : {};
const text = (value: unknown, max = 400) =>
  typeof value === "string" ? value.slice(0, max) : "";
const ids = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];
const rows = (value: unknown): Json[] =>
  Array.isArray(value) ? value.map(object) : [];
const instant = (value: unknown): string | null =>
  typeof value === "string" && Number.isFinite(Date.parse(value))
    ? new Date(value).toISOString()
    : null;
const addresses = (value: unknown): string[] =>
  text(value, 4000)
    .toLowerCase()
    .match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/g) ?? [];
const channelFor = (tool: string) =>
  tool.startsWith("gmail.")
    ? "gmail"
    : tool.startsWith("phone.")
      ? "phone"
      : tool.startsWith("google_calendar.")
        ? "calendar"
        : null;
const readTool = {
  gmail: "gmail.read",
  phone: "phone.read",
  calendar: "google_calendar.read",
};
function sourceKeys(action: Action): string[] {
  const result = object(action.output.result);
  const thread =
    action.tool_name === "gmail.summarize" ? object(result.thread) : result;
  if (["gmail.read", "gmail.summarize"].includes(action.tool_name))
    return [`gmail:${text(thread.connection_id)}:${text(thread.id)}`];
  if (action.tool_name === "gmail.send")
    return [
      `gmail:${text(action.input.connection_id)}:${text(result.thread_id) || text(result.message_id)}`,
    ];
  if (action.tool_name === "gmail.draft") return [`draft:${action.id}`];
  if (result.kind === "phone_call")
    return [
      `phone:${text(result.operation_id) || text(result.call_action_id)}`,
    ];
  if (action.tool_name.startsWith("google_calendar."))
    return [
      ...rows(result.events),
      ...(result.event ? [object(result.event)] : []),
    ].map(
      (event) =>
        `calendar:${text(result.connection_id) || text(action.input.connection_id)}:${text(event.id)}`,
    );
  return [];
}

/** Derived, owner-scoped source projection. Never fetches providers or writes memories. */
export class CommunicationsService {
  constructor(
    private repo: Repository,
    private actions = new ActionService(repo),
    private now = () => Date.now(),
  ) {}

  read(
    options: { entity_id?: string; offset?: number; limit?: number } = {},
  ): Promise<CommunicationsSnapshot> {
    return this.actions.run(
      "communications.read",
      null,
      () => this.project(options),
      options,
    );
  }

  private async project(options: {
    entity_id?: string;
    offset?: number;
    limit?: number;
  }): Promise<CommunicationsSnapshot> {
    const now = this.now();
    const [actions, entities, relationships, tasks, approvals, policies] =
      await Promise.all([
        this.repo.list("actions"),
        this.repo.list("entities"),
        this.repo.list("relationships"),
        this.repo.list("tasks"),
        this.repo.list("action_approvals"),
        this.repo.list("permission_policies"),
      ]);
    const permissions = new PermissionService(this.repo);
    const superseded = new Set(policies.map((p) => p.parent_id));
    permissions.currentPolicies = async () =>
      policies.filter((p) => !superseded.has(p.id));
    const allowed = async (tool: string, scope: string[]) =>
      (
        await permissions.resolve(tool, {
          workspace: "ary-nexus",
          productIds: scope,
        })
      ).allowed;
    const known = new Map(entities.map((e) => [e.id, e]));
    const scopes = (direct: string[]) => {
      const linked = new Set(direct.filter((id) => known.has(id)));
      // One explicit current relationship hop provides company/project context, not identity merging.
      for (const edge of relationships) {
        if (
          (edge.valid_from && Date.parse(edge.valid_from) > now) ||
          (edge.valid_to && Date.parse(edge.valid_to) <= now)
        )
          continue;
        const other = direct.includes(edge.source_entity_id)
          ? edge.target_entity_id
          : direct.includes(edge.target_entity_id)
            ? edge.source_entity_id
            : null;
        if (
          other &&
          ["company", "project"].includes(known.get(other)?.entity_type ?? "")
        )
          linked.add(other);
      }
      return [...linked];
    };
    const actionScope = (a: Action) => [
      ...new Set([
        ...ids(a.metadata.related_entity_ids),
        ...ids(a.product_entity_ids),
        ...ids(a.input.entity_ids),
      ]),
    ];
    const byId = new Map(actions.map((a) => [a.id, a]));
    const entries = new Map<string, CommunicationEntry>();
    const deniedSources = new Set<string>();
    const sourceScopes = new Map<string, string[]>();
    const visibleEntities = new Map<string, Entity>();
    for (const e of entities)
      if (
        (await allowed("communications.read", scopes([e.id]))) &&
        (await allowed("entity.read", scopes([e.id])))
      )
        visibleEntities.set(e.id, e);
    const sorted = actions.toSorted(
      (a, b) =>
        a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
    );
    for (const a of sorted) {
      const channel = channelFor(a.tool_name);
      if (!channel || a.status !== "succeeded") continue;
      const result = object(a.output.result);
      const thread =
        a.tool_name === "gmail.summarize" ? object(result.thread) : result;
      const linked = [
        ...actionScope(a),
        ...ids(result.entity_ids),
        ...ids(result.related_entity_ids),
        ...rows(thread.entities).map((e) => text(e.id)),
      ];
      // Only an exact stored address match links a sender/recipient; duplicate addresses stay unresolved.
      if (channel === "gmail") {
        const observed = new Set(
          rows(thread.messages).flatMap((m) => [
            ...addresses(m.from),
            ...addresses(m.to),
          ]),
        );
        for (const address of observed) {
          const matches = entities.filter((e) =>
            addresses(e.metadata.email).includes(address),
          );
          if (matches.length === 1) linked.push(matches[0].id);
        }
      }
      if (typeof result.contact_entity_id === "string")
        linked.push(result.contact_entity_id);
      const direct = [...new Set(linked)].filter((id) => known.has(id));
      const context = scopes(direct);
      if (
        !(await allowed("communications.read", context)) ||
        !(await allowed(readTool[channel], context)) ||
        !(await allowed("entity.read", context))
      ) {
        for (const key of sourceKeys(a)) deniedSources.add(key);
        continue;
      }
      const base = {
        observed_at: a.created_at,
        entity_ids: direct,
        context_entity_ids: context,
        source: {
          channel,
          action_id: a.id,
          record_id: a.id,
        } as CommunicationEntry["source"],
      };
      const put = (entry: CommunicationEntry) => {
        const previous = entries.get(entry.id);
        // A stale mailbox read must not erase a newer observed send.
        if (!(
          previous?.source.channel === "gmail" &&
          previous.occurred_at &&
          entry.occurred_at &&
          previous.occurred_at > entry.occurred_at
        ))
          entries.set(entry.id, entry);
        sourceScopes.set(a.id, [
          ...new Set([
            ...(sourceScopes.get(a.id) ?? []),
            ...entry.context_entity_ids,
          ]),
        ]);
      };
      if (
        channel === "gmail" &&
        ["gmail.read", "gmail.summarize"].includes(a.tool_name) &&
        typeof thread.id === "string" &&
        typeof thread.connection_id === "string"
      ) {
        const messages = rows(thread.messages);
        if (!messages.length) continue;
        const key = `gmail:${thread.connection_id}:${thread.id}`;
        const account = text(thread.account).toLowerCase();
        const dated = messages
          .filter((m) => instant(m.date))
          .sort((a, b) => Date.parse(text(a.date)) - Date.parse(text(b.date)));
        const latest = dated.at(-1);
        const complete =
          !thread.truncated &&
          dated.length === messages.length &&
          !!latest &&
          Date.parse(text(latest.date)) <= now;
        const from = addresses(latest?.from),
          to = addresses(latest?.to);
        const outbound =
          complete &&
          from.length === 1 &&
          from[0] === account &&
          to.some((v) => v !== account);
        const inbound =
          complete &&
          from.length === 1 &&
          from[0] !== account &&
          to.includes(account);
        put({
          ...base,
          id: key,
          source: {
            ...base.source,
            connection_id: text(thread.connection_id),
            record_id: text(thread.id),
          },
          title: text(latest?.subject) || "Observed email thread",
          summary:
            (a.tool_name === "gmail.summarize" ? text(result.summary) : "") ||
            "Observed email context. Open the source for details.",
          occurred_at: instant(latest?.date),
          contact: !!latest,
          state: outbound
            ? "outbound_observed"
            : inbound
              ? "inbound_observed"
              : "direction_unknown",
          attention: outbound
            ? "awaiting_reply"
            : inbound
              ? "review_inbound"
              : null,
          evidence: complete
            ? "Latest observed message direction; subsequent replies and reply obligation are not known. Any summary reflects its captured source."
            : "Partial or undated thread; no reply status inferred.",
        });
      } else if (
        a.tool_name === "gmail.draft" &&
        typeof result.source_thread_id === "string"
      ) {
        put({
          ...base,
          id: `draft:${a.id}`,
          source: {
            ...base.source,
            connection_id: text(result.connection_id),
            record_id: text(result.source_thread_id),
          },
          title: text(result.subject) || "Email draft",
          summary:
            "Draft prepared. This does not establish contact or an obligation; inspect its source before sending.",
          occurred_at: a.created_at,
          contact: false,
          state: "draft",
          attention: null,
          evidence: `Unsent draft action ${a.id}. Sending remains a separate approved action.`,
        });
      } else if (
        a.tool_name === "gmail.send" &&
        typeof result.message_id === "string"
      ) {
        // The current adapter sends a new message; source_thread_id is provenance, not a reply-thread guarantee.
        const key = `gmail:${text(a.input.connection_id)}:${text(result.thread_id) || text(result.message_id)}`;
        put({
          ...base,
          id: key,
          source: {
            ...base.source,
            connection_id: text(a.input.connection_id),
            record_id: text(result.thread_id) || text(result.message_id),
          },
          title: text(a.input.subject) || "Approved email",
          summary:
            "Gmail accepted the approved message; delivery is not independently confirmed.",
          occurred_at: a.created_at,
          contact: true,
          state: "send_accepted",
          attention: "awaiting_reply",
          evidence: `Provider receipt ${text(result.message_id)}. No later reply has been observed in this source.`,
        });
      } else if (channel === "phone" && result.kind === "phone_call") {
        const snapshot = object(result.snapshot);
        const key = `phone:${text(result.operation_id) || text(result.call_action_id)}`;
        if (!snapshot.id || !result.operation_id) continue;
        const completed = snapshot.status === "completed";
        put({
          ...base,
          id: key,
          source: { ...base.source, record_id: text(snapshot.id) },
          title: "Call · " + text(snapshot.status),
          summary: completed
            ? "Connection completed; recipient agreement and business outcome remain unknown."
            : "Call attempt recorded; open Calls for the provider result.",
          occurred_at:
            byId.get(text(result.call_action_id))?.created_at ?? a.created_at,
          contact: completed,
          state: text(snapshot.status),
          attention: ["completed", "no-answer", "busy", "failed"].includes(
            text(snapshot.status),
          )
            ? "review_call"
            : null,
          evidence: `Provider ${text(result.provider)}; snapshot observed ${text(result.observed_at)}. A completed call may reach voicemail.`,
        });
      } else if (channel === "calendar") {
        const events = rows(result.events);
        if (result.event) events.push(object(result.event));
        for (const event of events) {
          if (typeof event.id !== "string") continue;
          const eventDirect = [
            ...new Set([...direct, ...ids(event.entity_ids)]),
          ].filter((id) => known.has(id));
          const eventContext = scopes(eventDirect);
          if (
            !(await allowed("communications.read", eventContext)) ||
            !(await allowed(readTool.calendar, eventContext)) ||
            !(await allowed("entity.read", eventContext))
          ) {
            deniedSources.add(
              `calendar:${text(result.connection_id) || text(a.input.connection_id)}:${event.id}`,
            );
            continue;
          }
          const connection =
            text(result.connection_id) || text(a.input.connection_id);
          if (!connection) continue;
          put({
            ...base,
            id: `calendar:${connection}:${event.id}`,
            source: {
              ...base.source,
              connection_id: connection,
              record_id: event.id,
            },
            entity_ids: eventDirect,
            context_entity_ids: eventContext,
            title: text(event.summary) || "Calendar event",
            summary:
              "Scheduled context; attendance and later changes are not verified.",
            occurred_at: instant(event.start),
            contact: false,
            state: "scheduled_context",
            attention: null,
            evidence: `Event ${event.id}; observed at ${a.created_at}. Calendar context is not proof of contact.`,
          });
        }
      }
    }
    // A denied observation cannot expose an older, less richly linked copy of the same source.
    for (const key of deniedSources) entries.delete(key);
    for (const action of sorted)
      if (sourceKeys(action).some((key) => deniedSources.has(key)))
        sourceScopes.delete(action.id);
    // Debrief follow-ups reuse the visibility of their original email/call evidence.
    for (const action of sorted) {
      if (
        action.tool_name !== "communications.debrief" ||
        action.status !== "succeeded"
      )
        continue;
      const result = action.output.result as Json;
      const original = sourceScopes.get(text(result.evidence_action_id));
      const scope = scopes([...actionScope(action), ...(original ?? [])]);
      if (
        original &&
        (await allowed("communications.read", scope)) &&
        (await allowed("entity.read", scope))
      )
        sourceScopes.set(action.id, scope);
    }
    const pending: CommunicationsSnapshot["approvals"] = [];
    for (const a of sorted) {
      if (a.status !== "approval_required") continue;
      const channel = channelFor(a.tool_name);
      const source =
        text(a.metadata.source_action_id) || text(a.input.source_action_id);
      if (
        !channel &&
        !(a.tool_name === "create_task" && sourceScopes.has(source))
      )
        continue;
      const scope = scopes([
        ...actionScope(a),
        ...(sourceScopes.get(source) ?? []),
      ]);
      if (
        !(await allowed(
          channel ? readTool[channel] : "activity.read",
          scope,
        )) ||
        !(await allowed("communications.read", scope)) ||
        !(await allowed("entity.read", scope))
      )
        continue;
      const reviews = approvals
        .filter((p) => p.action_id === a.id)
        .sort((a, b) => a.created_at.localeCompare(b.created_at));
      if (reviews.some((p) => p.consumed_at || p.decision === "rejected"))
        continue;
      const review = reviews.at(-1);
      pending.push({
        action_id: a.id,
        tool: a.tool_name,
        reason: text(a.metadata.reason),
        created_at: a.created_at,
        entity_ids: scope,
        state: !review
          ? "needs_review"
          : Date.parse(review.expires_at) <= now
            ? "expired_review"
            : "approved_not_executed",
      });
    }
    const followUps: CommunicationsSnapshot["follow_ups"] = [];
    for (const task of tasks) {
      const source = text(task.metadata.source_action_id);
      if (
        !["pending", "in_progress"].includes(task.status) ||
        !sourceScopes.has(source)
      )
        continue;
      const scope = scopes([
        ...ids(task.metadata.related_entity_ids),
        ...(task.entity_id ? [task.entity_id] : []),
        ...sourceScopes.get(source)!,
      ]);
      if (
        !(await allowed("activity.read", scope)) ||
        !(await allowed("communications.read", scope)) ||
        !(await allowed("entity.read", scope))
      )
        continue;
      followUps.push({
        id: task.id,
        title: task.title,
        status: task.status,
        due_at: task.due_at,
        source_action_id: source,
        entity_ids: scope,
      });
    }
    const allEntries = [...entries.values()];
    const people: CommunicationsSnapshot["people"] = [];
    for (const entity of visibleEntities.values()) {
      if (!["person", "company", "project"].includes(entity.entity_type))
        continue;
      const history = allEntries.filter((e) =>
        e.context_entity_ids.includes(entity.id),
      );
      const open = followUps.filter((t) => t.entity_ids.includes(entity.id));
      const queue = pending.filter((p) => p.entity_ids.includes(entity.id));
      if (!history.length && !open.length && !queue.length) continue;
      const inbound = history.filter(
        (e) => e.attention === "review_inbound",
      ).length;
      const unanswered = history.filter(
        (e) => e.attention === "awaiting_reply",
      ).length;
      const calls = history.filter((e) => e.attention === "review_call").length;
      const overdue = open.filter(
        (t) => t.due_at && Date.parse(t.due_at) < now,
      ).length;
      const reasons = [
        overdue ? `${overdue} overdue source-linked task(s)` : "",
        queue.length ? `${queue.length} approval(s) to review` : "",
        open.length ? `${open.length} open follow-up task(s)` : "",
        inbound ? `${inbound} latest inbound thread(s) to review` : "",
        unanswered
          ? `${unanswered} outbound thread(s) with no later observed reply`
          : "",
        calls ? `${calls} call outcome(s) to review` : "",
      ].filter(Boolean);
      people.push({
        entity: { id: entity.id, name: entity.name, type: entity.entity_type },
        last_contact:
          history
            .filter(
              (e) =>
                e.contact && e.occurred_at && Date.parse(e.occurred_at) <= now,
            )
            .map((e) => e.occurred_at!)
            .sort()
            .at(-1) ?? null,
        open_follow_ups: open.length,
        unanswered_threads: unanswered,
        pending_approvals: queue.length,
        score:
          overdue * 100 +
          queue.length * 50 +
          open.length * 30 +
          inbound * 20 +
          unanswered * 10 +
          calls * 5,
        reasons,
        suggested_next_action: overdue
          ? "Review the overdue follow-up task."
          : queue.length
            ? "Inspect the pending approval before any outreach."
            : open.length
              ? "Review the existing follow-up task."
              : inbound
                ? "Open the latest email and decide whether a draft is needed."
                : unanswered
                  ? "Refresh the source thread before deciding to follow up."
                  : calls
                    ? "Inspect the call outcome before proposing a follow-up."
                    : "Review scheduled context; no follow-up obligation is established.",
      });
    }
    const match = (entityIds: string[]) =>
      !options.entity_id || entityIds.includes(options.entity_id);
    const timeline = allEntries
      .filter((e) => match(e.context_entity_ids))
      .sort(
        (a, b) =>
          (b.occurred_at ?? b.observed_at).localeCompare(
            a.occurred_at ?? a.observed_at,
          ) || a.id.localeCompare(b.id),
      );
    const offset = options.offset ?? 0,
      limit = options.limit ?? 50;
    return {
      observed_at: new Date(now).toISOString(),
      timeline: timeline.slice(offset, offset + limit),
      follow_ups: followUps.filter((t) => match(t.entity_ids)),
      approvals: pending.filter((p) => match(p.entity_ids)),
      people: people
        .filter((p) => !options.entity_id || p.entity.id === options.entity_id)
        .sort(
          (a, b) =>
            b.score - a.score || a.entity.name.localeCompare(b.entity.name),
        ),
      total: timeline.length,
      has_more: timeline.length > offset + limit,
      coverage: [
        "Observed, permitted Ary action receipts only; not a synced inbox or complete communication history.",
        "No later observed reply does not prove an unanswered obligation. Refresh Gmail before outreach.",
        "Last contact means an observed email or completed connection, not verified delivery or a human conversation.",
        "Company/project context follows one explicit current relationship hop. No similar-name identity merging.",
        "Messages/SMS are reserved in the source contract; no provider is connected. No automatic outreach or memory writes.",
      ],
    };
  }
}
