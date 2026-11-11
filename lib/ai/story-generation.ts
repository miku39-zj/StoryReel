import { assertCreationContent } from "@/lib/story/content-policy";
import { creationPolicy } from "./creation-policy";
import { z } from "zod";
import { creationBriefSchema, briefInstructions, isLinearWork } from "@/lib/story/creation-brief";
import { createDefaultPromptBuilder } from "./context/prompt-pipes";
import { parseModelJSON, validateStory } from "./output-validation";
import { generateTextDraft } from "./text-generation";
import type { TextProvider } from "./providers/text-provider";

export const storyRequestSchema = z.object({
  prompt: z.string().trim().min(1).max(20000),
  brief: creationBriefSchema.optional(),
  genre: z.string().max(60).optional(),
  numBranches: z.number().int().min(2).max(4).optional(),
});
export async function generateStory(
  input: z.infer<typeof storyRequestSchema>,
  provider: TextProvider,
  signal?: AbortSignal,
  onUsage?: (tokens: number) => void,
  onChunk?: (text: string) => void,
) {
  const brief = input.brief ?? creationBriefSchema.parse({ genre: input.genre });
  const system = createDefaultPromptBuilder().build({
    task: "story",
    profile: "story",
    toolCount: 0,
    deferredSummary: "",
    projectContext: {
      prompt: input.prompt,
      genre: brief.genre,
      numBranches: input.numBranches,
      creativeBrief: briefInstructions(brief),
    },
  });
  const { text, usage } = await generateTextDraft({
    provider,
    system,
    prompt: "根据创作资料生成完整故事 JSON；创作配置的线性/互动要求优先于通用模板。",
    signal,
    ...creationPolicy.story,
    onChunk,
  });
  onUsage?.((usage.promptTokens ?? 0) + (usage.completionTokens ?? 0));
  const story = validateStory(parseModelJSON(text), brief);
  if (isLinearWork(brief) && story.scenes.some((s) => (s.choices?.length ?? 0) > 1))
    throw new Error("短剧必须为线性故事，不允许观众选择分支");
  for (const selected of brief.characters ?? []) {
    const character = story.characters.find((c) => c.name === selected.name);
    if (!character) throw new Error(`故事缺少已选角色：${selected.name}，请重新生成`);
    character.description = selected.description;
  }
  assertCreationContent(story);
  return story;
}
