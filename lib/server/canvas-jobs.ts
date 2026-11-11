import { omit } from "@/lib/omit";
import { readProviderJSON } from "./provider-json";
import {
  isVideoGateway,
  buildGatewayVideoRequest,
  submitGatewayVideo,
  pollGatewayVideo,
} from "./gateway-video";
import type { ProviderTask } from "@/lib/production/types";
import { generateOpenAIImage, OPENAI_IMAGE_LEASE_MS } from "./openai-image";
import {
  mediaConfig,
  imageProtocol,
  providerUrl,
  modelUrl,
  type ModelConfig,
} from "@/lib/ai/model-config";
import { isRunnable, claimTask, ownsTask, failOperation } from "@/lib/generation/lifecycle";
import { tasks, saveTask, recordCanvasVersion } from "./generation-ledger";
import { assertProjectNotDeleted, assertTaskCapacity, activeTaskCount } from "./task-governance";
import { canvasQuote, canvasLimits } from "./canvas-policy";
import { isContextEdge } from "@/lib/story/connections";
import { randomUUID } from "node:crypto";
import { getDatabase, transaction } from "./database";
import { storeGeneratedMedia } from "./generated-media";
import { resolveProviderMedia } from "./provider-media";
import { buildConfiguredVideoRequest as buildSeedanceRequest } from "./video-request";
import { fingerprint, generationInput } from "@/lib/canvas/workflow";
import type { CanvasJob } from "@/lib/canvas/jobs";
import type { StoryProject } from "@/lib/story/types";
interface StoredJob extends CanvasJob {
  project: StoryProject;
  providerTask?: ProviderTask;
  leaseUntil?: number;
  owner?: string;
  nextRunAt?: number;
  stage?: string;
  task?: {
    status: string;
    result: string;
    cancel?: string;
  };
  pollErrors?: number;
  requestKey: string;
}
function db() {
  return getDatabase();
}
function all(projectId?: string): StoredJob[] {
  return tasks<StoredJob>(db(), "canvas", projectId);
}
function save(j: StoredJob) {
  j.updatedAt = new Date().toISOString();
  saveTask(db(), j.projectId, "canvas", j);
  if (j.status === "succeeded" && j.url && j.fingerprint)
    recordCanvasVersion(db(), { ...j, url: j.url, fingerprint: j.fingerprint });
}
function publicJob(j: StoredJob): CanvasJob {
  const { project, task, providerTask } = j;
  const view = omit(j, [
    "project",
    "leaseUntil",
    "owner",
    "nextRunAt",
    "stage",
    "task",
    "providerTask",
    "pollErrors",
    "requestKey",
  ]);
  return {
    ...view,
    ...(j.status === "succeeded" ? { sourceFingerprint: fingerprint(project, j.nodeId) } : {}),
    ...(providerTask ? { externalRequestId: providerTask.requestId } : {}),
    waitingForQuery: j.status === "running" && !!providerTask?.blockedReason,
    resumable: !!(task || providerTask) && j.status === "failed",
  };
}
export function canvasJobs(projectId: string) {
  return all(projectId).map(publicJob);
}
/** Validate provider inputs before confirmation and again before writing tasks. */
export function planCanvas(project: StoryProject, targets: string[]) {
  const quote = canvasQuote(project, targets),
    plan = quote.nodeIds;
  const preview = structuredClone(project);
  for (const nodeId of plan) {
    const input = generationInput(preview, nodeId);
    if (
      input.kind === "image" &&
      input.referenceImageUrls?.length &&
      imageProtocol() !== "openai" &&
      process.env.STORYREEL_GENERATION_MODE !== "mock"
    )
      throw new Error("当前 fal 图片模型未声明参考图协议，请配置支持图片编辑的 OpenAI 兼容服务");
    if (input.kind === "video") {
      if (isVideoGateway()) {
        buildGatewayVideoRequest({
          ...input,
          generateAudio: typeof input.generateAudio === "boolean" ? input.generateAudio : undefined,
          aspectRatio: typeof input.aspectRatio === "string" ? input.aspectRatio : undefined,
          resolution: typeof input.resolution === "string" ? input.resolution : undefined,
          duration: typeof input.duration === "number" ? input.duration : undefined,
        });
      } else buildSeedanceRequest(input);
    }
    const node = preview.nodes.find((n) => n.id === nodeId)!;
    node.data[node.type === "image" ? "imageUrl" : "videoUrl"] = "https://example.invalid/pending";
  }
  return quote;
}
export function enqueueCanvas(
  project: StoryProject,
  targets: string[],
  requestKey: string,
  adoptedTask?: ProviderTask,
) {
  const database = db();
  return transaction(database, () => {
    assertProjectNotDeleted(database, project.id);
    const existing = all(project.id),
      duplicate = existing.filter((j) => j.requestKey === requestKey);
    if (duplicate.length) return duplicate.map(publicJob);
    const plan = planCanvas(project, targets).nodeIds,
      jobs: StoredJob[] = [];
    assertTaskCapacity(database, plan.length);
    if (
      adoptedTask &&
      (adoptedTask.provider !== "gateway" ||
        plan.length !== 1 ||
        project.nodes.find((n) => n.id === plan[0])?.type !== "video")
    )
      throw new Error("只能登记单个已提交的网关视频任务");
    for (const id of plan) {
      const ancestors = new Set<string>(),
        todo = [id];
      for (let i = 0; i < todo.length; i++)
        for (const e of project.edges.filter(
          (e) => e.target === todo[i] && isContextEdge(e, project.nodes),
        ))
          if (!ancestors.has(e.source)) {
            ancestors.add(e.source);
            todo.push(e.source);
          }
      const busy = existing.find(
        (j) => j.nodeId === id && ["queued", "running"].includes(j.status),
      );
      if (busy) throw new Error("节点已有生成任务，请等待或取消后重试");
      const n = project.nodes.find((n) => n.id === id)!;
      jobs.push({
        previousUrl: (n.type === "image" ? n.data.imageUrl : n.data.videoUrl) as string | undefined,
        previousVersion: n.data.generationJobId as string | undefined,
        id: randomUUID(),
        projectId: project.id,
        nodeId: id,
        kind: n.type as "image" | "video",
        status: "queued",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        dependencies: jobs.filter((j) => ancestors.has(j.nodeId)).map((j) => j.id),
        project: structuredClone(project),
        requestKey,
      });
    }
    for (const job of jobs) {
      if (adoptedTask)
        Object.assign(job, {
          providerTask: adoptedTask,
          status: "running",
          stage: "polling",
          fingerprint: fingerprint(job.project, job.nodeId),
          error: adoptedTask.blockedReason,
        });
      save(job);
    }
    return jobs.map(publicJob);
  });
}
async function remote(config: ModelConfig, url: string, init: RequestInit = {}) {
  const r = await fetch(providerUrl(url, config), {
    ...init,
    signal: AbortSignal.timeout(60000),
    headers: {
      Authorization: `Key ${config.apiKey}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  return readProviderJSON(r);
}
export async function cancelCanvas(projectId: string, id: string) {
  const database = db();
  const job = transaction(database, () => {
    const j = all(projectId).find((j) => j.id === id);
    if (!j) throw new Error("任务不存在");
    if (["queued", "running"].includes(j.status)) {
      j.status = "cancelled";
      j.error = "已停止接收结果";
      j.owner = undefined;
      save(j);
    }
    return j;
  });
  if (job.status === "cancelled" && job.task?.cancel) {
    try {
      await remote(mediaConfig(job.kind), job.task.cancel, { method: "PUT" });
    } catch {
      /* Local cancellation remains authoritative; provider may have completed. */
    }
  }
  return publicJob(job);
}
/** One leased operation; provider request IDs are persisted before the next poll. */
export async function canvasWorkerTick(projectId?: string) {
  const database = db(),
    owner = randomUUID();
  const job = transaction(database, () => {
    const jobs = all(projectId);
    for (const j of jobs) {
      if (!isRunnable(j)) continue;
      try {
        assertProjectNotDeleted(database, j.projectId);
      } catch {
        j.status = "cancelled";
        j.error = "项目已删除，任务已停止";
        j.owner = undefined;
        save(j);
        continue;
      }
      if ((j.leaseUntil ?? 0) > Date.now() || (j.nextRunAt ?? 0) > Date.now()) continue;
      const dependencies = j.dependencies.map((id) => jobs.find((d) => d.id === id));
      if (dependencies.some((d) => !d || ["failed", "cancelled"].includes(d.status))) {
        j.status = "failed";
        j.error = "上游任务失败或取消，请修复后重新生成";
        save(j);
        continue;
      }
      if (dependencies.some((d) => d?.status !== "succeeded")) continue;
      for (const d of dependencies) {
        const n = j.project.nodes.find((n) => n.id === d!.nodeId);
        if (n) {
          n.data = { ...n.data, [d!.kind === "image" ? "imageUrl" : "videoUrl"]: d!.url };
        }
      }
      if (
        !claimTask(
          j,
          owner,
          !!(j.task || j.providerTask),
          j.kind === "image" ? OPENAI_IMAGE_LEASE_MS : undefined,
        )
      ) {
        save(j);
        continue;
      }
      save(j);
      return structuredClone(j);
    }
    return null;
  });
  if (!job) return false;
  const update = (fn: (j: StoredJob) => void) =>
    transaction(database, () => {
      const j = all(job.projectId).find((j) => j.id === job.id);
      if (!ownsTask(j, owner)) return;
      fn(j);
      save(j);
    });
  try {
    const config = mediaConfig(job.kind);
    if (!config.apiKey)
      throw new Error(`请配置 ${job.kind.toUpperCase()}_API_KEY（兼容 FAL_API_KEY）后生成素材`);
    if (
      job.kind === "video" &&
      (job.providerTask?.provider === "gateway" || isVideoGateway(config))
    ) {
      const input = generationInput(job.project, job.nodeId);
      const result = job.providerTask
        ? await pollGatewayVideo(job.providerTask)
        : await submitGatewayVideo(
            {
              ...input,
              generateAudio:
                typeof input.generateAudio === "boolean" ? input.generateAudio : undefined,
              aspectRatio: typeof input.aspectRatio === "string" ? input.aspectRatio : undefined,
              resolution: typeof input.resolution === "string" ? input.resolution : undefined,
              duration: typeof input.duration === "number" ? input.duration : undefined,
            },
            config,
          );
      if (result.state === "pending")
        update((j) => {
          j.providerTask = result.task;
          j.fingerprint = job.fingerprint ?? fingerprint(job.project, job.nodeId);
          j.stage = "polling";
          j.leaseUntil = 0;
          j.nextRunAt = Date.now() + 15000;
          j.error = result.task.blockedReason;
        });
      else {
        const local = await storeGeneratedMedia(job.id, result);
        update((j) => {
          j.url = local;
          j.fingerprint = job.fingerprint ?? fingerprint(job.project, job.nodeId);
          j.status = "succeeded";
          j.error = undefined;
          j.leaseUntil = 0;
        });
      }
      return true;
    }
    let result;
    if (!job.task) {
      const input = generationInput(job.project, job.nodeId);
      job.fingerprint = fingerprint(job.project, job.nodeId);
      if (job.kind === "image" && imageProtocol() === "openai") {
        const generated = await generateOpenAIImage(
          `${input.style ?? "cinematic"}\n${input.prompt}`,
          {
            aspectRatio: typeof input.aspectRatio === "string" ? input.aspectRatio : "16:9",
            referenceImageUrls: input.referenceImageUrls,
          },
          config,
        );
        const local = await storeGeneratedMedia(job.id, generated);
        update((j) => {
          j.url = local;
          j.fingerprint = job.fingerprint;
          j.status = "succeeded";
          j.error = undefined;
          j.leaseUntil = 0;
        });
        return true;
      }
      if (job.kind === "image" && input.referenceImageUrls?.length)
        throw new Error(
          "当前 fal 图片模型未声明参考图协议，请使用支持图片编辑的 OpenAI 兼容服务；未提交纯文生图",
        );
      const request =
        job.kind === "video"
          ? buildSeedanceRequest(await resolveProviderMedia(input))
          : {
              endpoint: config.model,
              input: {
                prompt: `${input.style ?? "cinematic"}\n${input.prompt}`,
                image_size: "landscape_16_9",
                num_images: 1,
              },
            };
      const submitted = await remote(config, modelUrl(config, request.endpoint), {
        method: "POST",
        body: JSON.stringify(request.input),
      });
      if (submitted.request_id) {
        const base = `${modelUrl(config, request.endpoint)}/requests/${encodeURIComponent(submitted.request_id)}`;
        const task = {
          status: providerUrl(submitted.status_url ?? `${base}/status`, config),
          result: providerUrl(submitted.response_url ?? base, config),
          cancel: providerUrl(submitted.cancel_url ?? `${base}/cancel`, config),
        };
        update((j) => {
          j.task = task;
          j.fingerprint = job.fingerprint;
          j.stage = "polling";
          j.leaseUntil = 0;
          j.nextRunAt = Date.now() + 3000;
        });
        return true;
      }
      result = submitted;
    } else {
      const status = await remote(config, job.task.status);
      if (["FAILED", "CANCELLED"].includes(status.status) || status.error)
        throw new Error(`生成失败：${status.error ?? status.status}`);
      if (status.status !== "COMPLETED") {
        update((j) => {
          j.leaseUntil = 0;
          j.nextRunAt = Date.now() + 3000;
        });
        return true;
      }
      result = await remote(config, job.task.result);
    }
    const url =
      job.kind === "video" ? (result.video?.url ?? result.video_url) : result.images?.[0]?.url;
    if (!url) throw new Error("生成服务未返回素材");
    const local = await storeGeneratedMedia(job.id, {
      state: "done",
      url,
      extension: job.kind === "video" ? "mp4" : "png",
      provider: "fal",
    });
    update((j) => {
      j.url = local;
      j.fingerprint = job.fingerprint;
      j.status = "succeeded";
      j.error = undefined;
      j.leaseUntil = 0;
    });
  } catch (error) {
    update((j) => failOperation(j, error, !!(j.task || j.providerTask), 5000));
  }
  return true;
}
export function resumeCanvas(projectId: string, id: string) {
  const database = db();
  return transaction(database, () => {
    assertProjectNotDeleted(database, projectId);
    const j = all(projectId).find((j) => j.id === id);
    if (!j || j.status !== "failed" || (!j.task && !j.providerTask))
      throw new Error("此任务没有可恢复的外部任务 ID");
    if (activeTaskCount(database) >= canvasLimits().maxActive)
      throw new Error("进行中的任务已达到全局上限，请等待完成后再恢复");
    j.status = "running";
    j.owner = undefined;
    j.leaseUntil = 0;
    j.nextRunAt = 0;
    j.pollErrors = 0;
    j.error = undefined;
    save(j);
    return publicJob(j);
  });
}
