import { z } from "zod";
import type { ToolRegistry } from "../../domain/tool-registry";
import {
  observeInput,
  planInput,
  patchInput,
  sha,
  sourcePath,
} from "../../domain/self-development";
import type { SelfDevelopmentService } from "../../services/self-development-service";

import type { DevelopmentAutonomyService } from "../../services/development-autonomy-service";

export function registerDevelopmentTools(
  tools: ToolRegistry,
  service: SelfDevelopmentService,
  guard: () => void = () => {},
  autonomy?: DevelopmentAutonomyService,
) {
  const id = z.object({ run_id: z.uuid() }).strict();
  const register: ToolRegistry["register"] = (name, tool) =>
    tools.register(name, {
      ...tool,
      preflight: guard,
      capability: {
        origin: "local_program",
        execution_location: "local_mac",
        authentication: {
          method: "local_consent",
          configured: true,
          note: "Explicit owner-local development enablement; exact action approvals",
        },
        availability: {
          state: "available",
          evidence: "configuration",
          checked_at: null,
          reason: "Registered, not proof of successful sandbox validation",
        },
      },
    });
  if (autonomy) {
    register("development.autonomy_inspect", {
      inputSchema: id,
      execute: (i) => autonomy.inspect(i.run_id),
    });
    register("development.autonomy_metrics", {
      inputSchema: z.object({}).strict(),
      execute: () => autonomy.metrics(),
    });
    register("development.qualify", {
      inputSchema: id.extend({ outcome_id: z.uuid() }).strict(),
      execute: (i, c) => autonomy.qualify(i.run_id, i.outcome_id, c),
    });
    register("development.autorelease", {
      inputSchema: id.extend({ release_hash: sha }).strict(),
      execute: (i, c) => autonomy.release(i.run_id, i.release_hash, c),
    });
    register("development.discover", {
      inputSchema: id,
      execute: (i, c) => autonomy.discover(i.run_id, c),
    });
  }
  register("development.feedback", {
    inputSchema: id
      .extend({
        revision: z.number().int().nonnegative(),
        decision: z.enum(["reject", "revision"]),
        reason: z.string().trim().min(5).max(1000),
      })
      .strict(),
    execute: (i, c) =>
      service.feedback(i.run_id, i.revision, i.decision, i.reason, c),
  });
  register("development.verify", {
    inputSchema: id
      .extend({
        stage: z.enum([
          "workspace",
          "implement",
          "test",
          "review",
          "release",
          "decision",
        ]),
      })
      .strict(),
    execute: (i) => service.verify(i.run_id, i.stage),
  });
  register("development.source", {
    inputSchema: z
      .object({
        base_commit: z.string().regex(/^[a-f0-9]{40}$/),
        paths: z.array(sourcePath).min(1).max(8),
      })
      .strict(),
    execute: (i) => service.source(i.base_commit, i.paths),
  });
  register("development.cleanup", {
    inputSchema: id,
    execute: (i, c) => service.cleanup(i.run_id, c),
  });
  register("development.unlock", {
    inputSchema: id,
    execute: (i, c) => service.unlock(i.run_id, c),
  });
  register("development.observe", {
    inputSchema: observeInput,
    execute: (i, c) => service.observe(i, c),
  });
  register("development.inspect", {
    inputSchema: id,
    execute: (i) => service.inspect(i.run_id),
  });
  register("development.propose", {
    inputSchema: id
      .extend({
        revision: z.number().int().nonnegative(),
        proposal: z.string().trim().min(5).max(2000),
      })
      .strict(),
    execute: (i, c) => service.propose(i.run_id, i.revision, i.proposal, c),
  });
  register("development.plan", {
    inputSchema: planInput,
    execute: (i, c) => service.plan(i, c),
  });
  for (const name of ["development.build", "development.build_protected"])
    register(name, {
      inputSchema: id.extend({ plan_hash: sha }).strict(),
      execute: (i, c) =>
        service.build(i.run_id, i.plan_hash, name.endsWith("_protected"), c),
    });
  register("development.workspace", {
    inputSchema: id.extend({ plan_hash: sha }).strict(),
    execute: (i, c) => service.workspace(i.run_id, i.plan_hash, c),
  });
  register("development.patch", {
    inputSchema: patchInput,
    execute: (i, c) => service.patch(i, c),
  });
  register("development.patch_ready", {
    inputSchema: id,
    execute: (i, c) => service.patchReady(i.run_id, c),
  });
  register("development.implement", {
    inputSchema: id.extend({ patch_hash: sha }).strict(),
    execute: (i, c) => service.implement(i.run_id, i.patch_hash, c),
  });
  register("development.test", {
    inputSchema: id,
    execute: (i, c) => service.test(i.run_id, c),
  });
  register("development.review", {
    inputSchema: id,
    execute: (i, c) => service.review(i.run_id, c),
  });
  register("development.release", {
    inputSchema: id,
    execute: (i, c) => service.release(i.run_id, c),
  });
  register("development.decide", {
    inputSchema: id
      .extend({
        release_hash: sha,
        accept: z.boolean(),
        reason: z.string().trim().min(5).max(1000),
      })
      .strict(),
    execute: (i, c) =>
      service.decide(i.run_id, i.release_hash, i.accept, i.reason, c),
  });
  register("development.finalize", {
    inputSchema: id,
    execute: (i, c) => service.finalize(i.run_id, c),
  });
}
