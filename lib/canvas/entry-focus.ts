import type { StoryFlowNode, StoryFlowEdge } from "@/lib/story/types";
import { isContextEdge } from "@/lib/story/connections";

/** Choose from saved result history, so entry focus works before task polling starts. */
export function entryFocusNodeIds(nodes: StoryFlowNode[], edges: StoryFlowEdge[]): string[] {
  const visible = nodes.filter((node) => !node.hidden);
  let latest: StoryFlowNode | undefined,
    completedAt = -Infinity;
  for (const node of visible) {
    if (!["image", "video"].includes(node.type!) || !(node.data.imageUrl || node.data.videoUrl))
      continue;
    const versions = node.data.generationVersions;
    if (!Array.isArray(versions)) continue;
    for (const version of versions) {
      if (!version || typeof version.createdAt !== "string" || typeof version.url !== "string")
        continue;
      const timestamp = Date.parse(version.createdAt);
      if (Number.isFinite(timestamp) && timestamp > completedAt) {
        latest = node;
        completedAt = timestamp;
      }
    }
  }
  if (!latest) return visible.map((node) => node.id);
  const ids = new Set([latest.id]),
    queue = [latest.id],
    visibleIds = new Set(visible.map((node) => node.id));
  for (let i = 0; i < queue.length; i++)
    for (const edge of edges) {
      if (
        edge.target !== queue[i] ||
        !visibleIds.has(edge.source) ||
        ids.has(edge.source) ||
        !isContextEdge(edge, nodes)
      )
        continue;
      ids.add(edge.source);
      queue.push(edge.source);
    }
  return [...ids];
}
