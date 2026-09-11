import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { TaskChangeReview } from "../src/components/task-change-review";
import { changedTask, type TaskSnapshot } from "../src/domain/task-actions";
it("shows only modified fields with explicit before/after values and clear date removal", () => {
  const before: TaskSnapshot = {
    title: "Preserved title",
    description: "",
    status: "pending",
    priority: 2,
    due_at: "2026-09-08T23:59:59Z",
    entity_id: null,
    related_entity_ids: [],
  };
  const html = renderToStaticMarkup(
    createElement(TaskChangeReview, {
      before,
      after: changedTask(before, {
        status: "completed",
        priority: 3,
        due_date: null,
      }),
    }),
  );
  for (const label of [
    "pending",
    "completed",
    "High",
    "Urgent",
    "2026-09-08",
    "None",
  ])
    expect(html).toContain(label);
  expect(html).not.toContain("Preserved title");
  expect(html.match(/changes to/g)).toHaveLength(3);
});
