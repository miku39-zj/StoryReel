/** Server-side model configuration. Never expose this object in an API response. */
export type TextProtocol = "openai" | "anthropic" | "deepseek";
export interface ModelConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}
function env(name: string) {
  return process.env[name]?.trim() || undefined;
}
function baseUrl(value: string) {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("模型 Base URL 必须为不含账号、查询参数和片段的 HTTP(S) 地址");
  return url.href.replace(/\/+$/, "");
}
export function textConfig(): ModelConfig & { provider: TextProtocol } {
  const provider =
    env("TEXT_PROVIDER") ??
    (env("TEXT_API_KEY") || env("TEXT_BASE_URL") || env("TEXT_MODEL")
      ? "openai"
      : env("ANTHROPIC_API_KEY")
        ? "anthropic"
        : env("OPENAI_API_KEY")
          ? "openai"
          : env("DEEPSEEK_API_KEY")
            ? "deepseek"
            : "openai");
  if (!["openai", "anthropic", "deepseek"].includes(provider))
    throw new Error("TEXT_PROVIDER 支持 openai、anthropic、deepseek");
  const legacy =
    provider === "anthropic" ? "ANTHROPIC" : provider === "deepseek" ? "DEEPSEEK" : "OPENAI";
  return {
    provider: provider as TextProtocol,
    apiKey: env("TEXT_API_KEY") ?? env(`${legacy}_API_KEY`) ?? "",
    baseUrl: baseUrl(
      env("TEXT_BASE_URL") ??
        env(`${legacy}_BASE_URL`) ??
        (provider === "anthropic"
          ? "https://api.anthropic.com/v1"
          : provider === "deepseek"
            ? "https://api.deepseek.com"
            : "https://api.openai.com/v1"),
    ),
    model:
      env("TEXT_MODEL") ??
      env("MODEL_NAME") ??
      (provider === "anthropic"
        ? "claude-opus-5-5"
        : provider === "deepseek"
          ? "deepseek-chat"
          : "gpt-4o"),
  };
}
export function mediaConfig(kind: "image" | "video"): ModelConfig {
  const prefix = kind.toUpperCase();
  return {
    apiKey:
      env(`${prefix}_API_KEY`) ??
      (kind === "video" || imageProtocol() === "fal" ? env("FAL_API_KEY") : undefined) ??
      "",
    baseUrl: baseUrl(env(`${prefix}_BASE_URL`) ?? "https://queue.fal.run"),
    model:
      env(`${prefix}_MODEL`) ??
      (kind === "image"
        ? imageProtocol() === "openai"
          ? "gpt-image-1"
          : "fal-ai/flux/schnell"
        : "seedance-2-0"),
  };
}
/** Explicit protocol wins; full OpenAI image endpoints are recognized for existing configurations. */
export function imageProtocol(): "fal" | "openai" {
  const value =
    env("IMAGE_PROVIDER") ??
    (/\/images\/generations\/?$/.test(baseUrl(env("IMAGE_BASE_URL") ?? "https://queue.fal.run"))
      ? "openai"
      : "fal");
  if (value !== "fal" && value !== "openai") throw new Error("IMAGE_PROVIDER 支持 fal、openai");
  return value;
}
export function imageEndpoint(config = mediaConfig("image")) {
  return /\/images\/generations$/.test(config.baseUrl)
    ? config.baseUrl
    : `${config.baseUrl}/images/generations`;
}
export function audioConfig(): ModelConfig {
  return {
    apiKey: env("AUDIO_API_KEY") ?? env("OPENAI_API_KEY") ?? "",
    baseUrl: baseUrl(env("AUDIO_BASE_URL") ?? "https://api.openai.com/v1"),
    model: env("AUDIO_MODEL") ?? "tts-1",
  };
}
/** URLs returned by a provider may only receive credentials within its configured base path. */
export function providerUrl(value: string, config: Pick<ModelConfig, "baseUrl">) {
  const url = new URL(value),
    base = new URL(config.baseUrl);
  const prefix = base.pathname.replace(/\/+$/, "");
  if (
    url.origin !== base.origin ||
    url.username ||
    url.password ||
    url.hash ||
    (prefix && url.pathname !== prefix && !url.pathname.startsWith(prefix + "/"))
  )
    throw new Error("生成服务任务地址与配置的 Base URL 不匹配");
  return url.href;
}
export function modelUrl(config: ModelConfig, endpoint = config.model) {
  if (
    !/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_.-]+)*$/.test(endpoint) ||
    endpoint.split("/").some((s) => s === "." || s === "..")
  )
    throw new Error("生成模型必须为有效的模型端点路径");
  return providerUrl(`${config.baseUrl}/${endpoint}`, config);
}

/** Optional complete edit endpoint for gateways that route image editing separately. */
export function imageEditEndpoint(config = mediaConfig("image")) {
  const configured = env("IMAGE_EDIT_BASE_URL");
  return configured
    ? baseUrl(configured)
    : imageEndpoint(config).replace(/\/images\/generations$/, "/images/edits");
}
