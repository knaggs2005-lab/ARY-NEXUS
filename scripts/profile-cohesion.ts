/** Repeatable CPU/bundle measurements; synthetic in-memory records, no provider or database writes. */
import { readFile, stat } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { mapNode, mapEdge, type NexusMap } from "../src/domain/nexus-map";
import {
  projectMap,
  spatialLayout,
} from "../src/components/atlas/map-projection";
import {
  indexCommands,
  rankCommands,
  type Command,
} from "../src/components/commands/command-index";
function measure(work: () => unknown) {
  for (let i = 0; i < 5; i++) work();
  const times: number[] = [];
  for (let i = 0; i < 30; i++) {
    const start = performance.now();
    work();
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  return { median_ms: +times[15].toFixed(3), p95_ms: +times[28].toFixed(3) };
}
async function main() {
  const commands = [100, 1000, 10000].map((count) => {
    const rows: Command[] = Array.from({ length: count }, (_, i) => ({
      id: String(i),
      label: `Project ${i} review`,
      source: "project",
      aliases: [`PR${i}`],
      detail: "Synthetic profiling only",
      destination: { tab: "Entities" },
    }));
    const index = indexCommands(rows);
    return {
      count,
      indexing: measure(() => indexCommands(rows)),
      query: measure(() => rankCommands(index, "project 9")),
    };
  });
  const graph = [180, 1000, 10000].map((count) => {
    const nodes = Array.from({ length: count }, (_, i) =>
      mapNode(
        String(i),
        `Record ${i}`,
        i % 2 ? "person" : "project",
        "Synthetic profile",
        "",
        "Entities",
      ),
    );
    const map: NexusMap = {
      nodes,
      edges: nodes
        .slice(1)
        .map((n, i) => mapEdge(n.id, nodes[i].id, "related", "reference")),
      meta: {
        generatedAt: new Date().toISOString(),
        more: false,
        cursor: null,
        warnings: [],
      },
    };
    const projected = projectMap(
      map,
      new Set(["cluster:kind:person", "cluster:kind:project"]),
      true,
    );
    return {
      count,
      rendered_nodes: projected.nodes.length,
      projection: measure(() =>
        projectMap(
          map,
          new Set(["cluster:kind:person", "cluster:kind:project"]),
          true,
        ),
      ),
      layout: measure(() => spatialLayout(projected)),
    };
  });
  const text = await readFile(
    ".next/server/app/mobile/page_client-reference-manifest.js",
    "utf8",
  );
  const manifest = JSON.parse(
    text.slice(text.indexOf('={"moduleLoading"') + 1, -1),
  );
  const key = Object.keys(manifest.clientModules).find((k) =>
    k.endsWith("/src/components/dashboard.tsx"),
  )!;
  const paths = (manifest.clientModules[key].chunks as string[]).filter(
    (_, i) => i % 2 === 1,
  );
  let raw_bytes = 0,
    gzip_bytes = 0;
  for (const path of paths) {
    const data = await readFile(`.next/${path}`);
    raw_bytes += (await stat(`.next/${path}`)).size;
    gzip_bytes += gzipSync(data).length;
  }
  console.log(
    JSON.stringify(
      {
        environment: {
          node: process.version,
          platform: process.platform,
          arch: process.arch,
        },
        note: "Local CPU samples; not physical-phone, hosted database, network or total route-transfer benchmarks",
        commands,
        graph,
        dashboard_reference_chunks: { raw_bytes, gzip_bytes, paths },
      },
      null,
      2,
    ),
  );
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
