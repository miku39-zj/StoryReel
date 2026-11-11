import { omit } from "@/lib/omit";
import { getProject, putProject, publishProject, ProjectConflict } from "@/lib/server/projects";
import { parseProject } from "@/lib/story/project-schema";
import { validateProject, playbackProject } from "@/lib/story/graph";
import type { StoryProject } from "@/lib/story/types";

export const runtime = "nodejs";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let project: StoryProject;
  try {
    project = parseProject(await request.json());
  } catch {
    return Response.json({ error: "项目数据格式不正确" }, { status: 400 });
  }
  const { id } = await params;
  if (project.id !== id) return Response.json({ error: "项目 ID 不一致" }, { status: 400 });
  const validation = validateProject(project);
  if (!validation.valid)
    return Response.json({ error: "剧情尚未达到发布要求", validation }, { status: 422 });
  if (project.revision !== undefined) {
    const saved = await getProject(id);
    // Autosaving a step status must not race with publishing the same playback content.
    const content = (value: StoryProject) => {
      const playback = omit(playbackProject(value), ["updatedAt"]);
      return JSON.stringify(playback);
    };
    if (!saved || (saved.revision !== project.revision && content(saved) !== content(project)))
      return Response.json({ error: new ProjectConflict().message }, { status: 409 });
    project = saved;
    const currentValidation = validateProject(project);
    if (!currentValidation.valid)
      return Response.json(
        { error: "剧情尚未达到发布要求", validation: currentValidation },
        { status: 422 },
      );
  } else {
    try {
      await putProject(project, 0);
    } catch (error) {
      if (error instanceof ProjectConflict)
        return Response.json({ error: error.message }, { status: 409 });
      throw error;
    }
  }
  const publication = await publishProject(playbackProject(project));
  return Response.json({ id: publication.id, path: `/player/${publication.id}` }, { status: 201 });
}
