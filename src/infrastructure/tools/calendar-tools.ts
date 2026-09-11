import {
  calendarWindow,
  calendarWriteInput,
  calendarUpdateInput,
  validWindow,
} from "../../domain/calendar";
import type { CalendarProvider } from "../../domain/calendar";
import type { ToolRegistry } from "../../domain/tool-registry";
import type { Repository } from "../../domain/repository";
import { AppError } from "../../domain/validation";
import {
  CalendarService,
  recommendationInput,
} from "../../services/calendar-service";
import { ActionService } from "../../services/action-service";
import { GoogleCalendarProvider } from "../calendar/google-calendar";
export function registerCalendarTools(
  registry: ToolRegistry,
  repo: Repository,
  provider: CalendarProvider = new GoogleCalendarProvider(repo.userId),
) {
  const service = new CalendarService(repo, new ActionService(repo), provider);
  registry.register("google_calendar.read", {
    inputSchema: calendarWindow,
    execute: async (input) => ({ ...(await service.read(input)) }),
  });
  registry.register("google_calendar.recommend", {
    inputSchema: recommendationInput,
    execute: async (input) => ({ ...(await service.recommend(input)) }),
  });
  registry.register("google_calendar.create", {
    inputSchema: calendarWriteInput,
    execute: async (input, context) => {
      validateEvent(input.event);
      return { ...(await provider.create(input, context.entityIds || [])) };
    },
  });
  registry.register("google_calendar.update", {
    inputSchema: calendarUpdateInput,
    execute: async (input, context) => {
      validateEvent(input.event);
      return { ...(await provider.update(input, context.entityIds || [])) };
    },
  });
  return registry;
}
function validateEvent(event: {
  start: string;
  end: string;
  time_zone: string;
}) {
  if (!validWindow(event.start, event.end, 7))
    throw new AppError("Event end must follow start, at most seven days later");
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: event.time_zone });
  } catch {
    throw new AppError("Invalid event time zone");
  }
}
