import { mediaConfig, modelUrl, providerUrl, type ModelConfig } from "@/lib/ai/model-config";
import { buildConfiguredVideoRequest } from "@/lib/server/video-request";
/**
 * Video Provider — 视频模型抽象层
 *
 * 统一接口：submit() → poll() → done
 * 合并了原 seedance route 的 fal.ai Seedance 和 media-tools 里的 Kling/Runway。
 */

import { randomUUID } from "node:crypto";

export type VideoProviderId = "seedance" | "kling" | "runway" | "mock";

export type VideoMode = "text-to-video" | "image-to-video" | "first-last-frame";

export interface VideoGenerateParams {
  prompt: string;
  signal?: AbortSignal;
  mode?: VideoMode;
  firstFrameUrl?: string;
  lastFrameUrl?: string;
  referenceImageUrls?: string[];
  duration?: 5 | 8 | 10;
  aspectRatio?: "16:9" | "9:16" | "1:1" | "4:3" | "3:4";
  resolution?: "480p" | "720p" | "1080p";
  model?: string;
}

export interface VideoJob {
  jobId: string;
  provider: VideoProviderId;
  status: "submitted";
  signal?: AbortSignal;
  endpoint?: string;
  videoUrl?: string;
  statusUrl?: string;
  resultUrl?: string;
}

export interface VideoJobStatus {
  jobId: string;
  provider: VideoProviderId;
  status: "running" | "done" | "failed";
  videoUrl?: string;
  progress?: number;
  error?: string;
}

export interface VideoProvider {
  id: VideoProviderId;
  submit(params: VideoGenerateParams, sceneId?: string): Promise<VideoJob>;
  poll(job: VideoJob): Promise<VideoJobStatus>;
}

// ── Seedance (fal.ai) ───────────────────────────────────────────

class SeedanceVideoProvider implements VideoProvider {
  private directResults = new Map<string, string>();
  private jobEndpoints = new Map<string, string>();
  readonly id = "seedance" as const;
  constructor(private config: ModelConfig) {}

