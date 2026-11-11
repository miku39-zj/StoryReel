import { parseModelJSON } from "./output-validation";
/** Read the complete UTF-8 HTTP result; callers validate and apply their own domain data. */
export async function readCreationJSON(
  response: Response,
  onChunk?: (text: string) => void,
): Promise<unknown> {
  if (!response.ok) {
    const failure = await response.json().catch(() => null);
    throw new Error(
      typeof failure?.error === "string" ? failure.error : `生成失败（HTTP ${response.status}）`,
    );
  }
  if (!response.body) throw new Error("生成服务未返回内容");
  const reader = response.body.getReader(),
    decoder = new TextDecoder("utf-8", { fatal: true });
  const streaming = response.headers.get("content-type")?.includes("application/x-ndjson");
  let text = "",
    pending = "",
    result: unknown,
    completed = false;
  const event = (line: string) => {
    if (!line.trim()) return;
    const data = JSON.parse(line);
    if (completed) throw new Error("生成服务在结果完成后返回了额外事件");
    if (data.type === "pending") return;
    if (data.type === "text" && typeof data.text === "string") {
      onChunk?.(data.text);
      return;
    }
    if (data.type === "error")
      throw new Error(typeof data.error === "string" ? data.error : "生成失败，请重试");
    if (data.type === "result" && "value" in data) {
      result = data.value;
      completed = true;
      return;
    }
    throw new Error("生成服务返回了无效事件");
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      const chunk = done ? decoder.decode() : decoder.decode(value, { stream: true });
      if (streaming) {
        pending += chunk;
        let newline;
        while ((newline = pending.indexOf("\n")) >= 0) {
          event(pending.slice(0, newline));
          pending = pending.slice(newline + 1);
        }
        if (done && pending) event(pending);
      } else {
        text += chunk;
        if (chunk) onChunk?.(chunk);
      }
      if (done) break;
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  if (streaming) {
    if (!completed) throw new Error("生成连接提前结束，草稿未应用，请重试。");
    return result;
  }
  return parseModelJSON(text);
}
