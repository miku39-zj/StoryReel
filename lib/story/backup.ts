import { nanoid } from "nanoid";
import type { StoryProject } from "./types";
import { cacheProject, saveProject } from "./project-cache";

/** Save an independent recovery copy before replacing authored content. */
export async function backupProject(project: StoryProject): Promise<StoryProject> {
  const now = new Date().toISOString();
  const backup = {
    ...project,
    id: `backup_${nanoid(12)}`,
    name: `${project.name.slice(0, 420)} · 备份 ${new Date().toLocaleString("zh-CN")}`,
    createdAt: now,
    updatedAt: now,
    revision: undefined,
  };
  const saved = await saveProject(backup);
  cacheProject(saved, false);
  return saved;
}
