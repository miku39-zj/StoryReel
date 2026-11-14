import type { StoryProject, VideoNodeData } from "@/lib/story/types";
import { storyEdges } from "@/lib/story/connections";
import { mainVideoNode } from "./shot-workspace";

export function precedingVideos(project: StoryProject, targetId: string) {
  const nodes = new Map(project.nodes.map((node) => [node.id, node]));
  const incoming = new Map<string, typeof project.edges>();
  for (const edge of storyEdges(project.nodes, project.edges)) {
    const sources = incoming.get(edge.target) ?? [];
    sources.push(edge);
    incoming.set(edge.target, sources);
  }
  const visited = new Set([targetId]);
  const queue: Array<{ id: string; choiceEdgeId?: string; choiceLabel?: string }> = [
    { id: targetId },
  ];
  const videos: Array<{
    id: string;
    data: VideoNodeData;
    choiceEdgeId?: string;
    choiceLabel?: string;
  }> = [];
  for (const item of queue) {
    for (const edge of incoming.get(item.id) ?? []) {
      const sourceId = edge.source;
      const choiceEdgeId = item.choiceEdgeId ?? (edge.data?.choiceLabel ? edge.id : undefined);
      const choiceLabel = item.choiceLabel ?? edge.data?.choiceLabel;
      if (visited.has(sourceId)) continue;
      visited.add(sourceId);
      const source = nodes.get(sourceId);
      if (source?.data.nodeType === "video") {
        const shotId = source.data.productionShotId;
        const selected = typeof shotId === "string" ? mainVideoNode(project, shotId) : undefined;
        videos.push({
          id: sourceId,
          data: (selected?.data ?? source.data) as VideoNodeData,
          choiceEdgeId,
          choiceLabel,
        });
      } else if (source) queue.push({ id: sourceId, choiceEdgeId, choiceLabel });
    }
  }
  return videos;
}

export function videoOutpoint(data: VideoNodeData) {
  const segment = data.segments?.at(-1);
  return {
    url: segment?.videoUrl ?? data.videoUrl,
    end: [segment?.duration ?? data.clipEnd, data.interactionAt]
      .filter((value): value is number => typeof value === "number")
      .reduce<number | undefined>(
        (end, value) => (end === undefined ? value : Math.min(end, value)),
        undefined,
      ),
  };
}
