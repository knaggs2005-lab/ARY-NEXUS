"use client";
import { memo, useMemo, useEffect } from "react";
import {
  useReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { AgentView } from "../../domain/agent";
import type { ClientEvent } from "../events/event-store";
import styles from "./agents.module.css";
type WorkerNode = Node<
  { label: string; status: string; detail: string; active: boolean },
  "worker"
>;
const Worker = memo(function Worker({ data, selected }: NodeProps<WorkerNode>) {
  return (
    <div
      className={styles.worker}
      data-selected={selected}
      data-active={data.active}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <span>{data.status.replaceAll("_", " ")}</span>
      <strong>{data.label}</strong>
      <small>{data.detail}</small>
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  );
});
const nodeTypes = { worker: Worker };
function FrameWorkers({
  nodes,
  reduced,
}: {
  nodes: WorkerNode[];
  reduced: boolean;
}) {
  const { fitBounds, viewportInitialized } = useReactFlow();
  const x = Math.min(...nodes.map((n) => n.position.x));
  const y = Math.min(...nodes.map((n) => n.position.y));
  const width = Math.max(...nodes.map((n) => n.position.x + 230)) - x;
  const height = Math.max(...nodes.map((n) => n.position.y + 140)) - y;
  useEffect(() => {
    if (!viewportInitialized) return;
    const frame = () => {
      void fitBounds(
        { x, y, width, height },
        { padding: 0.2, duration: reduced ? 0 : 320 },
      );
    };
    frame();
    window.addEventListener("resize", frame);
    return () => window.removeEventListener("resize", frame);
  }, [x, y, width, height, viewportInitialized, reduced, fitBounds]);
  return null;
}
export default function AgentFamilyGraph({
  agents,
  selected,
  select,
  events,
  now,
  reduced,
  stale,
}: {
  agents: AgentView[];
  selected: string;
  select: (id: string) => void;
  events: ClientEvent[];
  now: number;
  reduced: boolean;
  stale: boolean;
}) {
  const graph = useMemo(() => {
    const shown = agents.slice(0, 64),
      byId = new Map(agents.map((v) => [v.agent.id, v.agent]));
    const depths = new Map<string, number>();
    for (const { agent } of shown) {
      let parent = agent.parent_id,
        depth = 1;
      for (let n = 0; parent && n < 3; n++) {
        depth++;
        parent = byId.get(parent)?.parent_id ?? null;
      }
      depths.set(agent.id, depth);
    }
    const columns = new Map<number, string[]>();
    for (const { agent } of shown) {
      const depth = depths.get(agent.id)!;
      const list = columns.get(depth) ?? [];
      list.push(agent.id);
      columns.set(depth, list);
    }
    const nodes: WorkerNode[] = [
      {
        id: "ary",
        type: "worker",
        position: { x: 0, y: 0 },
        data: {
          label: "ARY",
          status: "PRIMARY ORCHESTRATOR",
          detail: "One brain · shared central memory",
          active: false,
        },
      },
    ];
    for (const { agent, status } of shown) {
      const depth = depths.get(agent.id)!,
        column = columns.get(depth)!;
      nodes.push({
        id: agent.id,
        type: "worker",
        position: {
          x: depth * 300,
          y: (column.indexOf(agent.id) - (column.length - 1) / 2) * 160,
        },
        selected: selected === agent.id,
        ariaLabel: `${agent.name}: ${status}`,
        data: {
          label: agent.name,
          status,
          detail: `${agent.specialization} · ${agent.lifetime}`,
          active: status === "RUNNING" && !stale && !reduced,
        },
      });
    }
    const ids = new Set(nodes.map((n) => n.id));
    const edges = shown
      .filter((v) => !v.agent.parent_id || ids.has(v.agent.parent_id))
      .map(({ agent }) => ({
        id: `delegation:${agent.id}`,
        source: agent.parent_id ?? "ary",
        target: agent.id,
        animated:
          !reduced &&
          !stale &&
          (now - Date.parse(agent.created_at) < 8000 ||
            events.some(
              (e) =>
                e.source.kind !== "client" &&
                e.payload.agent_id === agent.id &&
                ["agent.delegated", "agent.child_created"].includes(e.type) &&
                now - Date.parse(e.timestamp) >= 0 &&
                now - Date.parse(e.timestamp) < 8000,
            )),
        style: { stroke: "#a9bfd5", strokeWidth: 1.4 },
      }));
    return { nodes, edges };
  }, [agents, events, now, reduced, selected, stale]);
  return (
    <div className={styles.graph} aria-label="Agent delegation graph">
      <ReactFlow<WorkerNode>
        {...graph}
        nodeTypes={nodeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        edgesReconnectable={false}
        deleteKeyCode={null}
        onNodeClick={(_, node) => {
          if (node.id !== "ary") select(node.id);
        }}
        fitView
        fitViewOptions={{ maxZoom: 1, padding: 0.2 }}
        minZoom={0.15}
        maxZoom={1.5}
        colorMode="dark"
        preventScrolling={false}
      >
        <FrameWorkers nodes={graph.nodes} reduced={reduced} />
        <Background gap={30} color="#4d5f73" size={0.6} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
