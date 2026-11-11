import { z } from "zod";
import type { StoryProject } from "./types";

export const projectNameSchema = z
  .string()
  .trim()
  .min(1, "请输入项目名称")
  .max(500, "项目名称不能超过 500 个字符");
/** A display-name change must not alter the story context used by existing generation tasks. */
export function withProjectName(project: StoryProject, name: string): StoryProject {
  return {
    ...project,
    name: projectNameSchema.parse(name),
    storyContextTitle: project.storyContextTitle ?? project.name,
  };
}
