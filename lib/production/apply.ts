import { fingerprint } from "@/lib/canvas/workflow";
import { productionShots } from "./shot-inputs";
import { matchesSource } from "@/lib/generation/results";
import type { StoryProject, StoryFlowNode } from "@/lib/story/types";
import { shotRevision, videoRevision, audioRevision } from "./shots";
import { selectedAsset, type ProductionState } from "./types";
export interface ShotSegment {
  shotId: string;
  videoVersionId: string;
  audioVersionId?: string;
  videoUrl: string;
  audioUrl?: string;
  duration: number;
  sourceRevision?: string;
}
export function applyProduction(project: StoryProject, state: ProductionState): StoryProject {
  if (project.id !== state.projectId) throw new Error("素材属于其他项目，请重新加载当前项目素材");
  const shots = productionShots(project);
  if (!shots.length) throw new Error("请先生成分镜");
  const scenes = new Map<string, ShotSegment[]>();
  for (const shot of [...shots].sort((a, b) => a.shotIndex - b.shotIndex)) {
    const video = selectedAsset(state, shot.shotId, "video"),
      audio = selectedAsset(state, shot.shotId, "audio");
    // Accept assets stored with either the new per-artifact revision or the legacy monolithic one.
    const vidRev = videoRevision(shot);
    const audRev = audioRevision(shot);
    const legacyRev = shotRevision(shot);
    if (!video || (!matchesSource(video, vidRev) && !matchesSource(video, legacyRev)))
      throw new Error(`镜头 ${shot.shotIndex + 1} 缺少与当前分镜一致的视频版本`);
    if (shot.dialogue?.trim() && (!audio || (!matchesSource(audio, audRev) && !matchesSource(audio, legacyRev))))
      throw new Error(`镜头 ${shot.shotIndex + 1} 缺少与当前对白一致的配音版本`);
    const segment: ShotSegment = {
      shotId: shot.shotId,
      videoVersionId: video.id,
      audioVersionId: shot.dialogue?.trim() ? audio?.id : undefined,
      videoUrl: video.url,
      audioUrl: shot.dialogue?.trim() ? audio?.url : undefined,
      duration: shot.duration,
      sourceRevision: vidRev,
    };
    scenes.set(shot.sceneId, [...(scenes.get(shot.sceneId) ?? []), segment]);
  }
  for (const id of scenes.keys())
    if (!project.nodes.some((n) => n.id === `video_${id}` && n.data.nodeType === "video"))
      throw new Error(`场景 ${id} 没有对应剧情视频节点，请先应用故事到画布`);
  const nodes = project.nodes.map((node) => {
    if (node.data.nodeType !== "video") return node;
    const canonical = node.data.productionShotId;
    const selectedShot = Object.entries(project.shotWorkspaces ?? {}).find(
      ([, workspace]) => workspace.mainVideoNodeId === node.id,
    )?.[0];
    const shotId = selectedShot ?? canonical;
    if (
      typeof canonical === "string" &&
      project.shotWorkspaces?.[canonical] &&
      project.shotWorkspaces[canonical].mainVideoNodeId !== node.id
    )
      return node;
    if (typeof shotId === "string") {
      const segment = [...scenes.values()].flat().find((s) => s.shotId === shotId);
      if (!segment) return node;
      return {
        ...node,
        data: {
          ...node.data,
          segments: undefined,
          videoUrl: segment.videoUrl,
          audioUrl: segment.audioUrl,
          duration: segment.duration,
          clipEnd: segment.duration,
          generationStatus: "done",
        },
      } as StoryFlowNode;
    }
    const entry = [...scenes].find(([id]) => node.id === `video_${id}`);
    if (!entry) return node;
    const segments = entry[1];
    return {
      ...node,
      data: {
        ...node.data,
        segments,
        videoUrl: segments[0].videoUrl,
        duration: segments.reduce((sum, s) => sum + s.duration, 0),
        generationStatus: "done",
      },
    } as StoryFlowNode;
  });
  const result = { ...project, nodes };
  for (const node of nodes)
    if (
      node.type === "video" &&
      (typeof node.data.productionShotId === "string" ||
        Object.values(project.shotWorkspaces ?? {}).some((w) => w.mainVideoNodeId === node.id))
    )
      node.data.generationFingerprint = fingerprint(result, node.id);
  return result;
}
