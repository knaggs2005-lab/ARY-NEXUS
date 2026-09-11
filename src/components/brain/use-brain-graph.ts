"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BrainGraph, BrainNode } from "@/domain/brain-graph";
import { api } from "../api";
import { mergeGraph, MAX_NODES } from "./graph-engine";
export function useBrainGraph(
  sample: boolean,
  type: string,
  temporal: string,
  scope: string,
) {
  const [reload, setReload] = useState(0);
  const [graph, setGraph] = useState<BrainGraph | null>(null);
  const [catalog, setCatalog] = useState<BrainNode[]>([]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [history, setHistory] = useState<
    { graph: BrainGraph; next: string | null }[]
  >([]);
  const [next, setNext] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const generation = useRef(0);
  useEffect(() => () => request.current?.abort(), []);
  const endpoint = sample ? "brain-graph/sample" : "brain-graph";
  const params = useMemo(() => {
    const p = new URLSearchParams({
      limit: "80",
      edge_limit: "400",
      relationships: temporal,
    });
    if (type) p.set("types", type);
    if (scope) {
      const [kind, id] = scope.split(":");
      p.set(`${kind}_id`, id);
    }
    return p.toString();
  }, [type, temporal, scope]);
  const fetchGraph = useCallback(
    async (extra: Record<string, string>, signal?: AbortSignal) => {
      const query = new URLSearchParams(params);
      for (const [k, v] of Object.entries(extra)) query.set(k, v);
      return (await (
        await api(`${endpoint}?${query}`, { signal })
      ).json()) as BrainGraph;
    },
    [endpoint, params],
  );
  useEffect(() => {
    const controller = new AbortController();
    request.current?.abort();
    request.current = controller;
    generation.current++;
    setBusy(true);
    setError("");
    setGraph(null);
    setHistory([]);
    setNext(null);
    void fetchGraph({}, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setGraph(result);
        setNext(result.meta.nextCursor);
        setCatalog((old) => {
          const map = new Map(old.map((n) => [n.id, n]));
          for (const n of result.nodes) map.set(n.id, n);
          return [...map.values()].slice(-240);
        });
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setError(
            e instanceof Error ? e.message : "Could not open your graph",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [fetchGraph, reload]);
  useEffect(() => {
    setCatalog([]);
  }, [sample]);
  const extend = async (root?: string, replace = false) => {
    if (busy || !graph) return false;
    if (!replace && graph.nodes.length >= MAX_NODES) {
      setError(
        "This view has reached 240 entities. Focus on a neighborhood or reset the view to explore further.",
      );
      return false;
    }
    const controller = new AbortController();
    request.current?.abort();
    request.current = controller;
    const version = generation.current;
    setBusy(true);
    setError("");
    try {
      const incoming = await fetchGraph(
        root ? { root, depth: "1" } : next ? { after: next } : {},
        controller.signal,
      );
      if (controller.signal.aborted || version !== generation.current)
        return false;
      if (root && !incoming.nodes.some((n) => n.id === root)) {
        setError(
          "This entity is outside the current scope. Clear the scope filter to explore it.",
        );
        return false;
      }
      setHistory((old) => [...old, { graph, next }].slice(-6));
      setGraph(replace ? incoming : mergeGraph(graph, incoming));
      if (!root) setNext(incoming.meta.nextCursor);
      else if (replace) setNext(null);
      return true;
    } catch (e) {
      if (!controller.signal.aborted)
        setError(
          e instanceof Error ? e.message : "Could not expand this neighborhood",
        );
      return false;
    } finally {
      if (version === generation.current && !controller.signal.aborted)
        setBusy(false);
    }
  };
  return {
    graph,
    catalog,
    busy,
    error,
    next,
    fetchGraph,
    expand: (id: string) => extend(id),
    focus: (id: string) => extend(id, true),
    more: () => extend(),
    canCollapse: history.length > 0,
    collapse: () => {
      const prior = history.at(-1);
      if (prior) {
        setGraph(prior.graph);
        setHistory((h) => h.slice(0, -1));
        setNext(prior.next);
      }
    },
    retry: () => setReload((n) => n + 1),
    clearError: () => setError(""),
  };
}
