import { z } from "zod";
import { delegatedJobInput } from "../../domain/agent-provider";
import type { ToolRegistry } from "../../domain/tool-registry";
import type { DelegatedJobService } from "../../services/delegated-job-service";
export function registerWorkerTools(
  registry: ToolRegistry,
  service: DelegatedJobService,
) {
  const id = z.object({ job_id: z.uuid() }).strict();
  registry.register("worker.submit", {
    inputSchema: delegatedJobInput,
    execute: (i, c) => service.submit(i, c),
  });
  registry.register("worker.recover", {
    inputSchema: id,
    execute: (i, c) => service.recover(i.job_id, c),
  });
  registry.register("worker.refresh", {
    inputSchema: id,
    execute: (i, c) => service.refresh(i.job_id, c),
  });
  registry.register("worker.cancel", {
    inputSchema: id,
    execute: (i, c) => service.cancel(i.job_id, c),
  });
  registry.register("worker.review", {
    inputSchema: id.extend({ proposal: z.string().min(1).max(20000) }).strict(),
    execute: (i, c) => service.review(i.job_id, i.proposal, c),
  });
}
