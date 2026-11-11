import { productionShots } from "@/lib/production/shot-inputs";
import { reconcileCanvasAssets } from "@/lib/production/canvas-assets";
import { isVideoGateway } from "./gateway-video";
import { assertVideoTransport } from "./video-request";
import { getDatabase } from "./database";
import { assertTaskCapacity, assertProjectNotDeleted } from "./task-governance";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getProject } from "./projects";
import { getProduction, updateProduction } from "./production-store";
import { shotRevision, imageRevision, videoRevision, audioRevision, type StoryboardShot } from "@/lib/production/shots";
import { selectedAsset, type AssetKind, type GenerationJob, type ProductionState } from "@/lib/production/types";

/**
 * Resolve the last-frame URL for a shot with a lastFrameId.
 * Looks up the selected image asset for the keyframe that acts as the shared last frame.
 * Returns undefined when no lastFrameId is set or the keyframe image is not yet selected.
 */
function resolveLastFrameUrl(shot: StoryboardShot, state: ProductionState): string | undefined {
  if (!shot.lastFrameId) return undefined;
  // The keyframe image is stored as an asset whose shotId equals the keyframeId.
  const asset = state.assets.find(
    (a) => a.shotId === shot.lastFrameId && a.kind === "image",
  );
  if (!asset || !asset.url) return undefined;
  const selected = state.selected[shot.lastFrameId]?.image;
  if (selected && selected !== asset.id) {
    // A different version was explicitly selected for this keyframe — use it.
    const explicit = state.assets.find((a) => a.id === selected && a.kind === "image");
    return explicit?.url;
  }
  return asset.url;
}

