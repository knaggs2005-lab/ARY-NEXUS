import type { Repository } from "../domain/repository";
import type { Entity, EntityAlias } from "../domain/models";
import type {
  EntityResolution,
  EntityResolutionResult,
} from "../domain/entity-resolution";
import { isCurrentRelationship } from "./relationship-validity";

type Token = { key: string; start: number; end: number };
const tokens = (text: string): Token[] =>
  Array.from(text.matchAll(/[\p{L}\p{N}]+/gu), (m) => ({
    key: m[0].normalize("NFKC").toLowerCase(),
    start: m.index!,
    end: m.index! + m[0].length,
  }));
export const entityNameKey = (text: string) =>
  tokens(text)
    .map((t) => t.key)
    .join(" ");
type Match = {
  start: number;
  end: number;
  ids: Set<string>;
  kind: "canonical" | "alias" | "partial";
};
const affiliationTypes = new Set([
  "works_at",
  "works_for",
  "employed_by",
  "member_of",
  "affiliated_with",
  "contact_for",
  "founder_of",
  "employs",
  "has_member",
  "has_contact",
  "founded_by",
]);
/** Read-only identity resolution. Similar spelling never creates, renames or merges records. */
export class EntityResolutionService {
  constructor(private repository: Repository) {}
  async resolve(text: string): Promise<EntityResolutionResult> {
    const [entities, aliases] = await Promise.all([
      this.repository.list("entities"),
      this.repository.list("entity_aliases"),
    ]);
    const byId = new Map(entities.map((e) => [e.id, e]));
    const source = tokens(text);
    const accepted: Match[] = [];
    const proposals: Match[] = [];
    const detect = (
      terms: { name: string; id: string }[],
      kind: Match["kind"],
    ) => {
      const grouped = new Map<string, { words: string[]; ids: Set<string> }>();
      for (const term of terms) {
        if (!byId.has(term.id)) continue;
        const key = entityNameKey(term.name);
        if (!key) continue;
        const row = grouped.get(key) ?? {
          words: key.split(" "),
          ids: new Set<string>(),
        };
        row.ids.add(term.id);
        grouped.set(key, row);
      }
      const found: Match[] = [];
      for (const { words, ids } of grouped.values())
        for (let i = 0; i <= source.length - words.length; i++) {
          if (!words.every((word, j) => source[i + j].key === word)) continue;
          const start = source[i].start,
            end = source[i + words.length - 1].end;
          // Do not join a name across sentence boundaries.
          if (/[.!?;\n]/u.test(text.slice(start, end))) continue;
          if (kind === "partial" && text[start] === text[start].toLowerCase())
            continue;
          found.push({ start, end, ids, kind });
        }
      proposals.push(...found);
    };
    detect(
      entities.map((e) => ({ name: e.name, id: e.id })),
      "canonical",
    );
    detect(
      aliases.map((a: EntityAlias) => ({ name: a.alias, id: a.entity_id })),
      "alias",
    );
    detect(
      entities
        .filter((e) => e.entity_type === "person")
        .flatMap((e) => {
          const parts = tokens(e.name);
          return parts.length > 1
            ? [
                { name: e.name.slice(parts[0].start, parts[0].end), id: e.id },
                {
                  name: e.name.slice(parts.at(-1)!.start, parts.at(-1)!.end),
                  id: e.id,
                },
              ]
            : [];
        }),
      "partial",
    );
    // Resolve a complete known phrase before a shorter substring. At the same span, canonical names beat aliases.
    const priority = { canonical: 0, alias: 1, partial: 2 };
    proposals.sort(
      (a, b) =>
        b.end - b.start - (a.end - a.start) ||
        priority[a.kind] - priority[b.kind] ||
        a.start - b.start,
    );
    for (const match of proposals)
      if (!accepted.some((m) => match.start < m.end && match.end > m.start))
        accepted.push(match);
    accepted.sort((a, b) => a.start - b.start);
    const traces: EntityResolution[] = accepted.map((m) => {
      const candidates = Array.from(m.ids)
        .map((id) => byId.get(id)!)
        .map((e) => ({ id: e.id, name: e.name, entity_type: e.entity_type }))
        .sort((a, b) => a.id.localeCompare(b.id));
      const direct =
        candidates.length === 1 && m.kind !== "partial" ? candidates[0] : null;
      return {
        mention: text.slice(m.start, m.end),
        start: m.start,
        end: m.end,
        status: direct ? "resolved" : "ambiguous",
        method: direct ? (m.kind as "canonical" | "alias") : "unresolved",
        canonical_entity_id: direct?.id ?? null,
        canonical_name: direct?.name ?? null,
        confidence: direct ? (m.kind === "canonical" ? 1 : 0.98) : 0,
        reason: direct
          ? m.kind === "canonical"
            ? "Exact canonical name match (case and token normalized)."
            : "Exact known alias; canonical ID retained."
          : m.kind === "partial"
            ? "Partial person name requires explicit distinguishing context."
            : "Multiple canonical records match this name; clarification is required.",
        candidates,
        evidence_relationship_ids: [],
      };
    });
    if (traces.some((t) => t.status === "ambiguous")) {
      const [relationships, memories] = await Promise.all([
        this.repository.list("relationships"),
        this.repository.list("memories"),
      ]);
      const edges = relationships.filter(
        (e) =>
          isCurrentRelationship(e) &&
          e.strength > 0 &&
          affiliationTypes.has(
            e.relationship_type.toLowerCase().replace(/\s+/g, "_"),
          ) &&
          (!e.memory_id ||
            memories.some(
              (m) =>
                m.id === e.memory_id &&
                !m.archived_at &&
                m.status === "active" &&
                (!m.valid_from || Date.parse(m.valid_from) <= Date.now()) &&
                (!m.valid_to || Date.parse(m.valid_to) > Date.now()),
            )),
      );
      // Only an explicit adjacent qualifier such as "Alex at Clevaryn" is identity evidence.
      // Co-mention elsewhere in a sentence, history, and name similarity are insufficient.
      const anchors = traces.filter((t) => t.status === "resolved");
      for (const trace of traces.filter((t) => t.status === "ambiguous")) {
        const qualifiers = anchors.filter(
          (a) =>
            (a.start >= trace.end &&
              /^\s+(?:at|from|of|with)\s+$/i.test(
                text.slice(trace.end, a.start),
              )) ||
            (a.end <= trace.start &&
              /^['’]s\s+$/i.test(text.slice(a.end, trace.start))),
        );
        const supported = trace.candidates
          .map((candidate) => ({
            candidate,
            edges: edges.filter((e) =>
              qualifiers.some(
                (a) =>
                  (e.source_entity_id === candidate.id &&
                    e.target_entity_id === a.canonical_entity_id) ||
                  (e.target_entity_id === candidate.id &&
                    e.source_entity_id === a.canonical_entity_id),
              ),
            ),
          }))
          .filter((x) => x.edges.length);
        if (supported.length === 1) {
          const choice = supported[0];
          Object.assign(trace, {
            status: "resolved",
            method: "context",
            canonical_entity_id: choice.candidate.id,
            canonical_name: choice.candidate.name,
            confidence: 0.9,
            reason:
              "Explicit affiliation qualifier matches exactly one candidate through a current recorded relationship.",
            evidence_relationship_ids: choice.edges.map((e) => e.id),
          });
        } else if (supported.length > 1)
          trace.reason =
            "The affiliation context matches multiple candidates; clarification is required.";
      }
    }
    const ids = new Set(
      traces.flatMap((t) =>
        t.canonical_entity_id ? [t.canonical_entity_id] : [],
      ),
    );
    return {
      entities: entities.filter((e) => ids.has(e.id)),
      resolutions: traces,
    };
  }
}
