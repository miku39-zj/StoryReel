import type { StoryProject } from "@/lib/story/types";
import { productionShots } from "./shot-inputs";
import { shotRevision } from "./shots";
import { mainVideoNode } from "@/lib/canvas/shot-workspace";
import { isStale } from "@/lib/canvas/workflow";

/** Main video is the only output of a shot. Candidates never become story routes. */
export function resolveShotOutputs(project: StoryProject): StoryProject {
  if (!project.shotWorkspaces) return project;
  const shots = productionShots(project);
  const candidates = new Set(project.nodes.filter((n) => n.data.canvasShotId).map((n) => n.id));
  return {
    ...project,
    nodes: project.nodes
      .filter((n) => !candidates.has(n.id))
      .map((node) => {
        const shotId = node.data.productionShotId;
        if (
          node.type !== "video" ||
          typeof shotId !== "string" ||
          !project.shotWorkspaces?.[shotId]
        )
          return node;
        const main = mainVideoNode(project, shotId);
        if (main?.id === node.id) {
          const stale = isStale(project, main);
          return {
            ...node,
            data: {
              ...node.data,
              generationFingerprint: undefined,
              ...(stale ? { videoUrl: undefined, segments: undefined } : {}),
            },
          };
        }
        const data = main?.data;
        const shot = shots.find((s) => s.shotId === shotId);
        const current =
          !main?.data.canvasShotId ||
          (!!shot && project.shotWorkspaces?.[shotId]?.sourceRevision === shotRevision(shot));
        return {
          ...node,
          data: {
            ...node.data,
            videoUrl:
              main && current && !isStale(project, main) ? String(data?.videoUrl ?? "") : undefined,
            audioUrl: data?.audioUrl,
            segments: undefined,
            clipEnd: data?.clipEnd,
            duration: data?.duration ?? data?.seedanceDuration,
            generationFingerprint: undefined,
          },
        } as typeof node;
      }),
    edges: project.edges.filter((e) => !candidates.has(e.source) && !candidates.has(e.target)),
  };
}
