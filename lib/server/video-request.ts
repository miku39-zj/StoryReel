import { buildSeedanceRequest, seedanceSchema } from "@/lib/ai/seedance-request";
import { mediaConfig, modelUrl, type ModelConfig } from "@/lib/ai/model-config";

/** Reject a known incompatible gateway before creating or charging any generation task. */
export function assertVideoTransport(config: ModelConfig = mediaConfig("video")) {
  if (/\/videos\/generations\/?$/.test(new URL(config.baseUrl).pathname)) {
    throw new Error("该直连接口仅支持 fal，请通过画布或逐镜后台任务使用通用视频网关。");
  }
}

/** The configured video model overrides node defaults. Custom endpoints use Seedance-compatible inputs. */
export function buildConfiguredVideoRequest(raw: unknown) {
  const config = mediaConfig("video");
  assertVideoTransport(config);
  const explicit = process.env.VIDEO_MODEL?.trim();
  const known = seedanceSchema.shape.model.safeParse(config.model);
  const request = buildSeedanceRequest({
    ...(raw as object),
    ...(known.success && explicit ? { model: known.data } : {}),
  });
  if (explicit && !known.success) request.endpoint = config.model;
  modelUrl(config, request.endpoint);
  return request;
}
