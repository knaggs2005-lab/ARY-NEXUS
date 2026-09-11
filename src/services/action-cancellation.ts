import { AsyncLocalStorage } from "node:async_hooks";
export const actionCancellation = new AsyncLocalStorage<AbortSignal>();
const controllers = new Map<string, Set<AbortController>>();
export function registerActionCancellation(userId: string) {
  const controller = new AbortController();
  const active = controllers.get(userId) ?? new Set<AbortController>();
  active.add(controller);
  controllers.set(userId, active);
  return {
    controller,
    release() {
      active.delete(controller);
      if (!active.size) controllers.delete(userId);
    },
  };
}
/** Cooperative cancellation, never a claim that a completed external effect was undone. */
export function abortOwnerActions(userId: string) {
  for (const controller of controllers.get(userId) ?? [])
    controller.abort(new Error("Emergency stop requested"));
}

const controlHooks = new Map<string, (owner: string) => Promise<void>>();
export function registerControlStop(
  name: string,
  stop: (owner: string) => Promise<void>,
) {
  controlHooks.set(name, stop);
}
/** Stop owned resources after the durable permission latch is set. Never resets that latch. */
export async function stopOwnerControl(owner: string) {
  await Promise.all([...controlHooks.values()].map((stop) => stop(owner)));
}
