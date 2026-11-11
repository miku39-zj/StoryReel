import { mainVideoNode } from "@/lib/canvas/shot-workspace";
import { productionShots } from "./shot-inputs";
import { generationInput, isStale } from "@/lib/canvas/workflow";
import type { StoryProject } from "@/lib/story/types";
import { shotRevision, imageRevision, videoRevision, audioRevision } from "./shots";
import { selectedAsset, type AssetKind, type ProductionState } from "./types";

function revisionFor(shot: ReturnType<typeof productionShots>[number], kind: AssetKind): string {
  if (kind === "image") return imageRevision(shot);
  if (kind === "video") return videoRevision(shot);
  if (kind === "audio") return audioRevision(shot);
  return shotRevision(shot);
}

/** Accept either new per-artifact revision or legacy monolithic revision. */
function matchesAnyRevision(
  sourceRevision: string,
  shot: ReturnType<typeof productionShots>[number],
  kind: AssetKind,
) {
  return sourceRevision === revisionFor(shot, kind) || sourceRevision === shotRevision(shot);
}

/** Associate approved canvas media with unambiguous shots, without submitting generation. */
export function reconcileCanvasAssets(project: StoryProject, state: ProductionState) {
  if (project.id !== state.projectId) throw new Error("素材属于其他项目");
  const shots = productionShots(project);
  for (const shot of shots) {
    const frame = project.nodes.find(
      (n) => n.id === `shot_frame:${shot.shotId}` && n.data.nodeType === "image",
    );
    if (
      frame?.data.generationJobId &&
      frame.data.prompt === shot.imagePrompt &&
      !isStale(project, frame) &&
      JSON.stringify(generationInput(project, frame.id).referenceImageUrls ?? []) ===
        JSON.stringify(shot.referenceImages?.map((image) => image.url) ?? [])
    ) {
      registerCanvasAsset(project, state, shot, "image", frame.data.imageUrl as string | undefined);
    }
    const node =
      mainVideoNode(project, shot.shotId) ??
      (!project.shotWorkspaces?.[shot.shotId]
        ? (project.nodes.find(
            (n) => n.data.productionShotId === shot.shotId && n.data.nodeType === "video",
          ) ??
          project.nodes.find(
            (n) => n.id === `video_${shot.sceneId}` && n.data.nodeType === "video",
          ))
        : undefined);
    if (!node || isStale(project, node)) continue;
    // productionSourceRevision on canvas nodes can be either new or legacy revision.
    if (
      node.data.productionShotId === shot.shotId &&
      node.data.productionSourceRevision !== undefined &&
      !matchesAnyRevision(String(node.data.productionSourceRevision), shot, "video")
    )
      continue;
    if (
      node.data.canvasShotId &&
      project.shotWorkspaces?.[shot.shotId]?.sourceRevision !== undefined &&
      !matchesAnyRevision(String(project.shotWorkspaces[shot.shotId].sourceRevision), shot, "video")
    )
      continue;
    const segments = node.data.segments as import("./apply").ShotSegment[] | undefined;
    const segment = segments?.find((s) => s.shotId === shot.shotId);
    const single =
      !!project.shotWorkspaces?.[shot.shotId] ||
      node.data.productionShotId === shot.shotId ||
      shots.filter((s) => s.sceneId === shot.sceneId).length === 1;
    if (
      segments?.length
        ? !segment || (segment.sourceRevision !== undefined && !matchesAnyRevision(segment.sourceRevision, shot, "video"))
        : !single
    )
      continue;
    const imageEdge = project.edges.find(
      (e) =>
        e.target === node.id && e.data?.kind === "context" && e.data?.inputRole === "first-frame",
    );
    const image =
      imageEdge &&
      project.nodes.find((n) => n.id === imageEdge.source && n.data.nodeType === "image");
    const candidates: [AssetKind, string | undefined, string | undefined][] = [
      [
        "video",
        (segment?.videoUrl ?? node.data.videoUrl) as string | undefined,
        segment?.videoVersionId,
      ],
      [
        "audio",
        (segment?.audioUrl ?? node.data.audioUrl) as string | undefined,
        segment?.audioVersionId,
      ],
      [
        "image",
        image && !isStale(project, image) ? (image.data.imageUrl as string) : undefined,
        undefined,
      ],
    ];
    for (const [kind, url, versionId] of candidates) {
      if (kind !== "image" || !frame)
        registerCanvasAsset(project, state, shot, kind, url, versionId);
    }
  }
}

function registerCanvasAsset(
  project: StoryProject,
  state: ProductionState,
  shot: ReturnType<typeof productionShots>[number],
  kind: AssetKind,
  url?: string,
  versionId?: string,
) {
  if (!url) return;
  const current = selectedAsset(state, shot.shotId, kind);
  const rev = revisionFor(shot, kind);
  const mayAdoptCanvasSelection =
    !state.selectionRevisions?.[shot.shotId]?.[kind] &&
    (current?.provider === "canvas" ||
      (kind === "image" && current?.sourceRevision !== undefined && !matchesAnyRevision(current.sourceRevision, shot, kind)));
  const existing = state.assets.find(
    (a) =>
      a.shotId === shot.shotId &&
      a.kind === kind &&
      (versionId ? a.id === versionId : a.url === url),
  );
  // Existing provenance keeps its original storyboard revision after later edits.
  if (existing) {
    if (
      (!current ||
        mayAdoptCanvasSelection ||
        (kind === "video" && !!project.shotWorkspaces?.[shot.shotId])) &&
      matchesAnyRevision(existing.sourceRevision, shot, kind)
    )
      state.selected[shot.shotId] = { ...state.selected[shot.shotId], [kind]: existing.id };
    return;
  }
  const id = `canvas:${shot.shotId}:${kind}:${url}`;
  state.assets.push({
    id,
    jobId: id,
    shotId: shot.shotId,
    sceneId: shot.sceneId,
    kind,
    version:
      Math.max(
        0,
        ...state.assets
          .filter((a) => a.shotId === shot.shotId && a.kind === kind)
          .map((a) => a.version),
      ) + 1,
    url,
    createdAt: project.updatedAt,
    sourceRevision: rev,
    provider: "canvas",
  });
  // Explicit shot version choices remain authoritative.
  if (
    !current ||
    (kind === "video" && !!project.shotWorkspaces?.[shot.shotId]) ||
    mayAdoptCanvasSelection
  ) {
    state.selected[shot.shotId] = { ...state.selected[shot.shotId], [kind]: id };
  }
}
