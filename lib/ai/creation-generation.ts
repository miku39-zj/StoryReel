import { creationPolicy } from "./creation-policy";
import { validateShotDuration } from "@/lib/production/shot-plan";
import { resolveBranchRoutes } from "@/lib/story/branch-routes";
import { creationBriefSchema, briefInstructions } from "@/lib/story/creation-brief";
import { generateTextDraft } from "./text-generation";
import type { TextProvider } from "./providers/text-provider";
import { createDefaultPromptBuilder } from "./context/prompt-pipes";
import { parseModelJSON, validateBranches, validateStoryboard } from "./output-validation";
import { storyOutlineSchema, branchDesignSchema } from "@/lib/story/creation-schema";
import { z } from "zod";

export const creationRequestSchema = z.object({
  brief: creationBriefSchema.optional(),
  storyOutline: storyOutlineSchema,
  branchDesign: branchDesignSchema.nullish(),
  visualStyle: z.string().optional(),
  creativeBrief: z.string().optional(),
});
export async function generateCreation(
  task: "branch" | "storyboard",
  input: z.infer<typeof creationRequestSchema>,
  provider: TextProvider,
  signal?: AbortSignal,
  onChunk?: (text: string) => void,
) {
  if (input.branchDesign)
    validateBranches(input.branchDesign, input.storyOutline.scenes, input.brief);
  const visualStyle =
    input.visualStyle ??
    input.storyOutline.visualStyle ??
    "cinematic, consistent color palette and character wardrobe";
  const context = {
    ...input.storyOutline,
    prompt: input.creativeBrief,
    creativeBrief: input.brief ? briefInstructions(input.brief) : undefined,
    branchDesign: input.branchDesign,
    visualStyle,
  };
  const system = createDefaultPromptBuilder().build({
    task,
    profile: task,
    toolCount: 0,
    deferredSummary: "",
    projectContext: context,
  });
  // Validate before returning anything to consumers; malformed or incomplete output never becomes an applied draft.
  const { text } = await generateTextDraft({
    provider,
    system,
    prompt:
      task === "branch"
        ? "根据项目资料设计完整分支 JSON。"
        : "根据完整故事、角色、分支资料生成分镜 JSON 数组。",
    signal,
    onChunk,
    ...creationPolicy[task],
  });
  const value = parseModelJSON(text);
  if (task === "branch") return validateBranches(value, input.storyOutline.scenes, input.brief);
  if (
    Array.isArray(value) &&
    value.some((shot) => !shot || typeof shot !== "object" || !Array.isArray(shot.characterNames))
  )
    throw new Error("分镜缺少出镜人物列表，请重新生成分镜");
  // Continuity belongs to the project; model-owned shot fields are validated after this projection.
  const characterDescriptions = input.storyOutline.characters.map(
    (character) => `${character.name}: ${character.description}`,
  );
  const enriched = Array.isArray(value)
    ? value.map((shot) =>
        shot && typeof shot === "object" && !Array.isArray(shot)
          ? {
              ...shot,
              referenceImages: undefined,
              referenceNodeIds: undefined,
              visualStyle,
              characterDescriptions,
            }
          : shot,
      )
    : value;
  const shots = validateStoryboard(
    enriched,
    input.storyOutline.scenes,
    input.storyOutline.characters,
  );
  const routes = input.branchDesign
    ? resolveBranchRoutes(input.storyOutline.scenes, input.branchDesign)
    : undefined;
  validateShotDuration(
    shots,
    input.storyOutline.scenes.map((s) => ({ ...s, choices: routes?.get(s.id) ?? s.choices })),
    input.brief,
  );
  return shots;
}