  async submit(params: VideoGenerateParams): Promise<VideoJob> {
    const { endpoint, input: body } = buildConfiguredVideoRequest(params);

    const res = await fetch(modelUrl(this.config, endpoint), {
      method: "POST",
      signal: params.signal,
      headers: {
        Authorization: `Key ${this.config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Seedance submit failed ${res.status}: ${err}`);
    }

    const data = (await res.json()) as {
      request_id?: string;
      video?: { url?: string };
      video_url?: string;
      status_url?: string;
      response_url?: string;
    };

    // 可能同步返回（无 request_id）
    const directUrl = data.video?.url ?? data.video_url;
    if (directUrl) {
      const jobId = `sync_${randomUUID()}`;
      this.directResults.set(jobId, directUrl);
      return { jobId, provider: "seedance", status: "submitted", videoUrl: directUrl };
    }

    if (!data.request_id) throw new Error("Seedance: no request_id in response");

    this.jobEndpoints.set(data.request_id, endpoint);
    const base = `${modelUrl(this.config, endpoint)}/requests/${encodeURIComponent(data.request_id)}`;
    return {
      jobId: data.request_id,
      provider: "seedance",
      status: "submitted",
      endpoint,
      statusUrl: providerUrl(data.status_url ?? `${base}/status`, this.config),
      resultUrl: providerUrl(data.response_url ?? base, this.config),
    };
  }

  async poll(job: VideoJob): Promise<VideoJobStatus> {
    const directUrl = this.directResults.get(job.jobId);
    if (directUrl)
      return { jobId: job.jobId, provider: "seedance", status: "done", videoUrl: directUrl };
    if (job.jobId.startsWith("sync_")) throw new Error("未知同步任务，请重新提交");

    const endpoint =
      this.jobEndpoints.get(job.jobId) ?? job.endpoint ?? "fal-ai/bytedance/seedance-1-0-lite";
    const statusBase = `${modelUrl(this.config, endpoint)}/requests/${encodeURIComponent(job.jobId)}`;

    const statusRes = await fetch(
      providerUrl(job.statusUrl ?? `${statusBase}/status`, this.config),
      {
        signal: job.signal,
        headers: { Authorization: `Key ${this.config.apiKey}` },
      },
    );
    if (!resOk(statusRes)) throw new Error(`Seedance poll failed ${statusRes.status}`);

    const statusData = (await statusRes.json()) as { status?: string };

    if (statusData.status === "COMPLETED") {
      const resultRes = await fetch(providerUrl(job.resultUrl ?? statusBase, this.config), {
        signal: job.signal,
        headers: { Authorization: `Key ${this.config.apiKey}` },
      });
      if (!resultRes.ok) throw new Error(`Seedance result failed ${resultRes.status}`);
      const resultData = (await resultRes.json()) as Record<string, unknown>;
      const videoUrl =
        (resultData.video as Record<string, unknown> | undefined)?.url ?? resultData.video_url;
      if (videoUrl) {
        return {
          jobId: job.jobId,
          provider: "seedance",
          status: "done",
          videoUrl: String(videoUrl),
        };
      }
      return { ...job, status: "failed", error: "Completed but no videoUrl" };
    }

    if (statusData.status === "FAILED" || statusData.status === "CANCELLED") {
      return { ...job, status: "failed", error: `Generation ${statusData.status?.toLowerCase()}` };
    }

    return { ...job, status: "running" };
  }
}

// ── Kling ──────────────────────────────────────────────────────

class KlingVideoProvider implements VideoProvider {
  readonly id = "kling" as const;
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async submit(params: VideoGenerateParams): Promise<VideoJob> {
    const body: Record<string, unknown> = {
      model: "kling-v1",
      prompt: params.prompt,
      duration: params.duration ?? 5,
      mode: "standard",
      aspect_ratio: params.aspectRatio ?? "16:9",
    };
    if (params.firstFrameUrl) body.image_url = params.firstFrameUrl;

    const res = await fetch("https://api.klingai.com/v1/videos/text2video", {
      method: "POST",
      signal: params.signal,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) throw new Error(`Kling submit error ${res.status}`);
    const data = (await res.json()) as { task_id?: string };

    return { jobId: data.task_id ?? "unknown", provider: "kling", status: "submitted" };
  }

  async poll(job: VideoJob): Promise<VideoJobStatus> {
    const res = await fetch(`https://api.klingai.com/v1/videos/text2video/${job.jobId}`, {
      signal: job.signal,
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    if (!resOk(res)) return { ...job, status: "failed", error: `Kling poll error ${res.status}` };

    const data = (await res.json()) as {
      task_status?: string;
      task_result?: { videos?: Array<{ url: string }> };
    };

    if (data.task_status === "succeed") {
      const videoUrl = data.task_result?.videos?.[0]?.url;
      return videoUrl
        ? { ...job, status: "done", videoUrl }
        : { ...job, status: "failed", error: "视频结果缺少地址" };
    }
    if (data.task_status === "failed") {
      return { ...job, status: "failed" };
    }
    return { ...job, status: "running", progress: 0 };
  }
}

// ── Runway ─────────────────────────────────────────────────────

class RunwayVideoProvider implements VideoProvider {
  readonly id = "runway" as const;
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async submit(params: VideoGenerateParams): Promise<VideoJob> {
    const res = await fetch("https://api.runwayml.com/v1/image_to_video", {
      method: "POST",
      signal: params.signal,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "X-Runway-Version": "2024-11-06",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gen3a_turbo",
        promptText: params.prompt,
        promptImage: params.firstFrameUrl,
        duration: Math.min(params.duration ?? 5, 10),
        ratio: "1280:720",
      }),
    });
    if (!res.ok) throw new Error(`Runway error ${res.status}`);
    const data = (await res.json()) as { id?: string };

    return { jobId: data.id ?? "unknown", provider: "runway", status: "submitted" };
  }

  async poll(job: VideoJob): Promise<VideoJobStatus> {
    const res = await fetch(`https://api.runwayml.com/v1/tasks/${job.jobId}`, {
      signal: job.signal,
      headers: { Authorization: `Bearer ${this.apiKey}`, "X-Runway-Version": "2024-11-06" },
    });
    if (!resOk(res)) return { ...job, status: "failed", error: `Runway poll error ${res.status}` };

    const data = (await res.json()) as { status?: string; output?: string[] };

    if (data.status === "SUCCEEDED") {
      const videoUrl = data.output?.[0];
      return videoUrl
        ? { ...job, status: "done", videoUrl }
        : { ...job, status: "failed", error: "视频结果缺少地址" };
    }
    if (data.status === "FAILED") {
      return { ...job, status: "failed" };
    }
    return { ...job, status: "running" };
  }
}

// ── Mock ────────────────────────────────────────────────────────

class MockVideoProvider implements VideoProvider {
  readonly id = "mock" as const;

  async submit(_params: VideoGenerateParams, sceneId?: string): Promise<VideoJob> {
    return {
      jobId: `mock_${sceneId ?? "scene"}_${Date.now()}`,
      provider: "mock",
      status: "submitted",
    };
  }

  async poll(job: VideoJob): Promise<VideoJobStatus> {
    return {
      jobId: job.jobId,
      provider: "mock",
      status: "done",
      videoUrl:
        "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4",
    };
  }
}

// ── Helpers ────────────────────────────────────────────────────

function resOk(res: Response): boolean {
  return res.ok;
}

// ── Factory ─────────────────────────────────────────────────────

/**
 * 创建视频 provider，按优先级：
 * 1. VIDEO_API_KEY（兼容 FAL_API_KEY）→ Seedance / fal 兼容接口
 * 2. KLING_API_KEY → Kling
 * 3. RUNWAY_API_KEY → Runway
 * 4. Mock
 */
export function createVideoProvider(): VideoProvider {
  const config = mediaConfig("video");
  if (config.apiKey) return new SeedanceVideoProvider(config);
  if (process.env.KLING_API_KEY) return new KlingVideoProvider(process.env.KLING_API_KEY);
  if (process.env.RUNWAY_API_KEY) return new RunwayVideoProvider(process.env.RUNWAY_API_KEY);
  if (process.env.STORYREEL_GENERATION_MODE === "mock") return new MockVideoProvider();
  throw new Error("请配置视频生成服务；仅显式 mock 模式可使用占位素材");
}

/** 获取所有可用的视频 provider ID（用于配置面板展示） */
export function getAvailableVideoProviders(): VideoProviderId[] {
  const ids: VideoProviderId[] = [];
  if (mediaConfig("video").apiKey) ids.push("seedance");
  if (process.env.KLING_API_KEY) ids.push("kling");
  if (process.env.RUNWAY_API_KEY) ids.push("runway");
  if (process.env.STORYREEL_GENERATION_MODE === "mock") ids.push("mock");
  return ids;
}
