import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import {
  TaskProgress,
  TaskReceipt,
  type TaskPhase,
} from "../src/components/task-experience";

it.each(["checking", "approving", "executing"] as TaskPhase[])(
  "announces %s as busy without announcing a saved task",
  (phase) => {
    const html = renderToStaticMarkup(createElement(TaskProgress, { phase }));
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('role="status"');
    expect(html).not.toContain("Task saved");
    expect(html.match(/aria-current="step"/g)).toHaveLength(1);
  },
);
it.each(["rejected", "error"] as TaskPhase[])(
  "does not mark execution or success complete after %s",
  (phase) => {
    const html = renderToStaticMarkup(createElement(TaskProgress, { phase }));
    expect(html).toContain('aria-busy="false"');
    expect(html).not.toContain('data-reached="true"');
    expect(html).not.toContain("Task saved");
  },
);
it("connects a saved task to its actual execution and clearly labels replay", () => {
  const html = renderToStaticMarkup(
    createElement(TaskReceipt, {
      title: "Fix <tracking>",
      project: "Wag Trails",
      taskId: "saved-task-id",
      actionId: "committed-action-id",
      replay: true,
    }),
  );
  expect(html).toContain("Existing task returned");
  expect(html).toContain("saved-task-id");
  expect(html).toContain("committed-action-id");
  expect(html).toContain("Fix &lt;tracking&gt;");
});

it("renders task updates with an update label, never a creation claim", () => {
  const html = renderToStaticMarkup(
    createElement(TaskProgress, { phase: "executing", operation: "update" }),
  );
  expect(html).toContain("Updating your task");
  expect(html).not.toContain("Creating your task");
  expect(html).toContain("Task update progress");
});
