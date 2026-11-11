import { assertCreationContent } from "@/lib/story/content-policy";
import { z } from "zod";
import { creationBriefSchema, briefInstructions } from "@/lib/story/creation-brief";
import { createTextProvider } from "@/lib/ai/providers/text-provider";
import { generateTextDraft } from "@/lib/ai/text-generation";
import { textGenerationError } from "@/lib/ai/text-error";
import { createDefaultPromptBuilder } from "@/lib/ai/context/prompt-pipes";

const requestSchema = z.object({
  prompt: z.string().trim().min(1).max(2000),
  brief: creationBriefSchema,
});

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json(
      { error: "请填写 1–2000 字的故事创意，并检查创作配置。" },
      { status: 400 },
    );
  let provider: ReturnType<typeof createTextProvider> | undefined;
  try {
    provider = createTextProvider();
    if (provider.id === "mock")
      return Response.json({ error: "请先配置文本生成服务" }, { status: 503 });
    const { text } = await generateTextDraft({
      provider,
      signal: request.signal,
      maxTokens: 2500,
      system: createDefaultPromptBuilder().build({
        task: "expand-idea",
        profile: "expand-idea",
        toolCount: 0,
        deferredSummary: "",
        projectContext: {
          prompt: parsed.data.prompt,
          creativeBrief: briefInstructions(parsed.data.brief),
        },
      }),
      prompt: "请根据已有创意扩写，直接输出故事创意正文。",
    });
    if (text.length > 2000) throw new Error("扩写结果超过 2000 字，请重试；原文已保留。");
    assertCreationContent(text);
    return Response.json({ prompt: text });
  } catch (error) {
    return Response.json(textGenerationError(error, provider), { status: 502 });
  }
}
