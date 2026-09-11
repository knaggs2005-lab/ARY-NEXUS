"use client";
import { memo, useCallback, useMemo, useState } from "react";
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type {
  MissionGraphNode,
  missionGraph,
} from "../../domain/mission-control";
import styles from "./mission-control.module.css";

type GraphNode = Node<MissionGraphNode & Record<string, unknown>, "mission">;
const glyphs = {
  agent: "◈",
  tool: "⌘",
  decision: "◇",
  approval: "◎",
  wait: "◷",
  output: "↗",
};
const ExecutionNode = memo(function ExecutionNode({
  data,
  selected,
}: NodeProps<GraphNode>) {
  return (
    <div
      className={styles.node}
      data-state={data.status}
      data-active={data.active}
      data-selected={selected}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <span className={styles.nodeKind}>
        <span aria-hidden="true">{glyphs[data.kind]}</span> {data.kind}
      </span>
      <strong>{data.title}</strong>
      <small>{data.subtitle}</small>
      <span className={styles.nodeState}>
        {data.status.replaceAll("_", " ")}
      </span>
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  );
});
const nodeTypes = { mission: ExecutionNode };
const fitOptions = { padding: 0.18, maxZoom: 1 };
export default function MissionExecutionGraph({
  graph,
  selected,
  onSelect,
  reducedMotion,
  stale,
}: {
  graph: ReturnType<typeof missionGraph>;
  selected: string;
  onSelect: (id: string) => void;
  reducedMotion: boolean;
  stale: boolean;
}) {
  const [flow, setFlow] = useState<ReactFlowInstance<GraphNode> | null>(null);
  const nodes = useMemo(
    () =>
      graph.nodes.map((n) => ({
        id: n.id,
        type: "mission" as const,
        position: n.position,
        data: { ...n, active: n.active && !stale && !reducedMotion },
        selected: selected === n.id,
        ariaLabel: `${n.kind}: ${n.title}, ${n.status.replaceAll("_", " ")}`,
        ariaRole: "button" as const,
      })),
    [graph, selected, stale, reducedMotion],
  );
  const edges = useMemo(
    () =>
      graph.edges.map((e) => ({
        ...e,
        type: "smoothstep",
        animated: e.active && !stale && !reducedMotion,
        style: {
          stroke: e.active && !stale ? "#bed7df" : "#566277",
          strokeWidth: e.active ? 2 : 1,
        },
      })),
    [graph, reducedMotion, stale],
  );
  const choose = useCallback(
    (_: unknown, node: GraphNode) => onSelect(node.id),
    [onSelect],
  );
  const focus = () => {
    const id =
      selected || graph.nodes.find((n) => n.active)?.id || graph.nodes[0]?.id;
    if (id)
      void flow?.fitView({
        nodes: [{ id }],
        duration: reducedMotion ? 0 : 320,
        maxZoom: 1.1,
        padding: 0.45,
      });
  };
  return (
    <div
      className={styles.canvas}
      aria-label="Mission execution graph"
      data-reduced-motion={reducedMotion}
    >
      <div className={styles.canvasTools}>
        <span>EXECUTION MAP</span>
        <button onClick={focus}>Focus selection</button>
      </div>
      <ReactFlow<GraphNode>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onInit={setFlow}
        onNodeClick={choose}
        nodesDraggable={false}
        nodesConnectable={false}
        edgesReconnectable={false}
        deleteKeyCode={null}
        fitView
        fitViewOptions={fitOptions}
        minZoom={0.12}
        maxZoom={1.8}
        colorMode="dark"
        onlyRenderVisibleElements
        preventScrolling={false}
        aria-label="Mission dependency map"
      >
        <Background color="#546070" gap={28} size={0.7} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
