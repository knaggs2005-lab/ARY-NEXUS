import { missionFixture } from "./lib/mission-fixture";
async function main() {
  const [file, user, id, mode] = process.argv.slice(2);
  if (!file || !user || !id || !["crash-after-task", "recover"].includes(mode))
    throw Error("Isolated fixture arguments required");
  const { repo, engine } = missionFixture(file, user);
  if (mode === "crash-after-task") {
    const original = repo.checkpointMission.bind(repo);
    repo.checkpointMission = async (...args) => {
      if (Object.values(args[3].states).some((s) => s.action_id && s.result))
        process.exit(77);
      return original(...args);
    };
  }
  console.log(JSON.stringify(await engine.tick(id)));
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
