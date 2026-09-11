"use client";
import { useState } from "react";
import type { Graph } from "@/domain/models";
export function EntityGraph({ graph }: { graph: Graph }) {
  const [selected, setSelected] = useState<string | null>(null);
  const positions = new Map(
    graph.nodes.map((node, i) => [
      node.id,
      {
        x:
          350 +
          230 *
            Math.cos(
              (i * 2 * Math.PI) / Math.max(1, graph.nodes.length) - Math.PI / 2,
            ),
        y:
          240 +
          155 *
            Math.sin(
              (i * 2 * Math.PI) / Math.max(1, graph.nodes.length) - Math.PI / 2,
            ),
      },
    ]),
  );
  const node = graph.nodes.find((n) => n.id === selected);
  return (
    <div className="graph-layout">
      <div className="graph-canvas">
        <svg
          viewBox="0 0 700 480"
          role="group"
          aria-label="Entity relationship graph. Select a node to inspect its connections."
        >
          <defs>
            <marker
              id="arrow"
              viewBox="0 0 10 10"
              refX="25"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#758d88" />
            </marker>
          </defs>
          {graph.edges.map((edge) => {
            const a = positions.get(edge.source_entity_id),
              b = positions.get(edge.target_entity_id);
            if (!a || !b) return null;
            return (
              <g key={edge.id}>
                <line
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke="#91aaa0"
                  strokeWidth={1 + edge.strength * 2}
                  markerEnd="url(#arrow)"
                />
                <text
                  x={(a.x + b.x) / 2}
                  y={(a.y + b.y) / 2 - 10}
                  textAnchor="middle"
                  className="edge-label"
                >
                  {edge.relationship_type}
                </text>
              </g>
            );
          })}
          {graph.nodes.map((entity) => {
            const p = positions.get(entity.id)!;
            return (
              <g
                key={entity.id}
                role="button"
                tabIndex={0}
                aria-label={`Inspect ${entity.name}`}
                aria-pressed={selected === entity.id}
                onClick={() => setSelected(entity.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSelected(entity.id);
                  }
                }}
                className="graph-node"
              >
                <rect
                  x={p.x - 90}
                  y={p.y - 34}
                  width={180}
                  height={115}
                  fill="transparent"
                />
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={selected === entity.id ? 31 : 26}
                  fill={
                    entity.entity_type === "company" ? "#e7b26d" : "#317568"
                  }
                />
                <text
                  x={p.x}
                  y={p.y + 5}
                  textAnchor="middle"
                  fill="white"
                  fontSize="14"
                >
                  {entity.name
                    .split(" ")
                    .map((w) => w[0])
                    .join("")
                    .slice(0, 2)}
                </text>
                <text
                  x={p.x}
                  y={p.y + 53}
                  textAnchor="middle"
                  className="node-label"
                >
                  {entity.name}
                </text>
                <text
                  x={p.x}
                  y={p.y + 72}
                  textAnchor="middle"
                  className="edge-label"
                >
                  {entity.entity_type}
                </text>
              </g>
            );
          })}
        </svg>
        {!graph.nodes.length && (
          <p className="empty">Add seed data to populate the graph.</p>
        )}
      </div>
      <aside className="graph-inspector">
        <span className="eyebrow">NODE INSPECTOR</span>
        {node ? (
          <>
            <h3>{node.name}</h3>
            <span className="tag">{node.entity_type}</span>
            <p>{node.description}</p>
            {graph.edges
              .filter(
                (e) =>
                  e.source_entity_id === node.id ||
                  e.target_entity_id === node.id,
              )
              .map((e) => (
                <p key={e.id} className="connection">
                  {graph.nodes.find((n) => n.id === e.source_entity_id)?.name} →{" "}
                  <strong>{e.relationship_type}</strong> →{" "}
                  {graph.nodes.find((n) => n.id === e.target_entity_id)?.name}
                </p>
              ))}
          </>
        ) : (
          <p>Select a node to explore its context and relationships.</p>
        )}
      </aside>
    </div>
  );
}
