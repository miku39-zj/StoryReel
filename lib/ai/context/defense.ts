import type { CoreMessage } from "ai";

// Conservative for multilingual scripts, and includes tool arguments/results and message overhead.
export function estimateTokens(messages: CoreMessage[]): number {
  const serialized = JSON.stringify(messages);
  const nonAscii = Array.from(serialized).filter((char) => char.codePointAt(0)! > 127).length;
  return Math.ceil((serialized.length - nonAscii) / 3) + nonAscii * 2;
}

function clearResult(message: CoreMessage): CoreMessage {
  if (message.role !== "tool") return message;
  if (
    message.content.every(
      (part) =>
        typeof part.result === "object" &&
        part.result !== null &&
        "compacted" in part.result &&
        part.result.compacted === true,
    )
  )
    return message;
  return {
    ...message,
    content: message.content.map((part) => ({
      ...part,
      result: { compacted: true, message: "旧工具结果已清理；需要时重新获取，不要推测缺失内容。" },
    })),
  };
}

export function microcompact(messages: CoreMessage[]) {
  const indices = messages.flatMap((message, index) => (message.role === "tool" ? [index] : []));
  const old = new Set(indices.slice(0, -3));
  let cleared = 0;
  const result = messages.map((message, index) => {
    const next = old.has(index) ? clearResult(message) : message;
    if (next !== message) cleared++;
    return next;
  });
  return { messages: result, cleared };
}

export function enforceContextBudget(
  messages: CoreMessage[],
  contextWindow = 128_000,
  reservedTokens = 0,
) {
  const budget = Math.floor(contextWindow * 0.75) - reservedTokens;
  const result = [...messages];
  let compacted = 0;
  for (let i = 0; i < result.length && estimateTokens(result) > budget; i++) {
    if (result[i].role !== "tool") continue;
    const next = clearResult(result[i]);
    if (next !== result[i]) compacted++;
    result[i] = next;
  }
  if (estimateTokens(result) > budget)
    throw new Error("上下文超过模型预算，请缩小场景范围或开始新会话");
  return { messages: result, compacted };
}

export function applyContextDefense(
  messages: CoreMessage[],
  contextWindow = 128_000,
  reservedTokens = 0,
) {
  const { messages: recent, cleared } = microcompact(messages);
  const { messages: defended, compacted } = enforceContextBudget(
    recent,
    contextWindow,
    reservedTokens,
  );
  return { messages: defended, tokenEstimate: estimateTokens(defended), cleared, compacted };
}
