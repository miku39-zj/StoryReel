import { assertCreationContent } from "@/lib/story/content-policy";
import { generateTextDraft } from "@/lib/ai/text-generation";
import { textGenerationError } from "@/lib/ai/text-error";
import type { TextProvider } from "@/lib/ai/providers/text-provider";
import { createTextProvider } from "@/lib/ai/providers/text-provider";
import { nodeTextRequest, nodeTextMessages } from "@/lib/ai/node-text";

export async function POST(request: Request) {
  const parsed = nodeTextRequest.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json(
      { error: "创作要求或内容格式不正确，请缩短内容后重试。" },
      { status: 400 },
    );
  let provider: TextProvider | undefined;
  try {
    provider = createTextProvider();
    if (provider.id === "mock")
      return Response.json(
        { error: "请先配置文本生成服务，再使用 AI 生成内容。" },
        { status: 503 },
      );
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(90000)]);
    const { text } = await generateTextDraft({
      provider,
      ...nodeTextMessages(parsed.data),
      maxTokens: 2000,
      signal,
    });
    assertCreationContent(text);
    return Response.json({ text: text.trim() });
  } catch (error) {
    return Response.json(textGenerationError(error, provider), { status: 502 });
  }
}
