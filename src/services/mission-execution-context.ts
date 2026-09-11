import { AsyncLocalStorage } from "node:async_hooks";
import type { Repository } from "../domain/repository";
import { AppError, required } from "../domain/validation";
/** Internal only: never populated from model/tool inputs. Fences late workers after lease expiry. */
export const missionExecution = new AsyncLocalStorage<{
  id: string;
  token: string;
}>();
export async function assertMissionLease(repo: Repository, id: string) {
  const context = missionExecution.getStore();
  const row = required(await repo.get("messages", id), "Mission");
  const lease = row.metadata.mission_lease as
    { token?: string; until?: string } | undefined;
  if (
    !context ||
    context.id !== id ||
    lease?.token !== context.token ||
    !(Date.parse(lease?.until ?? "") > Date.now())
  )
    throw new AppError("Mission lease expired or owned by another worker", 409);
  return context.token;
}
