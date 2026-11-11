import type { StoryFlowNode, StoryFlowEdge, VideoNodeData } from "./types";
/** Expand scene-owned shots only for playback; authoring graph IDs and choices stay intact. */
export function expandShotSequences(nodes: StoryFlowNode[], edges: StoryFlowEdge[]) {
  const expanded: StoryFlowNode[] = [],
    links: StoryFlowEdge[] = [];
  const exits = new Map<string, string>();
  for (const node of nodes) {
    const data = node.data as VideoNodeData;
    if (data.nodeType !== "video" || !data.segments?.length) {
      expanded.push(node);
      continue;
    }
    let elapsed = 0,
      previous: string | null = null;
    for (const [index, segment] of data.segments.entries()) {
      const id = index === 0 ? node.id : `${node.id}__${segment.shotId}`;
      const interactionAt =
        data.interactionAt !== undefined &&
        data.interactionAt >= elapsed &&
        data.interactionAt < elapsed + segment.duration
          ? data.interactionAt - elapsed
          : undefined;
      expanded.push({
        ...node,
        id,
        data: {
          ...data,
          segments: undefined,
          videoUrl: segment.videoUrl,
          audioUrl: segment.audioUrl,
          clipEnd: segment.duration,
          duration: segment.duration,
          interactionAt,
        },
      });
      if (previous)
        links.push({
          id: `shot_sequence_${id}`,
          source: previous,
          target: id,
          data: { kind: "flow" },
        });
      previous = id;
      elapsed += segment.duration;
      if (interactionAt !== undefined) break;
    }
    exits.set(node.id, previous!);
  }
  for (const edge of edges) links.push({ ...edge, source: exits.get(edge.source) ?? edge.source });
  return { nodes: expanded, edges: links };
}
