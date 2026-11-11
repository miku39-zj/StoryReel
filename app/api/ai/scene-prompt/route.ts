import { assertCreationContent, CREATION_CONTENT_RULES } from "@/lib/story/content-policy";
/**
 * AI Scene Prompt Route — 为单个视频节点生成详细的场景描述
 *
 * POST /api/ai/scene-prompt
 * Body: { nodeTitle: string, context: string, style?: string }
 * Response: plain text collected from the upstream SSE.
 */
import { generateTextDraft } from "@/lib/ai/text-generation";
import { textGenerationError } from "@/lib/ai/text-error";
import { createTextProvider } from "@/lib/ai/providers/text-provider";
import { z } from "zod";
const RequestSchema = z.object({
  nodeTitle: z.string().min(1),
  context: z.string(), // 前后剧情上下文
  style: z.string().optional().default("写实电影"),
});
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
  const { nodeTitle, context, style } = parsed.data;
  let provider: ReturnType<typeof createTextProvider> | undefined;
  try {
    provider = createTextProvider();
    if (provider.id === "mock")
      return Response.json({ error: "请先配置文本生成服务" }, { status: 503 });
    const { text } = await generateTextDraft({
      provider,
      signal: request.signal,
      messages: [
        {
          role: "system",
          content:
            CREATION_CONTENT_RULES +
            "\n你是一位专业的影视分镜师，擅长将剧情场景转化为可供 AI 图像/视频生成的详细画面描述。描述包括：景别（远景/中景/近景/特写）、摄像机运动、光线氛围、人物动作表情、环境细节。用中文描述，100-200 字。",
        },
        {
          role: "user",
          content: `场景标题：${nodeTitle}
风格：${style}
剧情上下文：${context}

请生成这个场景的详细画面描述，供 AI 视频生成使用。`,
        },
      ],
      temperature: 0.7,
      maxTokens: 300,
    });
    assertCreationContent(text);
    return new Response(text, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  } catch (error) {
    return Response.json(textGenerationError(error, provider), { status: 502 });
  }
}
