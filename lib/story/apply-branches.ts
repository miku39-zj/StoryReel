import { branchDesignSchema } from "./creation-schema";
import { resolveBranchRoutes } from "./branch-routes";
import type { StoryProject, StoryFlowNode, StoryFlowEdge } from "./types";
import type { StoryOutline } from "@/stores/creation-store";
import { isContextEdge } from "./connections";

/** Rebuild generated routes atomically, preserving scene assets and context inputs. */
export function applyBranchDesign(
  project: StoryProject,
  outline: StoryOutline,
  input: unknown,
): StoryProject {
  const design = branchDesignSchema.parse(input);
  const routes = resolveBranchRoutes(outline.scenes, design);
  const scenes = [...outline.scenes].sort((a, b) => a.order - b.order);
  const decisions = new Map(design.decisionPoints.map((d) => [d.sceneId, d]));
  const endings = new Map(design.endings.map((e) => [e.sceneId, e]));
  const generatedIds = new Set(scenes.flatMap((s) => [`choice_${s.id}`, `ending_${s.id}`]));
  const nodes = project.nodes.filter((n) => !generatedIds.has(n.id));
  const managedVideos = new Set(scenes.map((s) => `video_${s.id}`));
  const edges = project.edges.filter(
    (e) =>
      !generatedIds.has(e.source) &&
      !generatedIds.has(e.target) &&
      (isContextEdge(e, project.nodes) || !managedVideos.has(e.source)),
  );
  const connect = (source: string, target: string, index = 0, label?: string) => {
    edges.push({
      id: `branch_${source}_${index}`,
      source,
      target,
      type: "smoothstep",
      data: { kind: "flow", ...(label ? { choiceLabel: label } : {}) },
    });
  };
  scenes.forEach((scene, i) => {
    const videoId = `video_${scene.id}`;
    let video = nodes.find((n) => n.id === videoId);
    if (!video) {
      video = {
        id: videoId,
        type: "video",
        position: { x: i * 560, y: 0 },
        data: {
          nodeType: "video",
          title: scene.title,
          scenePrompt: scene.scenePrompt,
          generationStatus: "idle",
        },
      };
      nodes.push(video);
    }
    const dp = decisions.get(scene.id),
      ending = endings.get(scene.id);
    if (dp || ending) {
      const id = `${dp ? "choice" : "ending"}_${scene.id}`;
      const old = project.nodes.find((n) => n.id === id);
      nodes.push({
        id,
        type: dp ? "choice" : "ending",
        position: old?.position ?? { x: video.position.x + 280, y: video.position.y },
        data: dp
          ? { nodeType: "choice", question: dp.question }
          : { nodeType: "ending", title: ending!.title, description: ending!.description },
      } as StoryFlowNode);
      connect(videoId, id);
      dp?.choices.forEach((choice, j) =>
        connect(id, `video_${choice.targetSceneId}`, j, choice.label),
      );
    } else if (routes.get(scene.id)?.[0])
      connect(videoId, `video_${routes.get(scene.id)![0].leadsTo}`);
    else throw new Error("最后一个场景必须配置为结局或决策点");
  });
  // Reject any bad references before the caller mutates either store.
  const nodeIds = new Set(nodes.map((n) => n.id));
  if (
    nodes.length !== nodeIds.size ||
    edges.some((e) => !nodeIds.has(e.source) || !nodeIds.has(e.target))
  )
    throw new Error("分支方案无法应用到当前画布");
  return {
    ...project,
    nodes,
    edges: edges as StoryFlowEdge[],
    startNodeId: project.startNodeId ?? `video_${scenes[0]?.id}`,
    updatedAt: new Date().toISOString(),
  };
}
