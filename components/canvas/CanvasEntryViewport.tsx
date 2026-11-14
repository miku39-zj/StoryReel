"use client";

import { useEffect, useRef } from "react";
import { useNodesInitialized, useReactFlow } from "@xyflow/react";
import { useCanvasStore } from "@/stores/canvas-store";
import { routeWorkspaceGraph } from "@/lib/canvas/route-workspace";
import { useCreationStore } from "@/stores/creation-store";
import { shotWorkspaceGraph } from "@/lib/canvas/shot-workspace";
import { entryFocusNodeIds } from "@/lib/canvas/entry-focus";

/** Apply once per project entry, after node measurement; never follow background job updates. */
export function CanvasEntryViewport() {
  const projectId = useCanvasStore((state) => state.projectId),
    nodes = useCanvasStore((state) => state.nodes),
    edges = useCanvasStore((state) => state.edges);
  const shotId = useCanvasStore((s) => s.activeShotId),
    workspaces = useCanvasStore((s) => s.shotWorkspaces);
  const hasStory = useCreationStore((state) => !!state.storyOutline);
  const initialized = useNodesInitialized(),
    flow = useReactFlow(),
    focused = useRef<string | null>(null);
  useEffect(() => {
    const key = `${projectId}:${shotId ?? "story"}`;
    if (!projectId || focused.current === key || !flow.viewportInitialized) return;
    if (shotId && !workspaces[shotId]?.initialized) return;
    if (nodes.some((node) => !node.hidden) && !initialized) return;
    focused.current = key;
    const project = useCanvasStore.getState().toProject();
    const graph = project && shotId ? shotWorkspaceGraph(project, shotId) : { nodes, edges };
    const saved = shotId ? workspaces[shotId]?.viewport : undefined;
    if (saved) {
      void flow.setViewport(saved, { duration: 0 });
      return;
    }
    const route = hasStory && !shotId ? routeWorkspaceGraph(nodes, edges) : graph;
    const ids = shotId ? graph.nodes.map((n) => n.id) : entryFocusNodeIds(route.nodes, route.edges);
    if (ids.length)
      void flow.fitView({
        nodes: ids.map((id) => ({ id })),
        padding: 0.3,
        maxZoom: 1,
        duration: 0,
      });
    else void flow.setCenter(0, 0, { zoom: 1, duration: 0 });
  }, [projectId, nodes, edges, initialized, flow, shotId, workspaces, hasStory]);
  return null;
}
