import {
  APICallError,
  JSONParseError,
  TypeValidationError,
  streamText,
  zodSchema,
  type CoreMessage,
  type ToolSet,
} from "ai";
import { z } from "zod";
import { applyContextDefense, estimateTokens } from "./context/defense";
import type { TextProvider } from "./providers/text-provider";

interface TextGenerationInput {
  provider: TextProvider;
  system?: string;
  prompt?: string;
  messages?: CoreMessage[];
  signal?: AbortSignal;
  timeoutMs?: number;
  maxTokens?: number;
  temperature?: number;
  tools?: ToolSet;
}
/** All model calls use SSE. Callers own prompts, time budgets, tools and domain validation. */
export function streamTextGeneration({
  provider,
  signal,
  timeoutMs = 120000,
  ...input
}: TextGenerationInput) {
  signal = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(timeoutMs)]);
  signal.throwIfAborted();
  input.maxTokens ??= 8000;
  const toolDefinitions = Object.entries(input.tools ?? {}).map(([name, tool]) => ({
    name,
    description: tool.description,
    parameters:
      tool.parameters instanceof z.ZodType
        ? zodSchema(tool.parameters).jsonSchema
        : tool.parameters.jsonSchema,
  }));
  const reserved =
    input.maxTokens +
    estimateTokens([
      ...(input.system ? [{ role: "system" as const, content: input.system }] : []),
      ...(toolDefinitions.length
        ? [{ role: "system" as const, content: JSON.stringify(toolDefinitions) }]
        : []),
    ]);
  const context = applyContextDefense(
    [
      ...(input.messages ?? []),
      ...(input.prompt ? [{ role: "user" as const, content: input.prompt }] : []),
    ],
    provider.contextWindow,
    reserved,
  );
  input.messages = context.messages;
  delete input.prompt;
  const result = streamText({
    ...input,
    model: provider.model,
    abortSignal: signal,
    maxRetries: 0,
    onError: () => {},
  });
  async function* checkedStream() {
    let completed = false;
    for await (const part of result.fullStream) {
      signal?.throwIfAborted();
      if (part.type === "error") {
        // Preserve transport errors for safe diagnostics and the Agent's explicit retry policy.
        if (APICallError.isInstance(part.error)) throw part.error;
        if (
          part.error instanceof Error &&
          !JSONParseError.isInstance(part.error) &&
          !TypeValidationError.isInstance(part.error)
        )
          throw part.error;
        throw new Error("文本流生成失败或响应格式不正确，请检查代理的流式响应后重试。");
      }
      if (part.type === "finish")
        completed = ["stop", "length", "tool-calls"].includes(part.finishReason);
      yield part;
    }
    signal?.throwIfAborted();
    if (!completed)
      throw new Error("文本流未正常结束，请检查代理是否返回完整的 finish_reason 后重试。");
  }
  return {
    context,
    fullStream: checkedStream(),
    get response() {
      return result.response;
    },
    get usage() {
      return result.usage;
    },
  };
}
/** Aggregate one checked stream. No output is applied until the caller validates the complete draft. */
export async function generateTextDraft({
  onChunk,
  ...input
}: Omit<TextGenerationInput, "tools"> & { onChunk?: (text: string) => void }) {
  const result = streamTextGeneration(input);
  let text = "";
  for await (const part of result.fullStream)
    if (part.type === "text-delta") {
      text += part.textDelta;
      onChunk?.(part.textDelta);
    }
  if (!text.trim()) throw new Error("未生成有效内容，请重试。");
  return { text: text.trim(), usage: await result.usage };
}
