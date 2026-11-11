import { describeGenerationError } from "@/lib/generation/errors";
import { TerminalTaskError } from "@/lib/generation/lifecycle";

/** Transport status and business status are independent. Never treat HTTP 200 alone as success. */
export async function readProviderJSON(response: Response) {
  if (!response.ok) throw new Error(`生成服务请求失败（HTTP ${response.status}）`);
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error("生成服务未返回有效 JSON，请检查接口协议和代理响应格式");
  }
  if (data?.success === false) {
    const message = providerMessage(data.message);
    const ErrorType =
      describeGenerationError(message).retryable === false ? TerminalTaskError : Error;
    throw new ErrorType(`生成服务业务失败：${message}`);
  }
  return data;
}

/** Keep diagnostics useful without leaking configured credentials. */
export function providerMessage(value: unknown) {
  let message = typeof value === "string" ? value.slice(0, 500) : "请求被拒绝";
  for (const name of ["VIDEO_API_KEY", "IMAGE_API_KEY", "AUDIO_API_KEY", "FAL_API_KEY"]) {
    const secret = process.env[name];
    if (secret) message = message.split(secret).join("[已隐藏密钥]");
  }
  return message;
}
