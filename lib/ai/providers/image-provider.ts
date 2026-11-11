import { generateOpenAIImage } from "@/lib/server/openai-image";
import { storeGeneratedMedia } from "@/lib/server/generated-media";
import { randomUUID } from "node:crypto";
import {
  mediaConfig,
  imageProtocol,
  modelUrl,
  providerUrl,
  type ModelConfig,
} from "@/lib/ai/model-config";
/**
 * Image Provider — 图片模型抽象层
 *
 * 使用独立 IMAGE_* 配置的 fal 兼容接口。
 * 仅显式 mock 模式返回占位图。
 */

export type ImageProviderId = "fal" | "openai" | "mock";

export interface ImageGenerateParams {
  prompt: string;
  referenceImageUrls?: string[];
  signal?: AbortSignal;
  style?: "cinematic" | "anime" | "realistic" | "illustration";
  aspectRatio?: "16:9" | "1:1" | "9:16" | "4:3";
}

export interface ImageGenerateResult {
  url: string;
  provider: ImageProviderId;
  isMock: boolean;
}

export interface ImageProvider {
  id: ImageProviderId;
  generate(params: ImageGenerateParams, seedId?: string): Promise<ImageGenerateResult>;
}

// ── fal.ai Implementation ───────────────────────────────────────

class FalImageProvider implements ImageProvider {
  readonly id = "fal" as const;
  constructor(private config: ModelConfig) {}

  async generate(params: ImageGenerateParams): Promise<ImageGenerateResult> {
    if (params.referenceImageUrls?.length)
      throw new Error("当前 fal 图片模型未声明参考图协议，不能忽略参考图生成");
    const stylePrefix =
      params.style === "anime"
        ? "anime style, "
        : params.style === "cinematic"
          ? "cinematic photography, film grain, "
          : params.style === "illustration"
            ? "digital illustration, "
            : "photorealistic, ";

    const sizeMap: Record<string, string> = {
      "16:9": "landscape_16_9",
      "1:1": "square",
      "9:16": "portrait_16_9",
      "4:3": "landscape_4_3",
    };

    const res = await fetch(modelUrl(this.config), {
      method: "POST",
      signal: params.signal,
      headers: {
        Authorization: `Key ${this.config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: `${stylePrefix}${params.prompt}`,
        image_size: sizeMap[params.aspectRatio ?? "16:9"] ?? "landscape_16_9",
        num_inference_steps: 4,
        num_images: 1,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`fal.ai error ${res.status}: ${err}`);
    }

    let data = await res.json();
    if (data.request_id) {
      const base = `${modelUrl(this.config)}/requests/${encodeURIComponent(data.request_id)}`;
      const statusUrl = providerUrl(data.status_url ?? `${base}/status`, this.config);
      const resultUrl = providerUrl(data.response_url ?? base, this.config);
      let completed = false;
      for (let attempt = 0; attempt < 60; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        params.signal?.throwIfAborted();
        const response = await fetch(statusUrl, {
          signal: params.signal,
          headers: { Authorization: `Key ${this.config.apiKey}` },
        });
        if (!response.ok) throw new Error(`图片任务轮询失败 ${response.status}`);
        const status = await response.json();
        if (status.status === "FAILED" || status.status === "CANCELLED" || status.error)
          throw new Error("图片生成失败");
        if (status.status === "COMPLETED") {
          const result = await fetch(resultUrl, {
            signal: params.signal,
            headers: { Authorization: `Key ${this.config.apiKey}` },
          });
          if (!result.ok) throw new Error(`图片结果获取失败 ${result.status}`);
          data = await result.json();
          completed = true;
          break;
        }
      }
      if (!completed) throw new Error("图片生成超时");
    }
    const url = data.images?.[0]?.url;
    if (!url) throw new Error("生成服务未返回图片地址");

    return { url, provider: "fal", isMock: false };
  }
}

class OpenAIImageProvider implements ImageProvider {
  readonly id = "openai" as const;
  constructor(private config: ModelConfig) {}
  async generate(params: ImageGenerateParams): Promise<ImageGenerateResult> {
    const result = await generateOpenAIImage(
      `${params.style ?? "cinematic"}\n${params.prompt}`,
      params,
      this.config,
    );
    return {
      url: await storeGeneratedMedia(randomUUID(), result),
      provider: "openai",
      isMock: false,
    };
  }
}

// ── Mock Implementation ─────────────────────────────────────────

class MockImageProvider implements ImageProvider {
  readonly id = "mock" as const;

  async generate(_params: ImageGenerateParams, seedId = "scene"): Promise<ImageGenerateResult> {
    return {
      url: `https://picsum.photos/seed/${seedId}/800/450`,
      provider: "mock",
      isMock: true,
    };
  }
}

// ── Factory ─────────────────────────────────────────────────────

export function createImageProvider(): ImageProvider {
  const config = mediaConfig("image");
  if (config.apiKey)
    return imageProtocol() === "openai"
      ? new OpenAIImageProvider(config)
      : new FalImageProvider(config);
  if (process.env.STORYREEL_GENERATION_MODE === "mock") return new MockImageProvider();
  return {
    id: "fal",
    generate: async () => {
      throw new Error("请配置 IMAGE_API_KEY（兼容 FAL_API_KEY）后生成图片");
    },
  };
}
