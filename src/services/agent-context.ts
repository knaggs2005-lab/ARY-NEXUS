import { AsyncLocalStorage } from "node:async_hooks";
export const agentAssignment = new AsyncLocalStorage<string>();
/** Server-created scope only. Tool input cannot manufacture an identity or a permission ceiling. */
export const agentExecution = new AsyncLocalStorage<{
  id: string;
  userId: string;
  permissionLevel: number;
  tools: readonly string[];
  check: () => Promise<void>;
}>();
