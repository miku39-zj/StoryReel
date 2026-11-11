import { omit } from "@/lib/omit";
import { canvasResultPatch } from "@/lib/generation/results";
import type { CanvasJob } from "@/lib/canvas/jobs";
import type { StoryProject } from "@/lib/story/types";
import { isStale } from "@/lib/canvas/workflow";
import { productionShots } from "./shot-inputs";
import { shotRevision, imageRevision, audioRevision } from "./shots";
import { selectedAsset, type ProductionState } from "./types";

export type VisualScope = "all" | "characters" | "scenes" | "backgrounds" | "frames";

/** Missing work only. Reference images complete before shot inputs are snapshotted. */
export function missingVisuals(
  project: StoryProject,
  state: ProductionState,
  scope: VisualScope = "all",
) {
  return {
    images: project.nodes
      .filter(
        (n) =>
          n.type === "image" &&
          (scope === "all" ||
            (scope === "characters"
              ? n.data.assetKind === "character"
              : scope === "backgrounds"
                ? n.data.assetKind === "scene"
                : scope === "frames"
                  ? !["character", "scene"].includes(String(n.data.assetKind))
                  : n.data.assetKind !== "character")) &&
          (!n.data.imageUrl || isStale(project, n)),
      )
      .map((n) => n.id),
    shots: (["characters", "backgrounds"].includes(scope) ? [] : productionShots(project)).flatMap(
      (shot) => {
        const imgRev = imageRevision(shot);
        const audRev = audioRevision(shot);
        const legacyRev = shotRevision(shot);
        return (["image", "audio"] as const)
          .filter(
            (kind) => {
              if (!["scenes", "frames"].includes(scope) ? false : kind !== "image") return false;
              if (kind === "audio" && !shot.dialogue?.trim()) return false;
              const asset = selectedAsset(state, shot.shotId, kind);
              const rev = kind === "image" ? imgRev : audRev;
              // Accept either the new per-artifact revision or the legacy monolithic one.
              return asset?.sourceRevision !== rev && asset?.sourceRevision !== legacyRev;
            },
          )
          .map((kind) => ({
            shotId: shot.shotId,
            kind,
            revision: kind === "image" ? imgRev : audRev,
          }));
      }
    ),
  };
}
/** Generated URLs and task metadata may change; authored inputs may not change mid-batch. */
export function visualSource(project: StoryProject) {
  return JSON.stringify(
    {
      name: project.name,
      description: project.description ?? "",
      variables: project.initialVariables ?? {},
      start: project.startNodeId,
      shotOutputs: project.shotWorkspaces
        ? Object.fromEntries(
            Object.entries(project.shotWorkspaces).map(([id, s]) => [
              id,
              { mainVideoNodeId: s.mainVideoNodeId, sourceRevision: s.sourceRevision },
            ]),
          )
        : undefined,
      creation: project.creation
        ? omit(project.creation, ["activeStep", "stepStatuses", "assets", "assetLibrary"])
        : undefined,
      nodes: project.nodes.map((n) => ({
        ...n,
        data:
          n.type === "image"
            ? omit(n.data, [
                "imageUrl",
                "generationFingerprint",
                "generationVersions",
                "generationStatus",
                "generationError",
                "generationJobId",
              ])
            : n.data,
      })),
      edges: project.edges,
    },
    (_key, value) =>
      value && typeof value === "object" && !Array.isArray(value)
        ? Object.fromEntries(
            Object.keys(value)
              .sort()
              .map((key) => [key, value[key]]),
          )
        : value,
  );
}
export interface VisualBatch {
  id: string;
  projectId: string;
  scope?: VisualScope;
  status: "running" | "done" | "failed";
  error?: string;
  createdAt: string;
  updatedAt: string;
}

/** Rebase only guarded machine results; manual input/selection changes retain conflict protection. */
export function adoptVisualResults(local: StoryProject, remote: StoryProject, jobs: CanvasJob[]) {
  if (local.id !== remote.id || visualSource(local) !== visualSource(remote)) return null;
  let merged = local;
  for (const job of jobs) {
    const patch = canvasResultPatch(merged, job);
    if (patch)
      merged = {
        ...merged,
        nodes: merged.nodes.map((n) =>
          n.id === job.nodeId ? { ...n, data: { ...n.data, ...patch } } : n,
        ),
      };
  }
  if (
    remote.nodes.some(
      (n) =>
        n.type === "image" &&
        (() => {
          const current = merged.nodes.find((c) => c.id === n.id);
          return (
            !current ||
            current.data.imageUrl !== n.data.imageUrl ||
            current.data.generationJobId !== n.data.generationJobId
          );
        })(),
    )
  )
    return null;
  return { ...merged, revision: remote.revision };
}
