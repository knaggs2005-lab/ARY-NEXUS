import { z } from "zod";
import {
  calendarWindow,
  validWindow,
  calendarConflicts,
  recommendBlocks,
  type CalendarProvider,
} from "../domain/calendar";
import type { Repository } from "../domain/repository";
import type { Table } from "../domain/models";
import { AppError } from "../domain/validation";
import { EntityResolutionService } from "./entity-resolution-service";
import type { ActionService } from "./action-service";
export const recommendationInput = calendarWindow
  .extend({ minutes: z.number().int().min(15).max(240) })
  .strict();
export class CalendarService {
  constructor(
    private repo: Repository,
    private actions: ActionService,
    private provider: CalendarProvider,
  ) {}
  async read(raw: unknown) {
    const window = calendarWindow.parse(raw);
    if (!validWindow(window.start, window.end))
      throw new AppError(
        "Choose a positive Calendar window of at most 31 days",
      );
    const data = await this.provider.list(window);
    // Use the canonical resolver with a request-local snapshot, never a parallel identity algorithm.
    return this.actions.run("entity.read", null, async () => {
      const snapshot = Object.create(this.repo) as Repository;
      const cache = new Map<Table, Promise<unknown>>();
      snapshot.list = ((table: Table) => {
        if (!cache.has(table)) cache.set(table, this.repo.list(table));
        return cache.get(table)!;
      }) as Repository["list"];
      const resolver = new EntityResolutionService(snapshot);
      const known = await snapshot.list("entities");
      const events = [];
      for (const event of data.events) {
        const resolution = await resolver.resolve(
          [event.summary, event.description, ...event.people]
            .join("\n")
            .slice(0, 12000),
        );
        const ids = new Set([
          ...event.entity_ids,
          ...resolution.entities.map((e) => e.id),
        ]);
        const linked = known.filter((e) => ids.has(e.id));
        events.push({
          ...event,
          entity_ids: linked.map((e) => e.id),
          entities: linked.map((e) => ({
            id: e.id,
            name: e.name,
            type: e.entity_type,
          })),
          resolution: resolution.resolutions,
        });
      }
      return { ...data, events, conflicts: calendarConflicts(events), window };
    });
  }
  async recommend(raw: unknown) {
    const input = recommendationInput.parse(raw);
    // Recommendation permissions never imply permission to read Calendar or entities.
    const data = await this.actions.run(
      "google_calendar.read",
      null,
      () =>
        this.read({
          start: input.start,
          end: input.end,
          ...(input.connection_id
            ? { connection_id: input.connection_id }
            : {}),
        }),
      {
        start: input.start,
        end: input.end,
        ...(input.connection_id ? { connection_id: input.connection_id } : {}),
      },
    );
    return {
      ...data,
      blocks: data.complete
        ? recommendBlocks(data.events, input.start, input.end, input.minutes)
        : [],
      recommendation_reason: data.complete
        ? "Suggestions only. Creating a block requires a separate approved event request."
        : "Calendar result is incomplete; no availability is inferred.",
    };
  }
}
