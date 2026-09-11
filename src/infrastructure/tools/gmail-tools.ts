import {
  gmailSearch,
  gmailThreadInput,
  gmailDraftInput,
  gmailSendInput,
  gmailEvidenceInput,
} from "../../domain/gmail";
import type { ToolRegistry } from "../../domain/tool-registry";
import type { Repository } from "../../domain/repository";
import { GmailService } from "../../services/gmail-service";
import { ActionService } from "../../services/action-service";
import { GoogleGmailProvider } from "../gmail/google-gmail";
export function registerGmailTools(
  registry: ToolRegistry,
  repo: Repository,
  service = new GmailService(
    repo,
    new ActionService(repo),
    new GoogleGmailProvider(repo.userId),
  ),
) {
  return registry
    .register("gmail.search", {
      inputSchema: gmailSearch,
      execute: async (i) => ({ ...(await service.search(i)) }),
    })
    .register("gmail.read", {
      inputSchema: gmailThreadInput,
      execute: async (i) => ({ ...(await service.read(i)) }),
    })
    .register("gmail.summarize", {
      inputSchema: gmailThreadInput,
      execute: async (i) => ({ ...(await service.summarize(i)) }),
    })
    .register("gmail.draft", {
      inputSchema: gmailDraftInput,
      execute: async (i) => ({ ...(await service.draft(i)) }),
    })
    .register("gmail.send", {
      inputSchema: gmailSendInput,
      execute: async (i) => ({ ...(await service.send(i)) }),
    })
    .register("gmail.evidence", {
      inputSchema: gmailEvidenceInput,
      execute: async (i) => ({ ...(await service.evidence(i)) }),
    });
}
