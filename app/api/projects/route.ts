import { listProjects, putProject, ProjectConflict } from "@/lib/server/projects";
import { parseProject } from "@/lib/story/project-schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  return Response.json(await listProjects());
}
export async function POST(request: Request) {
  let project;
  try {
    project = parseProject(await request.json());
  } catch {
    return Response.json({ error: "项目数据格式不正确" }, { status: 400 });
  }
  try {
    const match = request.headers.get("if-match");
    if (match !== null && !/^\d+$/.test(match))
      return Response.json({ error: "保存版本无效" }, { status: 400 });
    return Response.json(
      await putProject(project, match === null ? (project.revision ?? 0) : Number(match)),
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof ProjectConflict)
      return Response.json({ error: error.message }, { status: 409 });
    throw error;
  }
}
