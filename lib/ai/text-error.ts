import { CreationContentError } from "@/lib/story/content-policy";
import { APICallError } from "ai";
import type { TextProvider } from "./providers/text-provider";

function endpoint(value: string) {
  try {
    const url = new URL(value);
    return url.origin + url.pathname;
  } catch {
    return "未知地址";
  }
}
function responseType(error: APICallError) {
  const body = error.responseBody?.replace(/^\uFEFF/, "").trim() ?? "";
  const type =
    Object.entries(error.responseHeaders ?? {}).find(
      ([name]) => name.toLowerCase() === "content-type",
    )?.[1] ?? "";
  if (/text\/event-stream/i.test(type) || /^(?:data:|event:|:)/.test(body)) return "stream";
  if (/text\/html/i.test(type) || /^<(?:!doctype\s+html|html|head|body)\b/i.test(body))
    return "html";
  if (!body) return "empty";
  try {
    JSON.parse(body);
    return "json";
  } catch {
    return "text";
  }
}
/** Diagnose the transport envelope, without exposing keys, prompts or upstream response bodies. */
export function textGenerationError(error: unknown, provider?: Pick<TextProvider, "id" | "name">) {
  if (error instanceof CreationContentError) return { error: error.message, code: error.code };
  if (error instanceof Error && error.name === "TimeoutError") {
    return {
      error: "文本模型生成超时，本次结果未应用。请稍后重试，或减少故事长度与决策点。",
      code: "TEXT_GENERATION_TIMEOUT",
    };
  }
  if (!APICallError.isInstance(error)) {
    return { error: error instanceof Error ? error.message : "文字生成失败，请重试。" };
  }
  const type = responseType(error);
  let message: string;
  if (error.message === "Invalid JSON response") {
    message =
      type === "stream"
        ? "文本接口返回了 SSE 流，但当前请求需要非流式 JSON。请检查代理是否正确处理 stream:false。"
        : type === "html"
          ? "文本接口返回了 HTML 页面，未返回模型结果。请检查代理路由、登录拦截或网关错误页。"
          : type === "json"
            ? `文本接口返回了 JSON，但结构不符合 ${provider?.id === "anthropic" ? "Anthropic Messages" : "OpenAI Chat Completions"} 协议。请检查代理的响应封装和 TEXT_PROVIDER。`
            : type === "empty"
              ? "文本接口返回了空响应，请检查模型服务或代理。"
              : "文本接口返回的内容无法解析为 JSON，请检查模型服务或代理的响应格式。";
  } else {
    message =
      error.statusCode === 401
        ? "文本服务拒绝认证，请检查 TEXT_API_KEY。"
        : error.statusCode === 403
          ? "文本服务拒绝访问，请检查密钥权限和代理访问限制。"
          : error.statusCode === 404
            ? "文本接口或模型不存在，请检查 TEXT_BASE_URL、TEXT_MODEL 和代理路由。"
            : error.statusCode === 429
              ? "文本服务请求受限，请检查配额或稍后重试。"
              : "文本服务调用失败，请检查代理和模型服务状态。";
  }
  const details = {
    provider: provider?.id,
    model: provider?.name,
    endpoint: endpoint(error.url),
    status: error.statusCode,
    responseType: type,
  };
  return {
    error: `${message} 请求地址：${details.endpoint}${details.status === undefined ? "" : `；上游状态：${details.status}`}。`,
    code: "TEXT_UPSTREAM_ERROR",
    details,
  };
}
