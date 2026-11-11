import type { StoryProject } from "@/lib/story/types";
import type { CanvasJob } from "@/lib/canvas/jobs";
import { fingerprint, legacyFingerprint } from "@/lib/canvas/workflow";

export interface SourceVersion {
  sourceRevision: string;
}
export function matchesSource(asset: SourceVersion | undefined, sourceRevision: string) {
  return !!asset && asset.sourceRevision === sourceRevision;
}
export function selectionUnchanged(current: number | undefined, submitted: number | undefined) {
  return (current ?? 0) === (submitted ?? 0);
}
export interface CanvasVersion {
  id: string;
  url: string;
  fingerprint: string;
  createdAt: string;
}
/** Completion records a version; application additionally requires unchanged inputs and selection. */
export function canvasResultPatch(project: StoryProject, job: CanvasJob) {
  if (project.id !== job.projectId || job.status !== "succeeded" || !job.url || !job.fingerprint)
    return null;
  const node = project.nodes.find((n) => n.id === job.nodeId);
  if (!node || node.type !== job.kind) return null;
  const versions = (node.data.generationVersions ?? []) as CanvasVersion[];
  const existing = versions.some((v) => v.id === job.id);
  const sourceFingerprint = job.sourceFingerprint ?? job.fingerprint;
  const sameInput = sourceFingerprint.startsWith("v2:")
    ? fingerprint(project, node.id) === sourceFingerprint
    : legacyFingerprint(project, node.id) === sourceFingerprint;
  const urlField = job.kind === "image" ? "imageUrl" : "videoUrl";
  const alreadySelected = node.data[urlField] === job.url && node.data.generationJobId === job.id;
  const unchangedSelection =
    node.data[urlField] === job.previousUrl && node.data.generationJobId === job.previousVersion;
  const current = sameInput && (unchangedSelection || alreadySelected);
  const appliedFingerprint = current ? fingerprint(project, node.id) : sourceFingerprint;
  if (
    existing &&
    (!current || (alreadySelected && node.data.generationFingerprint === appliedFingerprint))
  )
    return null;
  return {
    generationVersions: existing
      ? versions.map((v) => (v.id === job.id ? { ...v, fingerprint: appliedFingerprint } : v))
      : [
          ...versions,
          { id: job.id, url: job.url, fingerprint: appliedFingerprint, createdAt: job.updatedAt },
        ],
    ...(current
      ? {
          ...(job.kind === "video"
            ? { segments: undefined, audioUrl: undefined, clipEnd: undefined }
            : {}),
          [job.kind === "image" ? "imageUrl" : "videoUrl"]: job.url,
          generationFingerprint: appliedFingerprint,
          generationJobId: job.id,
          generationStatus: "done" as const,
          generationError: undefined,
        }
      : {}),
  };
}
