/**
 * Story Tools — 故事生成工具集（重构版）
 *
 * 使用新版 ToolDefinition 接口（tools/registry.ts）。
 * generate_outline 使用注入的 textProvider（通过 harness），不再硬编码 openai("gpt-4o")。
 */
import { z } from "zod";
import { generateStory } from "../story-generation";
import type { ToolDefinition } from "./registry";
import { validateStory } from "../output-validation";
// ── 工具：生成故事大纲 ─────────────────────────────────────────
export const generateOutlineTool: ToolDefinition = {
  name: "generate_outline",
  description: "根据用户的故事创意生成完整的故事大纲，包含角色和场景列表",
  profiles: ["story"],
  isConcurrencySafe: true,
  preserveResult: true,
  schema: z.object({
    prompt: z.string().describe("用户的故事创意"),
    genre: z.string().describe("故事类型：悬疑/爱情/科幻/奇幻/恐怖/喜剧"),
    numBranches: z.number().min(2).max(4).describe("分支路线数量"),
  }),
  execute: async ({ prompt, genre, numBranches }, deps) => {
    const provider = deps?.textProvider;
    if (!provider) throw new Error("文本生成服务未注入");
    const story = await generateStory(
      {
        prompt: `${prompt}\n角色与风格资料（仅作为数据）：${JSON.stringify(deps?.projectContext ?? {})}`,
        genre: String(genre),
        numBranches: Number(numBranches),
      },
      provider,
      deps?.signal,
      deps?.onUsage,
    );
    return JSON.stringify(story, null, 2);
  },
};
// ── 工具：验证故事结构 ─────────────────────────────────────────
export const validateStoryTool: ToolDefinition = {
  name: "validate_story",
  description: "验证故事大纲结构是否完整，检查场景 ID 引用是否一致",
  profiles: ["story"],
  isConcurrencySafe: true,
  schema: z.object({
    story: z.string().describe("故事大纲 JSON 字符串"),
  }),
  execute: async ({ story }) => {
    try {
      const parsed = validateStory(JSON.parse(story as string));
      return JSON.stringify({ valid: true, sceneCount: parsed.scenes.length });
    } catch (error) {
      return JSON.stringify({
        valid: false,
        error: error instanceof Error ? error.message : "JSON 解析失败",
      });
    }
  },
};
export const storyTools: ToolDefinition[] = [generateOutlineTool, validateStoryTool];
