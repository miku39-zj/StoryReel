import type { StoryProject } from "@/lib/story/types";
import { mainVideoNode } from "@/lib/canvas/shot-workspace";
import { fingerprint } from "@/lib/canvas/workflow";
import { productionShots } from "./shot-inputs";
import { shotRevision, imageRevision, videoRevision, audioRevision } from "./shots";
import { selectedAsset, type AssetVersion, type ProductionState } from "./types";

function matchesShotAsset(shot: ReturnType<typeof productionShots>[number], asset: AssetVersion) {
  const revision =
    asset.kind === "image"
      ? imageRevision(shot)
      : asset.kind === "video"
        ? videoRevision(shot)
        : audioRevision(shot);
  return asset.sourceRevision === revision || asset.sourceRevision === shotRevision(shot);
}

/** Explicit version choices may replace the output; background completion only fills empty videos. */
export function applyShotAsset(project: StoryProject, asset: AssetVersion): StoryProject {
  const node =
    asset.kind === "image"
      ? project.nodes.find((n) => n.id === `shot_frame:${asset.shotId}`)
      : mainVideoNode(project, asset.shotId);
  if (!node) return project;
  const field =
    asset.kind === "image" ? "imageUrl" : asset.kind === "audio" ? "audioUrl" : "videoUrl";
  if (node.data[field] === asset.url && node.data[`production${asset.kind}AssetId`] === asset.id)
    return project;
  const shot = productionShots(project).find((s) => s.shotId === asset.shotId);
  const current = !!shot && matchesShotAsset(shot, asset);
  const patched: typeof node = {
    ...node,
    data: {
      ...node.data,
      [field]: asset.url,
      [`production${asset.kind}AssetId`]: asset.id,
      generationStatus: "done" as const,
      generationError: undefined,
      ...(asset.kind === "video" ? { segments: undefined, clipEnd: undefined } : {}),
    },
  };
  const workspace = project.shotWorkspaces?.[asset.shotId];
  const result = {
    ...project,
    nodes: project.nodes.map((n) => (n.id === node.id ? patched : n)),
    ...(asset.kind === "video" && workspace
      ? {
          shotWorkspaces: {
            ...project.shotWorkspaces,
            [asset.shotId]: { ...workspace, sourceRevision: asset.sourceRevision },
          },
        }
      : {}),
  };
  if (asset.kind !== "audio")
    patched.data.generationFingerprint = current
      ? fingerprint(result, node.id)
      : "outdated-storyboard";
  return result;
}
export function fillShotCanvasResults(project: StoryProject, state: ProductionState): StoryProject {
  if (project.id !== state.projectId) return project;
  let result = project;
  for (const shot of productionShots(project)) {
    if (!project.shotWorkspaces?.[shot.shotId]?.initialized) continue;
    for (const kind of ["image", "video", "audio"] as const) {
      const asset = selectedAsset(state, shot.shotId, kind);
      if (!asset || !matchesShotAsset(shot, asset)) continue;
      const node =
        kind === "image"
          ? result.nodes.find((n) => n.id === `shot_frame:${shot.shotId}`)
          : mainVideoNode(result, shot.shotId);
      if (!node) continue;
      if (kind === "image") {
        // Canvas-generated or manually selected media keeps its own selection authority.
        if (node.data.generationJobId) continue;
      } else if (
        node.data.productionShotId !== shot.shotId ||
        node.data[kind === "video" ? "videoUrl" : "audioUrl"]
      )
        continue;
      result = applyShotAsset(result, asset);
    }
  }
  return result;
}
