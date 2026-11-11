import { textConfig } from "@/lib/ai/model-config";
/**
 * Text Provider — 文本模型抽象层
 *
 * 统一文本模型接口，支持 OpenAI / Anthropic / DeepSeek。
 * 通过环境变量自动选择 provider，对上层透明。
 */

import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";

export type TextProviderId = "openai" | "anthropic" | "deepseek" | "mock";

export interface TextProvider {
  id: TextProviderId;
  model: LanguageModel;
  /** 模型显示名（用于 /context 视图） */
  name: string;
  /** 上下文窗口大小（tokens），用于 context defense */
  contextWindow: number;
}

/** Independent TEXT_* configuration takes precedence; legacy keys remain supported. */
export function createTextProvider(): TextProvider {
  const config = textConfig();
  if (config.apiKey) {
    const provider =
      config.provider === "anthropic"
        ? createAnthropic({ apiKey: config.apiKey, baseURL: config.baseUrl })
        : createOpenAI({ apiKey: config.apiKey, baseURL: config.baseUrl });
    return {
      id: config.provider,
      name: config.model,
      model: provider(config.model) as LanguageModel,
      contextWindow:
        configuredContextWindow() ??
        (config.provider === "anthropic"
          ? 200_000
          : config.provider === "deepseek"
            ? 64_000
            : 128_000),
    };
  }

  // ── Mock（无 key 时）───────────────────
  return {
    id: "mock",
    model: createMockModel(),
    name: "mock-model",
    contextWindow: 8_000,
  };
}

function configuredContextWindow() {
  const raw = process.env.TEXT_CONTEXT_WINDOW?.trim();
  if (!raw) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 16000 || value > 2000000)
    throw new Error("TEXT_CONTEXT_WINDOW 必须为 16000 至 2000000 的整数");
  return value;
}

/** 极简 mock model：不调 API，返回占位文本 */
function createMockModel(): LanguageModel {
  return {
    specificationVersion: "v1",
    provider: "mock",
    modelId: "mock-model",
    defaultObjectGenerationMode: "json" as const,
    doGenerate: async () => {
      return {
        text: "[Mock Model] 暂无可用 API Key。请配置 TEXT_API_KEY（也兼容 OPENAI_API_KEY、ANTHROPIC_API_KEY 或 DEEPSEEK_API_KEY）。",
        toolCalls: [],
        finishReason: "stop" as const,
        usage: { promptTokens: 10, completionTokens: 30 },
        rawCall: { rawPrompt: "", rawSettings: {} },
        warnings: [],
      };
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    doStream: async (options: any) => {
      const { prompt } = options;
      const lastMsg = prompt[prompt.length - 1];
      const userText = lastMsg?.content
        ? typeof lastMsg.content === "string"
          ? lastMsg.content
          : JSON.stringify(lastMsg.content)
        : "empty";

      const mockResponse = `[Mock Model] 暂无可用 API Key。请配置 TEXT_API_KEY（也兼容 OPENAI_API_KEY、ANTHROPIC_API_KEY 或 DEEPSEEK_API_KEY）。\n\n你的输入：${userText.slice(0, 200)}`;

      return {
        stream: new ReadableStream({
          start(controller) {
            for (const chunk of mockResponse.match(/.{1,4}/g) ?? []) {
              controller.enqueue({ type: "text-delta" as const, textDelta: chunk });
            }
            controller.enqueue({
              type: "finish" as const,
              finishReason: "stop" as const,
              usage: { promptTokens: 10, completionTokens: 30 },
            });
            controller.close();
          },
        }),
        rawCall: { rawPrompt: "", rawSettings: {} },
        warnings: [],
      };
    },
  } as unknown as LanguageModel;
}
