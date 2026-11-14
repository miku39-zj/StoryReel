import { isContextEdge } from "@/lib/story/connections";
import type { StoryFlowEdge, StoryFlowNode } from "@/lib/story/types";

/** Keep playback edges in the route view and collapse generated shot chains into their scene. */
export function routeWorkspaceGraph(nodes: StoryFlowNode[], edges: StoryFlowEdge[]) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const flow = edges.filter((edge) => {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    return source && target && !isContextEdge(edge, [source, target]);
  });
  const external = new Set(
    flow.filter((edge) => !edge.id.startsWith("shot_input:")).map((edge) => edge.target),
  );
  const exits = new Set(
    flow.filter((edge) => !edge.id.startsWith("shot_input:")).map((edge) => edge.source),
  );
  const collapsed = new Map<string, string>();
  const tails = new Map<string, string>();
  for (const edge of flow) {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    if (
      edge.id.startsWith("shot_input:") &&
      source?.data.shotSceneId &&
      source.data.shotSceneId === target?.data.shotSceneId &&
      !external.has(edge.target) &&
      !exits.has(edge.source)
    ) {
      collapsed.set(edge.target, edge.source);
    }
  }
  const head = (id: string) => {
    const seen = new Set<string>();
    while (collapsed.has(id) && !seen.has(id)) {
      seen.add(id);
      id = collapsed.get(id)!;
    }
    return id;
  };
  const internalSources = new Set(collapsed.values());
  for (const id of collapsed.keys()) {
    if (!internalSources.has(id)) tails.set(head(id), id);
  }
  return {
    nodes: nodes.filter(
      (node) =>
        node.type !== "image" &&
        node.type !== "text" &&
        !node.data.canvasShotId &&
        !collapsed.has(node.id),
    ),
    edges: flow
      .filter(
        (edge) =>
          !(edge.id.startsWith("shot_input:") && collapsed.get(edge.target) === edge.source),
      )
      .map((edge) => ({ ...edge, source: head(edge.source) }))
      .filter((edge) => {
        const visible = (id: string) => {
          const node = byId.get(id);
          return (
            node &&
            !node.data.canvasShotId &&
            node.type !== "text" &&
            node.type !== "image" &&
            !collapsed.has(id)
          );
        };
        return visible(edge.source) && visible(edge.target);
      }),
    tails,
  };
}
