import { z } from "zod";
import { characterSchema } from "../characters";

export const creationModes = ["interactive", "linear", "character", "scene", "storyboard"] as const;

/** Distinct work types: drives production flow and export strategy. */
export const workTypes = ["single-episode", "multi-episode", "interactive"] as const;
export type WorkType = (typeof workTypes)[number];

/** Standalone tool entry points, independent of the main creation flow. */
export const toolModes = ["character", "scene", "storyboard"] as const;
export type ToolMode = (typeof toolModes)[number];

export const creationBriefSchema = z.object({
  mode: z.enum(creationModes).default("interactive"),
  /** Preferred replacement for mode: separates work type from tool entry points. */
  workType: z.enum(workTypes).optional(),
  genre: z.string().trim().max(60).default("自动"),
  narrativeStyle: z.string().trim().max(200).default("电影叙事"),
  targetDurationSeconds: z.number().int().min(5).max(600).optional(),
  decisionPoints: z.number().int().min(1).max(10).optional(),
  allowCycles: z.boolean().default(false),
  characters: z.array(characterSchema).max(20).default([]),
  references: z
    .array(
      z.object({
        id: z.string().min(1).max(200),
        name: z.string().max(500),
        url: z.string().regex(/^\/api\/media\/[a-zA-Z0-9_-]+$/),
        description: z.string().max(2000).default(""),
      }),
    )
    .max(4)
    .default([]),
});
export type CreationBrief = z.infer<typeof creationBriefSchema>;
export const defaultCreationBrief = (): CreationBrief => creationBriefSchema.parse({});
/** workType takes precedence; falls back to legacy mode for older records. */
export function isLinearWork(brief: CreationBrief) {
  if (brief.workType) return brief.workType !== "interactive";
  return brief.mode === "linear" || brief.mode === "storyboard";
}
/** @deprecated Use isLinearWork */
export function isLinearBrief(brief: CreationBrief) {
  return isLinearWork(brief);
}
/** One serialization shared by all text generation tasks; no transport/configuration details. */
export function briefInstructions(brief: CreationBrief) {
  return JSON.stringify({
    ...brief,
    decisionPoints: isLinearWork(brief) ? undefined : brief.decisionPoints,
    genre: brief.genre === "自动" ? "根据创意推断题材，不将创作类型当作题材" : brief.genre,
    episodes:
      brief.workType === "single-episode"
        ? "所有场景属于第 1 集。围绕一个核心冲突安排开场、升级、高潮与收束，在本集解决主线。"
        : brief.workType
          ? [
              "先确定全剧主线和最终揭晓，再从第 1 集起规划至少两集，集号连续。每集有一个具体目标、关键转折和结尾。每个场景标记 episode。",
              "用全剧 description 概括主线，在每集首场 description 写清本集目标。非末集结尾留下下一集能兑现的动作或悬念。",
              "在跨集边两端填写 exitState 和 entryState，记录服装、道具、时间、角色已知信息。在场景 description 写明地点和同动作接拍、切景或跳时。",
              isLinearWork(brief)
                ? "按集和场景顺序推进，非结局场景只有一个自动后继。"
                : "同一集可有互斥片段。选项指向具体场景 ID，汇合前处理道具和信息差异。",
            ].join(" ")
          : undefined,
    narrative: isLinearWork(brief)
      ? "线性故事，只有自动后继与一个结局，不生成观众选择"
      : "确定性互动故事，观众选择改变路线",
    characters: (brief.characters ?? []).map(({ name, description }) => ({ name, description })),
    castConstraint: "已选角色必须加入故事角色表，保留姓名和固定外观设定；可按剧情补充其他角色。",
    references: brief.references.map(({ name, description }) => ({ name, description })),
    constraints:
      "遵循用户明确的场景数、镜头数、对白和时长要求；有目标时长时每条观看路径允许相对目标±25%，禁止用互斥分支时长相加；不要擅自固定为6-10场景",
  });
}

/** Image nodes use the same authored brief without depending on the text transport. */
export function assetDesignInstructions(
  kind: "character" | "scene",
  prompt: string,
  brief: CreationBrief,
) {
  const task =
    kind === "character"
      ? "角色参考设计：明确固定外貌、服装、体态与辨识特征，主体清晰，避免加入无关人物。"
      : "场景参考设计：明确空间布局、时代、光线、色调和关键道具，保持空间可复用。";
  return `${task}\n创作要求：${prompt}\n题材：${brief.genre === "自动" ? "依据创作要求选择" : brief.genre}\n风格要求：${brief.narrativeStyle}\n参考说明：${brief.references
    .map((ref) => ref.description)
    .filter(Boolean)
    .join("；")}`;
}

/** Narrative form for story tasks; legacy task modes stay readable. */
export function storyBrief(brief: CreationBrief): CreationBrief {
  const mode = isLinearWork(brief) ? "linear" : "interactive";
  return creationBriefSchema.parse({
    ...brief,
    mode,
    decisionPoints: mode === "linear" ? undefined : brief.decisionPoints,
  });
}
export const storySourceSchema = z.object({ prompt: z.string(), brief: creationBriefSchema });
export type StorySource = z.infer<typeof storySourceSchema>;
export function storySource(prompt: string, brief: CreationBrief): StorySource {
  return { prompt: prompt.trim(), brief: storyBrief(brief) };
}
export function sameStorySource(
  a: StorySource | null | undefined,
  b: StorySource | null | undefined,
) {
  return (
    !!a &&
    !!b &&
    JSON.stringify(storySource(a.prompt, a.brief)) ===
      JSON.stringify(storySource(b.prompt, b.brief))
  );
}
