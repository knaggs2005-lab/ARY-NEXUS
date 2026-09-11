import { financeImport, financeQuery } from "../../domain/finance";
import type { Repository } from "../../domain/repository";
import type { ToolRegistry } from "../../domain/tool-registry";
import { FinanceService } from "../../services/finance-service";
import type { ActionService } from "../../services/action-service";
export function registerFinanceTools(
  registry: ToolRegistry,
  repo: Repository,
  actions?: ActionService,
) {
  const service = new FinanceService(repo, undefined, actions);
  return registry
    .register("finance.read", {
      inputSchema: financeQuery,
      execute: async (input) =>
        JSON.parse(JSON.stringify(await service.report(input))),
    })
    .register("finance.import", {
      inputSchema: financeImport,
      execute: async (input) => service.import(input),
    });
}
