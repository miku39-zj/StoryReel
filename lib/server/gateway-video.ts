import { mediaConfig, type ModelConfig } from "@/lib/ai/model-config";
import { readProviderJSON, providerMessage } from "./provider-json";
import { resolveProviderMedia } from "./provider-media";
import { TerminalTaskError } from "@/lib/generation/lifecycle";
import type { ProviderTask } from "@/lib/production/types";
import type { GenerationResult } from "./generation-provider";
import { z } from "zod";

interface GatewayVideoInput {
  prompt: string;
  mode?: string;
  firstFrameUrl?: string;
  lastFrameUrl?: string;
  referenceImageUrls?: string[];
  referenceVideoUrls?: string[];
  duration?: number;
  aspectRatio?: string;
  resolution?: string;
  generateAudio?: boolean;
}
const settings = z.object({
  prompt: z.string().trim().min(1),
  duration: z.union([z.literal(5), z.literal(8), z.literal(10)]).default(5),
  aspectRatio: z.enum(["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "adaptive"]).default("16:9"),
  resolution: z.enum(["480p", "720p", "1080p"]).default("720p"),
  generateAudio: z.boolean().optional(),
});
export function isVideoGateway(config: ModelConfig = mediaConfig("video")) {
  return /\/videos\/generations\/?$/.test(new URL(config.baseUrl).pathname);
}
function queryUrl(config: ModelConfig) {
  if (!isVideoGateway(config)) throw new Error("视频网关地址必须以 /videos/generations 结尾");
  return config.baseUrl.replace(/\/videos\/generations\/?$/, "/videos/tasks/query");
}
export function gatewayTask(
  requestId: string,
  config: ModelConfig = mediaConfig("video"),
): ProviderTask {
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(requestId)) throw new Error("网关返回了无效任务 ID");
  return { provider: "gateway", requestId, statusUrl: queryUrl(config), resultUrl: "" };
}
function material(value: string, type: "image" | "video", role: string) {
  // Local application URLs are accepted during preflight and resolved only at submission.
  const local = /^\/api\/media\/[\w-]{1,100}$/.test(value);
  const inline = value.match(/^data:(image\/(?:png|jpeg|webp));base64,[A-Za-z0-9+/]+=*$/);
  if (!local && !inline) {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
      throw new Error("参考素材必须为有效的图片或视频地址");
  }
  const extension = value
    .split("?")[0]
    .match(/\.(png|jpe?g|webp|mov|mp4)$/i)?.[1]
    .toLowerCase();
  const mimeType =
    inline?.[1] ??
    (type === "video"
      ? extension === "mov"
        ? "video/quicktime"
        : "video/mp4"
      : extension === "jpg" || extension === "jpeg"
        ? "image/jpeg"
        : extension === "webp"
          ? "image/webp"
          : "image/png");
  return { type, role, value, mimeType };
}
/** Gateway wire protocol only; task persistence and result application belong to the workers. */
export function buildGatewayVideoRequest(
  input: GatewayVideoInput,
  config: ModelConfig = mediaConfig("video"),
) {
  const parsed = settings.parse(input);
  const frames = !!(input.firstFrameUrl || input.lastFrameUrl);
  const references = !!(input.referenceImageUrls?.length || input.referenceVideoUrls?.length);
  if (frames && references) throw new Error("首尾帧模式不能混用参考图片或参考视频");
  if (input.lastFrameUrl && !input.firstFrameUrl) throw new Error("尾帧需要同时连接首帧图片");
  const generationMode = input.lastFrameUrl
    ? "first_last_frame"
    : input.firstFrameUrl
      ? "image_to_video"
      : references
        ? "reference_to_video"
        : "text_to_video";
  const modes: Record<string, string> = {
    "text-to-video": "text_to_video",
    "image-to-video": "image_to_video",
    "first-last-frame": "first_last_frame",
    "reference-to-video": "reference_to_video",
  };
  if (input.mode && modes[input.mode] !== generationMode)
    throw new Error("生成模式与已连接的素材不一致");
  const materialList = [
    ...(input.firstFrameUrl ? [material(input.firstFrameUrl, "image", "first_frame")] : []),
    ...(input.lastFrameUrl ? [material(input.lastFrameUrl, "image", "last_frame")] : []),
    ...(input.referenceImageUrls ?? []).map((url) => material(url, "image", "reference_image")),
    ...(input.referenceVideoUrls ?? []).map((url) => material(url, "video", "reference_video")),
  ];
  return {
    model: config.model,
    generationMode,
    prompt: parsed.prompt,
    durationSeconds: parsed.duration,
    // Seedance 2.5 requires adaptive for first-frame and first/last-frame inputs.
    aspectRatio: frames && config.model === "doubao-seedance-2-5" ? "adaptive" : parsed.aspectRatio,
    resolution: parsed.resolution,
    ...(parsed.generateAudio === undefined ? {} : { generateAudio: parsed.generateAudio }),
    ...(materialList.length ? { materialList } : {}),
  };
}
interface GatewayTaskData {
  taskId?: string;
  status?: string;
  error?: { message?: string };
  errorMsg?: string;
  videos?: Array<{ url?: string }>;
  videoUrl?: string;
  outputParams?: Array<{ videoUrl?: string }>;
}

function accepted(envelope: { success?: boolean; code?: number; data?: GatewayTaskData }) {
  if (envelope?.success !== true || envelope.code !== 200 || !envelope.data)
    throw new Error("网关响应缺少成功状态或任务数据，请勿直接重复提交");
  return envelope.data;
}
export async function submitGatewayVideo(
  input: GatewayVideoInput,
  config: ModelConfig = mediaConfig("video"),
): Promise<GenerationResult> {
  buildGatewayVideoRequest(input, config);
  if (!config.apiKey) throw new Error("请配置 VIDEO_API_KEY");
  const resolved = await resolveProviderMedia(input as unknown as Record<string, unknown>);
  const body = buildGatewayVideoRequest(resolved as unknown as GatewayVideoInput, config);
  const response = await fetch(config.baseUrl, {
    method: "POST",
    signal: AbortSignal.timeout(60000),
    headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = accepted(await readProviderJSON(response));
  if (typeof data.taskId !== "string")
    throw new Error("网关未返回 data.taskId，提交结果未知，请勿直接重复提交");
  return { state: "pending", task: gatewayTask(data.taskId, config) };
}
export async function pollGatewayVideo(
  task: ProviderTask,
  config: ModelConfig = mediaConfig("video"),
): Promise<GenerationResult> {
  const recovered = gatewayTask(task.requestId, config);
  if (task.statusUrl && task.statusUrl !== recovered.statusUrl)
    throw new Error("任务查询地址与当前网关配置不匹配");
  const response = await fetch(recovered.statusUrl, {
    method: "POST",
    signal: AbortSignal.timeout(60000),
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ taskId: task.requestId }),
  });
  const data = accepted(await readProviderJSON(response));
  if (data.taskId !== task.requestId) throw new Error("网关查询返回了不匹配的任务 ID");
  if (data.status === "PENDING" || data.status === "RUNNING")
    return { state: "pending", task: recovered };
  if (data.status === "FAILED" || data.status === "UNKNOWN")
    throw new TerminalTaskError(
      `视频任务${data.status === "UNKNOWN" ? "不存在或已过期" : "失败"}：${providerMessage(data.error?.message ?? data.errorMsg ?? data.status)}`,
    );
  if (data.status !== "SUCCESS") throw new Error("网关返回了无法识别的任务状态");
  const url = data.videos?.[0]?.url ?? data.videoUrl ?? data.outputParams?.[0]?.videoUrl;
  if (typeof url !== "string" || !/^https?:\/\//.test(url))
    throw new Error("视频任务已成功，但未返回有效视频地址");
  return { state: "done", url, extension: "mp4", provider: "gateway" };
}
