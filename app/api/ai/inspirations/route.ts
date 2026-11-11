import { assertCreationContent } from "@/lib/story/content-policy";
import { inspirationRequestSchema, inspirationResultSchema } from "@/lib/story/inspirations";
import { briefInstructions, storyBrief } from "@/lib/story/creation-brief";
import { createTextProvider } from "@/lib/ai/providers/text-provider";
import { generateTextDraft } from "@/lib/ai/text-generation";
import { createDefaultPromptBuilder } from "@/lib/ai/context/prompt-pipes";
import { parseModelJSON } from "@/lib/ai/output-validation";
import { textGenerationError } from "@/lib/ai/text-error";

export async function POST(request: Request) {
  const parsed = inspirationRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json({ error: "请先填写 1–2000 字的故事创意。" }, { status: 400 });
  let provider: ReturnType<typeof createTextProvider> | undefined;
  try {
    provider = createTextProvider();
    if (provider.id === "mock")
      return Response.json({ error: "请先配置文本生成服务" }, { status: 503 });
    const system = createDefaultPromptBuilder().build({
      task: "inspirations",
      profile: "inspirations",
      toolCount: 0,
      deferredSummary: "",
      projectContext: {
        prompt: parsed.data.prompt,
        creativeBrief: briefInstructions(storyBrief(parsed.data.brief)),
      },
    });
    const { text } = await generateTextDraft({
      provider,
      system,
      prompt: "围绕当前创意生成三个不同的发展方向，返回完整 JSON。",
      maxTokens: 4000,
      signal: request.signal,
    });
    const result = inspirationResultSchema.parse(parseModelJSON(text));
    assertCreationContent(result);
    return Response.json(result);
  } catch (error) {
    return Response.json(textGenerationError(error, provider), { status: 502 });
  }
}
