/**
 * 统一 Agent API — POST /api/ai/agent
 *
 * 重构后使用 AgentHarness 编排：
 *   TextProvider → ToolRegistry → PromptBuilder → agentLoop
 *
 * Body: { task, context, messages? }
 * Response: SSE stream of AgentEvent
 */

import type { CoreMessage } from "ai";
import { textGenerationError } from "@/lib/ai/text-error";
import { z } from "zod";
import { createTextProvider } from "@/lib/ai/providers/text-provider";
import { AgentHarness, agentEventsToSSE, type AgentTask } from "@/lib/ai/agent-loop";
import { buildRegistry } from "@/lib/ai/tools/tool-sets";
import { createDefaultPromptBuilder } from "@/lib/ai/context/prompt-pipes";

const RequestSchema = z.object({
  task: z.enum(["story", "branch", "storyboard", "visual", "video"]),
  context: z.record(z.unknown()).optional(),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string(),
      }),
    )
    .optional(),
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = RequestSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { task, context = {}, messages: userMessages = [] } = parsed.data;

  // ── Build harness ────────────────────────────────
  let textProvider: ReturnType<typeof createTextProvider>;
  try {
    textProvider = createTextProvider();
  } catch (error) {
    return Response.json(textGenerationError(error), { status: 502 });
  }
  if (textProvider.id === "mock")
    return Response.json(
      {
        error: "请配置 TEXT_API_KEY（兼容 OPENAI_API_KEY、ANTHROPIC_API_KEY 或 DEEPSEEK_API_KEY）",
      },
      { status: 503 },
    );
  let registry;
  try {
    registry = buildRegistry(task);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "生成服务未配置" },
      { status: 503 },
    );
  }
  const promptBuilder = createDefaultPromptBuilder();
  const harness = new AgentHarness(textProvider, registry, promptBuilder);

  // ── Build messages ───────────────────────────────
  const messages: CoreMessage[] = userMessages
    .filter((m): m is typeof m & { role: "user" | "assistant" | "system" } =>
      ["user", "assistant", "system"].includes(m.role),
    )
    .map((m) => ({ role: m.role as "user" | "assistant" | "system", content: m.content }));

  if (messages.length === 0) {
    const autoPrompt = buildAutoPrompt(task, context);
    if (autoPrompt) messages.push({ role: "user", content: autoPrompt });
  }

  // ── Run ──────────────────────────────────────────
  const abort = new AbortController();
  const signal = AbortSignal.any([request.signal, abort.signal]);
  const events = harness.run({
    task: task as AgentTask,
    messages,
    projectContext: context,
    signal,
  });
  const stream = agentEventsToSSE(events, abort);

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

/** 当没有 messages 时，根据 task 和 context 自动生成触发 prompt */
function buildAutoPrompt(task: string, context: Record<string, unknown>): string | null {
  switch (task) {
    case "story":
      if (!context.prompt) return null;
      return `请根据以下创意创作互动故事：\n创意：${context.prompt}\n类型：${context.genre ?? "悬疑"}\n分支数量：${context.numBranches ?? 2}`;

    case "branch":
      if (!context.scenes) return null;
      return `请为以下故事设计分支剧情：\n故事标题：${context.storyTitle ?? "未命名"}\n场景列表：${JSON.stringify(context.scenes, null, 2)}`;

    case "storyboard":
      if (!context.scenes) return null;
      return `请为以下场景生成分镜脚本：\n${JSON.stringify(context.scenes, null, 2)}`;

    case "visual":
      if (!context.scenes) return null;
      return `请为以下场景生成参考图片（风格：${context.style ?? "cinematic"}）：\n${JSON.stringify(context.scenes, null, 2)}`;

    case "video":
      if (!context.scenes) return null;
      return `请为以下场景提交视频生成任务：\n${JSON.stringify(context.scenes, null, 2)}`;

    default:
      return null;
  }
}
