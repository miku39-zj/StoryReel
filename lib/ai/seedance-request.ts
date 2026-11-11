import { z } from "zod";

const mediaUrl = z.string().refine((value) => {
  try {
    return ["https:", "http:", "data:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}, "素材地址必须是有效的图片或视频 URL");
export const seedanceSchema = z.object({
  nodeId: z.string().optional(),
  mode: z
    .enum(["text-to-video", "image-to-video", "first-last-frame", "reference-to-video"])
    .optional(),
  prompt: z.string().trim().min(1, "请填写提示词或连接文本输入"),
  firstFrameUrl: mediaUrl.optional(),
  lastFrameUrl: mediaUrl.optional(),
  referenceImageUrls: z.array(mediaUrl).max(9).default([]),
  referenceVideoUrls: z.array(mediaUrl).max(3).default([]),
  duration: z.union([z.literal(5), z.literal(8), z.literal(10)]).default(5),
  aspectRatio: z.enum(["16:9", "9:16", "1:1", "4:3", "3:4"]).default("16:9"),
  resolution: z.enum(["480p", "720p", "1080p"]).default("480p"),
  model: z.enum(["seedance-1-0-lite", "seedance-1-0-pro", "seedance-2-0"]).default("seedance-2-0"),
  generateAudio: z.boolean().default(false),
});

/** Maps graph inputs to fal's distinct frame and multimodal reference endpoints. */
export function buildSeedanceRequest(raw: unknown) {
  const data = seedanceSchema.parse(raw);
  const hasReferences = data.referenceImageUrls.length > 0 || data.referenceVideoUrls.length > 0;
  const mode = hasReferences
    ? "reference-to-video"
    : (data.mode ??
      (data.lastFrameUrl
        ? "first-last-frame"
        : data.firstFrameUrl
          ? "image-to-video"
          : "text-to-video"));
  if (mode === "text-to-video" && (data.firstFrameUrl || data.lastFrameUrl))
    throw new Error("文生视频不能携带首尾帧，请选择图生视频模式");
  if (hasReferences && (data.firstFrameUrl || data.lastFrameUrl))
    throw new Error("首尾帧与参考素材不能混用");
  if (mode === "reference-to-video" && !hasReferences) throw new Error("请连接参考图片或视频");
  if ((mode === "image-to-video" || mode === "first-last-frame") && !data.firstFrameUrl)
    throw new Error("请连接首帧图片");
  if (mode === "first-last-frame" && !data.lastFrameUrl) throw new Error("请连接尾帧图片");
  if ((mode === "reference-to-video" || !!data.lastFrameUrl) && data.model !== "seedance-2-0")
    throw new Error("多素材参考及首尾帧输入需要选择 Seedance 2.0");
  const endpointMode = mode === "first-last-frame" ? "image-to-video" : mode;
  const endpoint =
    data.model === "seedance-2-0"
      ? `bytedance/seedance-2.0/${endpointMode}`
      : `fal-ai/bytedance/seedance/v1/${data.model === "seedance-1-0-pro" ? "pro" : "lite"}/${endpointMode}`;
  const input: Record<string, unknown> = {
    prompt: data.prompt,
    duration: data.duration,
    aspect_ratio: data.aspectRatio,
    resolution: data.resolution,
    generate_audio: data.generateAudio,
  };
  if (mode === "reference-to-video") {
    if (data.referenceImageUrls.length) input.image_urls = data.referenceImageUrls;
    if (data.referenceVideoUrls.length) input.video_urls = data.referenceVideoUrls;
  } else if (mode !== "text-to-video") {
    input.image_url = data.firstFrameUrl;
    if (data.lastFrameUrl) input.end_image_url = data.lastFrameUrl;
  }
  return { endpoint, input };
}
