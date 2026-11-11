import { nextVersion } from "./generation-ledger";
import { getDatabase } from "./database";
import { assertStorageId } from "./storage-path";
import { selectionUnchanged } from "@/lib/generation/results";
import { isRunnable, claimTask, ownsTask, failOperation } from "@/lib/generation/lifecycle";
import { randomUUID } from "node:crypto";
import { generationProvider, type GenerationProvider } from "./generation-provider";
import { updateProduction, productionProjectIds } from "./production-store";
import { getProject } from "./projects";
import { storeGeneratedMedia } from "./generated-media";
import type { AssetVersion } from "@/lib/production/types";
import { OPENAI_IMAGE_LEASE_MS } from "./openai-image";

/** One durable provider operation per tick; persisted provider IDs survive process restarts. */
export async function workerTick(
  options: {
    provider?: GenerationProvider;
    leaseMs?: number;
    pollMs?: number;
    owner?: string;
    projectId?: string;
  } = {},
) {
  if (options.projectId !== undefined) assertStorageId(options.projectId);
  const provider = options.provider ?? generationProvider;
  const owner = options.owner ?? randomUUID();
  for (const projectId of options.projectId ? [options.projectId] : await productionProjectIds()) {
    if (!(await getProject(projectId))) {
      await updateProduction(projectId, (state) => {
        for (const job of state.jobs)
          if (["queued", "running"].includes(job.status)) {
            job.status = "failed";
            job.error = "项目已删除，任务已停止";
          }
      });
      continue;
    }
    const job = await updateProduction(projectId, (state) => {
      for (const candidate of state.jobs) {
        if (!isRunnable(candidate)) continue;
        const dependency = state.jobs.find((j) => j.id === candidate.imageJobId);
        if (candidate.imageJobId && !dependency) {
          candidate.status = "failed";
          candidate.error = "依赖的图片任务不存在，请重试镜头视频";
          continue;
        }
        if (dependency && dependency.status === "failed") {
          candidate.status = "failed";
          candidate.error = "图片任务失败，请重试该镜头视频以重新生成缺失素材";
          continue;
        }
        if (dependency && dependency.status !== "succeeded") continue;
        if (dependency) {
          const image = state.assets.find((a) => a.id === dependency.resultAssetId);
          if (!image) {
            candidate.status = "failed";
            candidate.error = "依赖的图片版本不存在";
            continue;
          }
          candidate.inputImageId = image.id;
          // fal must receive the original hosted image, not a localhost application URL.
          candidate.inputImageUrl = image.providerUrl ?? image.url;
        }
        const leaseMs =
          options.leaseMs ?? (candidate.kind === "image" ? OPENAI_IMAGE_LEASE_MS : undefined);
        if (!claimTask(candidate, owner, !!candidate.providerTask, leaseMs)) continue;
        return structuredClone(candidate);
      }
      return null;
    });
    if (!job) continue;
    try {
      const result = job.providerTask ? await provider.poll(job) : await provider.submit(job);
      if (result.state === "pending") {
        await updateProduction(projectId, (state) => {
          const current = state.jobs.find((j) => j.id === job.id)!;
          if (!ownsTask(current, owner)) return;
          current.error = undefined;
          current.providerTask = result.task;
          current.stage = "polling";
          current.leaseUntil = 0;
          current.nextRunAt = Date.now() + (options.pollMs ?? 3000);
          current.updatedAt = new Date().toISOString();
        });
      } else {
        const assetId = randomUUID();
        const url = await storeGeneratedMedia(assetId, result);
        await updateProduction(projectId, (state) => {
          const current = state.jobs.find((j) => j.id === job.id)!;
          if (!ownsTask(current, owner)) return;
          const asset: AssetVersion = {
            id: assetId,
            shotId: job.shotId,
            sceneId: job.shot.sceneId,
            kind: job.kind,
            version: nextVersion(getDatabase(), projectId, "shot", job.shotId, job.kind),
            url,
            providerUrl: result.url,
            jobId: job.id,
            createdAt: new Date().toISOString(),
            sourceRevision: job.sourceRevision,
            provider: result.provider,
            mock: result.mock,
            inputImageId: job.inputImageId,
          };
          state.assets.push(asset);
          if (
            selectionUnchanged(
              state.selectionRevisions?.[job.shotId]?.[job.kind],
              job.selectionRevision,
            )
          )
            state.selected[job.shotId] = { ...state.selected[job.shotId], [job.kind]: assetId };
          current.error = undefined;
          current.resultAssetId = assetId;
          current.status = "succeeded";
          current.leaseUntil = 0;
          current.updatedAt = asset.createdAt;
        });
      }
    } catch (error) {
      await updateProduction(projectId, (state) => {
        const current = state.jobs.find((j) => j.id === job.id)!;
        if (!ownsTask(current, owner)) return;
        failOperation(current, error, !!job.providerTask, options.pollMs);
      });
    }
    return true;
  }
  return false;
}