export const productionRequest = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("generate"),
    shotIds: z.array(z.string()).min(1).max(500),
    kind: z.enum(["image", "audio", "video", "pipeline", "visual"]),
    requestKey: z.string().min(1).max(160),
  }),
  z.object({ action: z.literal("select"), assetId: z.string() }),
  /** Keyframe image generation: keyframeIds are stored as shotIds in the asset store. */
  z.object({
    action: z.literal("generate-keyframes"),
    keyframeIds: z.array(z.string().min(1).max(160)).min(1).max(100),
    requestKey: z.string().min(1).max(160),
  }),
]);
export async function syncCanvasProduction(projectId: string) {
  const project = await getProject(projectId);
  if (project) await updateProduction(projectId, (state) => reconcileCanvasAssets(project, state));
  return getProduction(projectId);
}
export async function submitProduction(projectId: string, raw: unknown) {
  const request = productionRequest.parse(raw);
  const project = await getProject(projectId);
  if (!project) throw new Error("项目不存在");
  await syncCanvasProduction(projectId);

  if (request.action === "select") {
    await updateProduction(projectId, (state) => {
      const asset = state.assets.find((a) => a.id === request.assetId);
      if (!asset) throw new Error("素材版本不存在");
      state.selectionRevisions ??= {};
      state.selectionRevisions[asset.shotId] = {
        ...state.selectionRevisions[asset.shotId],
        [asset.kind]: (state.selectionRevisions[asset.shotId]?.[asset.kind] ?? 0) + 1,
      };
      state.selected[asset.shotId] = { ...state.selected[asset.shotId], [asset.kind]: asset.id };
    });
    return getProduction(projectId);
  }

  // ── Keyframe image generation ──────────────────────────────────────────────
  // Keyframes are stored as assets with shotId = keyframeId. They bypass the
  // normal shot lookup; a synthetic StoryboardShot carries just enough info
  // for the generation worker to generate an image (imagePrompt + visualStyle).
  if (request.action === "generate-keyframes") {
    const shots = productionShots(project);
    // Build a keyframe → description map from shot storyboard data
    const kfDescriptions = new Map<string, string>();
    for (const shot of shots) {
      if (shot.firstFrameId) kfDescriptions.set(shot.firstFrameId, shot.imagePrompt);
      if (shot.lastFrameId) kfDescriptions.set(shot.lastFrameId, shot.imagePrompt);
    }
    await updateProduction(projectId, (state) => {
      assertProjectNotDeleted(getDatabase(), projectId);
      const originalCount = state.jobs.length;
      state.requestKeys ??= [];
      if (
        state.requestKeys.includes(request.requestKey) ||
        state.jobs.some((j) => j.requestKey === request.requestKey)
      )
        return;
      for (const kfId of request.keyframeIds) {
        const description = kfDescriptions.get(kfId) ?? "关键帧图片";
        const rev = JSON.stringify([kfId, description]);
        // Skip if already queued/running for this revision
        const active = state.jobs.find(
          (j) => j.shotId === kfId && j.kind === "image" && j.sourceRevision === rev && ["queued", "running"].includes(j.status),
        );
        if (active) continue;
        // Skip if a valid image is already selected
        const existing = selectedAsset(state, kfId, "image");
        if (existing?.sourceRevision === rev) continue;
        const last = state.jobs.filter((j) => j.shotId === kfId && j.kind === "image").at(-1);
        const now = new Date().toISOString();
        // Synthetic minimal shot for the generation worker
        const syntheticShot = {
          shotId: kfId,
          sceneId: "keyframe",
          shotIndex: 0,
          frameType: "全景" as const,
          cameraMove: "固定",
          lighting: "自然光",
          action: description,
          duration: 5,
          imagePrompt: description,
          visualStyle: shots[0]?.visualStyle,
          characterDescriptions: [],
          referenceImages: [],
        };
        const job: GenerationJob = {
          id: randomUUID(),
          requestKey: request.requestKey,
          shotId: kfId,
          kind: "image",
          shot: syntheticShot as GenerationJob["shot"],
          sourceRevision: rev,
          status: "queued",
          createdAt: now,
          updatedAt: now,
          attempt: (last?.attempt ?? 0) + 1,
          retryOf: last?.status === "failed" ? last.id : undefined,
          selectionRevision: 0,
        };
        state.jobs.push(job);
      }
      assertTaskCapacity(getDatabase(), state.jobs.length - originalCount);
      state.requestKeys.push(request.requestKey);
    });
    return getProduction(projectId);
  }

  if ((request.kind === "video" || request.kind === "pipeline") && !isVideoGateway())
    assertVideoTransport();
  const shots = productionShots(project);
  if (request.shotIds.some((id) => !shots.some((s) => s.shotId === id)))
    throw new Error("镜头不存在，请先保存分镜");
  await updateProduction(projectId, (state) => {
    assertProjectNotDeleted(getDatabase(), projectId);
    const originalCount = state.jobs.length;
    // Replaying one HTTP request cannot create a second billable task.
    state.requestKeys ??= [];
    if (
      state.requestKeys.includes(request.requestKey) ||
      state.jobs.some((j) => j.requestKey === request.requestKey)
    )
      return;
    for (const shot of shots.filter((s) => request.shotIds.includes(s.shotId))) {
      if (request.kind !== "audio" && shot.referenceImages?.some((image) => !image.url))
        throw new Error("本镜头的人物或场景参考图缺失，请先在角色、场景中生成或补齐参考图");
      if (request.kind !== "audio" && (shot.referenceImages?.length ?? 0) > 4)
        throw new Error("当前图片模型每镜最多支持 4 张人物与场景参考图，请调整本镜头参考");

      // Per-artifact source revisions: changing dialogue no longer invalidates video.
      const imgRev = imageRevision(shot);
      const vidRev = videoRevision(shot);
      const audRev = audioRevision(shot);
      // Legacy callers and canvas reconciliation still use the monolithic revision.
      const sourceRevision = shotRevision(shot);

      const makeJob = (
        kind: AssetKind,
        imageJobId?: string,
        imageAssetId?: string,
        lastFrameUrl?: string,
      ): GenerationJob => {
        // Per-artifact revision governs dedup; fall back to monolithic for legacy assets.
        const rev = kind === "image" ? imgRev : kind === "video" ? vidRev : audRev;
        const active = state.jobs.find(
          (j) =>
            j.shotId === shot.shotId &&
            j.kind === kind &&
            j.sourceRevision === rev &&
            ["queued", "running"].includes(j.status),
        );
        if (active) return active;
        const last = state.jobs.filter((j) => j.shotId === shot.shotId && j.kind === kind).at(-1);
        const image = state.assets.find((a) => a.id === imageAssetId);
        const now = new Date().toISOString();
        const job: GenerationJob = {
          id: randomUUID(),
          requestKey: request.requestKey,
          shotId: shot.shotId,
          kind,
          shot,
          sourceRevision: rev,
          status: "queued",
          createdAt: now,
          updatedAt: now,
          attempt: (last?.attempt ?? 0) + 1,
          retryOf: last?.status === "failed" ? last.id : undefined,
          imageJobId,
          selectionRevision: state.selectionRevisions?.[shot.shotId]?.[kind] ?? 0,
          inputImageId: image?.id,
          inputImageUrl: image?.providerUrl ?? image?.url,
          lastFrameUrl,
        };
        state.jobs.push(job);
        return job;
      };

      if (request.kind === "audio" && !shot.dialogue?.trim())
        throw new Error("这个镜头没有对白，请先填写对白");
      if (request.kind === "image" || request.kind === "audio") {
        makeJob(request.kind);
        continue;
      }
      if (request.kind === "visual") {
        if (selectedAsset(state, shot.shotId, "image")?.sourceRevision !== imgRev)
          makeJob("image");
        if (
          shot.dialogue?.trim() &&
          selectedAsset(state, shot.shotId, "audio")?.sourceRevision !== audRev
        )
          makeJob("audio");
        continue;
      }

      // Resolve last-frame URL from keyframe store for shared-frame continuity.
      const resolvedLastFrameUrl = resolveLastFrameUrl(shot, state);

      const video = selectedAsset(state, shot.shotId, "video");
      if (request.kind === "pipeline" && video?.sourceRevision === vidRev) {
        if (
          shot.dialogue?.trim() &&
          selectedAsset(state, shot.shotId, "audio")?.sourceRevision !== audRev
        )
          makeJob("audio");
        continue;
      }
      let image = selectedAsset(state, shot.shotId, "image");
      if (image?.sourceRevision !== imgRev) image = undefined;
      const imageJob = image ? undefined : makeJob("image");
      if (request.kind === "pipeline" && shot.dialogue?.trim()) {
        const audio = selectedAsset(state, shot.shotId, "audio");
        if (audio?.sourceRevision !== audRev) makeJob("audio");
      }
      if (request.kind === "video" || video?.sourceRevision !== vidRev)
        makeJob("video", imageJob?.id, image?.id, resolvedLastFrameUrl);
    }
    assertTaskCapacity(getDatabase(), state.jobs.length - originalCount);
    state.requestKeys.push(request.requestKey);
  });
  return getProduction(projectId);
}
