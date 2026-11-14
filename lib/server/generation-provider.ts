import { isVideoGateway, submitGatewayVideo, pollGatewayVideo } from "./gateway-video";
import { readProviderJSON } from "./provider-json";
import { generateOpenAIImage } from "./openai-image";
import {
  mediaConfig,
  imageProtocol,
  audioConfig,
  providerUrl,
  modelUrl,
} from "@/lib/ai/model-config";
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { readGeneratedMedia } from "./generated-media";
import { buildConfiguredVideoRequest as buildSeedanceRequest } from "./video-request";
import { shotPrompt, shotVideoPrompt, shotVoice } from "@/lib/production/shots";
import type { GenerationJob, ProviderTask } from "@/lib/production/types";

export type GenerationResult =
  | { state: "pending"; task: ProviderTask }
  | {
      state: "done";
      url?: string;
      bytes?: Uint8Array;
      extension: "png" | "mp3" | "mp4" | "wav";
      provider: string;
      mock?: boolean;
    };
export interface GenerationProvider {
  submit(job: GenerationJob): Promise<GenerationResult>;
  poll(job: GenerationJob): Promise<GenerationResult>;
}
const timeout = () => AbortSignal.timeout(60000);
const json = readProviderJSON;
function output(
  job: GenerationJob,
  data: { video?: { url?: string }; images?: Array<{ url: string }> },
): GenerationResult {
  const url = job.kind === "video" ? data.video?.url : data.images?.[0]?.url;
  if (!url) throw new Error("生成服务没有返回素材地址");
  return { state: "done", url, extension: job.kind === "video" ? "mp4" : "png", provider: "fal" };
}
export const generationProvider: GenerationProvider = {
  async submit(job) {
    if (process.env.STORYREEL_GENERATION_MODE === "mock") {
      return {
        state: "pending",
        task: {
          provider: "mock",
          requestId: job.id,
          statusUrl: "mock",
          resultUrl: "mock",
          readyAt: Date.now() + Number(process.env.STORYREEL_MOCK_DELAY_MS ?? 1000),
        },
      };
    }
    if (job.kind === "audio") {
      const config = audioConfig();
      if (!config.apiKey) throw new Error("请配置 AUDIO_API_KEY（兼容 OPENAI_API_KEY）以生成配音");
      const response = await fetch(`${config.baseUrl}/audio/speech`, {
        method: "POST",
        signal: timeout(),
        headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: config.model,
          input: job.shot.dialogue,
          voice: shotVoice(job.shot),
          response_format: "mp3",
        }),
      });
      if (!response.ok) throw new Error(`配音服务请求失败 (${response.status})`);
      return {
        state: "done",
        bytes: new Uint8Array(await response.arrayBuffer()),
        extension: "mp3",
        provider: "openai",
      };
    }
    if (job.kind === "image" && imageProtocol() === "openai")
      return generateOpenAIImage(shotPrompt(job.shot), {
        aspectRatio: "16:9",
        referenceImageUrls: job.shot.referenceImages?.map((image) => image.url),
      });
    if (job.kind === "image" && job.shot.referenceImages?.length)
      throw new Error("当前 fal 图片模型未声明参考图协议，不能忽略角色参考图");
    const config = mediaConfig(job.kind);
    if (!config.apiKey)
      throw new Error(`请配置 ${job.kind.toUpperCase()}_API_KEY（兼容 FAL_API_KEY）`);
    let firstFrameUrl = job.inputImageUrl;
    if (job.kind === "video" && job.inputImageId) {
      const image = await readGeneratedMedia(job.inputImageId);
      if (!image) throw new Error("镜头依赖的图片文件不存在，请重新生成图片");
      if (image.bytes.length > 30 * 1024 * 1024)
        throw new Error("首帧图片超过生成服务的 30 MB 限制");
      firstFrameUrl = `data:${image.type};base64,${image.bytes.toString("base64")}`;
    }
    // Resolve last frame URL from local media store if stored as /api/media reference.
    let lastFrameUrl = job.lastFrameUrl;
    if (job.kind === "video" && lastFrameUrl?.startsWith("/api/media/")) {
      const match = lastFrameUrl.match(/^\/api\/media\/([\w-]{1,100})$/);
      if (match) {
        const media = await readGeneratedMedia(match[1]);
        if (!media) throw new Error("尾帧图片文件不存在，请重新生成共享帧");
        if (media.bytes.length > 30 * 1024 * 1024)
          throw new Error("尾帧图片超过生成服务的 30 MB 限制");
        lastFrameUrl = `data:${media.type};base64,${media.bytes.toString("base64")}`;
      }
    }
    if (job.kind === "video" && isVideoGateway(config))
      return submitGatewayVideo(
        {
          prompt: shotVideoPrompt(job.shot, Boolean(lastFrameUrl)),
          firstFrameUrl,
          lastFrameUrl,
          mode: lastFrameUrl ? "first-last-frame" : "image-to-video",
          duration: job.shot.duration <= 5 ? 5 : job.shot.duration <= 8 ? 8 : 10,
          generateAudio: false,
        },
        config,
      );
    const request =
      job.kind === "image"
        ? {
            endpoint: config.model,
            input: { prompt: shotPrompt(job.shot), image_size: "landscape_16_9", num_images: 1 },
          }
        : buildSeedanceRequest({
            prompt: shotVideoPrompt(job.shot, Boolean(lastFrameUrl)),
            firstFrameUrl,
            lastFrameUrl,
            // mode is auto-derived by buildSeedanceRequest: first-last-frame when both present
            model: "seedance-2-0",
            duration: job.shot.duration <= 5 ? 5 : job.shot.duration <= 8 ? 8 : 10,
            generateAudio: false,
          });
    const data = await json(
      await fetch(modelUrl(config, request.endpoint), {
        method: "POST",
        signal: timeout(),
        headers: { Authorization: `Key ${config.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(request.input),
      }),
    );
    if (!data.request_id) return output(job, data);
    const base = `${modelUrl(config, request.endpoint)}/requests/${encodeURIComponent(data.request_id)}`;
    return {
      state: "pending",
      task: {
        provider: "fal",
        requestId: data.request_id,
        statusUrl: providerUrl(data.status_url ?? `${base}/status`, config),
        resultUrl: providerUrl(data.response_url ?? base, config),
      },
    };
  },
  async poll(job) {
    const task = job.providerTask!;
    if (task.provider === "gateway") return pollGatewayVideo(task);
    if (task.provider === "mock") {
      if (Date.now() < (task.readyAt ?? 0)) return { state: "pending", task };
      let bytes: Uint8Array;
      if (job.kind === "image")
        bytes = Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
          "base64",
        );
      else if (job.kind === "video")
        bytes = await readFile(path.join(process.cwd(), "tests/fixtures/segment.mp4"));
      else {
        const frames = Math.ceil(job.shot.duration * 8000),
          wav = Buffer.alloc(44 + frames * 2);
        wav.write("RIFF");
        wav.writeUInt32LE(wav.length - 8, 4);
        wav.write("WAVEfmt ", 8);
        wav.writeUInt32LE(16, 16);
        wav.writeUInt16LE(1, 20);
        wav.writeUInt16LE(1, 22);
        wav.writeUInt32LE(8000, 24);
        wav.writeUInt32LE(16000, 28);
        wav.writeUInt16LE(2, 32);
        wav.writeUInt16LE(16, 34);
        wav.write("data", 36);
        wav.writeUInt32LE(frames * 2, 40);
        bytes = wav;
      }
      return {
        state: "done",
        bytes,
        extension: job.kind === "audio" ? "wav" : job.kind === "image" ? "png" : "mp4",
        provider: "mock",
        mock: true,
      };
    }
    if (job.kind === "audio") throw new Error("配音任务不支持 fal 轮询");
    const config = mediaConfig(job.kind);
    if (!config.apiKey) throw new Error(`恢复任务需要配置 ${job.kind.toUpperCase()}_API_KEY`);
    const headers = { Authorization: `Key ${config.apiKey}` };
    const data = await json(
      await fetch(providerUrl(task.statusUrl, config), { headers, signal: timeout() }),
    );
    if (data.status === "FAILED" || data.status === "CANCELLED" || data.error)
      throw new Error(`素材生成失败：${data.error ?? data.status}`);
    if (data.status !== "COMPLETED") return { state: "pending", task };
    return output(
      job,
      await json(await fetch(providerUrl(task.resultUrl, config), { headers, signal: timeout() })),
    );
  },
};
