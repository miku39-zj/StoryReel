/**
 * Media Tools — 图片/视频生成工具集（重构版）
 *
 * 使用新版 ToolDefinition + provider 依赖注入。
 * ImageProvider 和 VideoProvider 通过 ToolDeps 注入，不再硬编码 API key。
 */

import { z } from "zod";
import type { ToolDefinition } from "./registry";

// ── 图片生成工具 ──────────────────────────────────────────────

export const generateImageTool: ToolDefinition = {
  name: "generate_image",
  description: "根据场景描述生成图片（用于视频节点的缩略图或参考图），返回图片 URL",
  profiles: ["visual", "storyboard"],
  isConcurrencySafe: true,
  preserveResult: true,
  schema: z.object({
    prompt: z.string().describe("英文图片描述，越详细越好"),
    sceneId: z.string().describe("对应的场景 ID"),
    style: z
      .enum(["cinematic", "anime", "realistic", "illustration"])
      .optional()
      .describe("图片风格"),
    aspectRatio: z.enum(["16:9", "1:1", "9:16", "4:3"]).optional().describe("宽高比，默认 16:9"),
  }),
  execute: async ({ prompt, sceneId, style, aspectRatio }, deps) => {
    const imageProvider = deps?.imageProvider;
    if (!imageProvider) {
      throw new Error("图片生成服务未配置");
    }

    try {
      const result = await imageProvider.generate(
        {
          signal: deps?.signal,
          prompt: prompt as string,
          style: style as "cinematic" | undefined,
          aspectRatio: aspectRatio as "16:9" | undefined,
        },
        sceneId as string,
      );
      return JSON.stringify({
        sceneId,
        imageUrl: result.url,
        provider: result.provider,
        status: result.isMock ? "placeholder" : "done",
      });
    } catch (err) {
      throw new Error(`图片生成失败：${(err as Error).message}`);
    }
  },
};

// ── 视频提交工具 ──────────────────────────────────────────────

export const submitVideoJobTool: ToolDefinition = {
  name: "submit_video_job",
  description:
    "提交视频生成任务，返回任务 ID。视频生成需要 1-3 分钟，提交后用 poll_video_job 轮询状态",
  profiles: ["video"],
  isConcurrencySafe: false,
  preserveResult: true,
  schema: z.object({
    sceneId: z.string().describe("场景 ID"),
    prompt: z.string().describe("视频场景描述（中文）"),
    imageUrl: z.string().optional().describe("参考图片 URL（图生视频）"),
    duration: z.number().optional().describe("视频时长（秒），默认 5"),
    aspectRatio: z.enum(["16:9", "9:16", "1:1"]).optional().describe("宽高比"),
  }),
  execute: async ({ sceneId, prompt, imageUrl, duration, aspectRatio }, deps) => {
    const videoProvider = deps?.videoProvider;
    if (!videoProvider) throw new Error("视频生成服务未配置");

    try {
      const job = await videoProvider.submit(
        {
          signal: deps?.signal,
          prompt: prompt as string,
          mode: imageUrl ? "image-to-video" : "text-to-video",
          firstFrameUrl: imageUrl as string | undefined,
          duration: (duration ?? 5) as 5 | 8 | 10,
          aspectRatio: (aspectRatio ?? "16:9") as "16:9",
        },
        sceneId as string,
      );
      return JSON.stringify({ sceneId, ...job });
    } catch (err) {
      throw new Error(`视频提交失败：${(err as Error).message}`);
    }
  },
};

// ── 视频轮询工具 ──────────────────────────────────────────────

export const pollVideoJobTool: ToolDefinition = {
  name: "poll_video_job",
  description: "查询视频生成任务状态，返回状态和视频 URL（如果已完成）",
  profiles: ["video"],
  isConcurrencySafe: true,
  preserveResult: true,
  schema: z.object({
    jobId: z.string().describe("任务 ID"),
    endpoint: z.string().optional(),
    videoUrl: z.string().url().optional(),
    provider: z.enum(["seedance", "kling", "runway", "mock"]).describe("提供商"),
    sceneId: z.string().describe("场景 ID"),
  }),
  execute: async ({ jobId, provider, sceneId, endpoint, videoUrl }, deps) => {
    const videoProvider = deps?.videoProvider;
    if (!videoProvider) throw new Error("视频生成服务未配置");

    try {
      const status = await videoProvider.poll({
        signal: deps?.signal,
        jobId: jobId as string,
        provider: provider as "seedance",
        status: "submitted",
        endpoint: endpoint as string | undefined,
        videoUrl: videoUrl as string | undefined,
      });
      if (status.status === "done" && !status.videoUrl) throw new Error("视频已完成但没有返回地址");
      return JSON.stringify({
        sceneId,
        ...status,
        status:
          status.provider === "mock" && status.status === "done" ? "placeholder" : status.status,
      });
    } catch (err) {
      throw new Error(`视频查询失败：${(err as Error).message}`);
    }
  },
};

export const mediaTools: ToolDefinition[] = [
  generateImageTool,
  submitVideoJobTool,
  pollVideoJobTool,
];
