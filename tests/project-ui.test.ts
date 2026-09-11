import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { ProjectChangeReview } from "../src/components/project-change-review";
import { ProjectState } from "../src/components/project-state";
import {
  changedProject,
  type ProjectSnapshot,
} from "../src/domain/project-actions";
import type { Entity } from "../src/domain/models";
const before: ProjectSnapshot = {
  status: "active",
  priority: 2,
  health: "on_track",
  notes: "Unchanged",
  blocker_entity_ids: [],
  goal_ids: [],
};
it("shows changed project fields with before/after and named links", () => {
  const html = renderToStaticMarkup(
    createElement(ProjectChangeReview, {
      before,
      after: changedProject(before, {
        status: "blocked",
        priority: null,
        blocker_entity_ids: ["blocker-id"],
        goal_ids: ["goal-id"],
      }),
      names: { "blocker-id": "Tracking bug", "goal-id": "Reliable release" },
    }),
  );
  for (const text of [
    "active",
    "blocked",
    "High",
    "Not set",
    "Tracking bug",
    "Reliable release",
  ])
    expect(html).toContain(text);
  expect(html).not.toContain("Unchanged");
  expect(html.match(/changes to/g)).toHaveLength(4);
});
it("shows unconfirmed values and no invented task progress in the project card", () => {
  const project: Entity = {
    id: "p",
    user_id: "u",
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
    name: "Wag Trails",
    description: "",
    entity_type: "project",
    metadata: {},
  };
  const html = renderToStaticMarkup(
    createElement(ProjectState, {
      project,
      entities: [project],
      edges: [],
      goals: [],
      tasks: [],
      onUpdated: async () => {},
      onGraph: () => {},
    }),
  );
  expect(html).toContain("not set");
  expect(html).toContain("No linked tasks yet.");
  expect(html).toContain('data-tone="neutral"');
  expect(html).not.toContain("100%");
});
