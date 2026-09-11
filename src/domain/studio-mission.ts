import { planSpec } from "./orchestration";

/** Ordinary MissionEngine spec: no second planner/executor and no implied scene approval. */
export function studioMissionSpec(scene: string) {
  return planSpec.parse({
    title: `Prepare ${scene} and verify readiness`,
    questions: [],
    steps: [
      {
        id: "inspect",
        title: "Check equipment and prepare exact scene",
        tool: "studio.plan_scene",
        input: { scene },
        depends_on: [],
        critical: true,
        missing: [],
        source_action_from: null,
        verification: null,
      },
      {
        id: "prepare",
        title: "Approve equipment settings, apply and verify readiness",
        tool: "studio.execute_scene",
        input: {
          plan_action_id: { $from: "inspect", path: ["action_id"] },
          plan: { $from: "inspect", path: ["result", "plan"] },
        },
        depends_on: ["inspect"],
        critical: true,
        missing: [],
        source_action_from: "inspect",
        verification: {
          tool: "studio.inspect",
          input: { scene },
          path: ["readiness", "status"],
          equals: "ready",
          description:
            "Fresh provider read-back matches all required scene targets; unresolved state blocks readiness",
        },
      },
    ],
  });
}
