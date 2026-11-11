import { projectNameSchema } from "@/lib/story/project-name";
import { z } from "zod";
import {
  getProject,
  putProject,
  deleteProject,
  renameProject,
  ProjectConflict,
} from "@/lib/server/projects";
import { parseProject } from "@/lib/story/project-schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
const validId = (id: string) => /^[a-zA-Z0-9_-]{1,100}$/.test(id);
export async function GET(_request: Request, { params }: Context) {
  const { id } = await params;
  if (!validId(id)) return Response.json({ error: "无效项目" }, { status: 400 });
  const project = await getProject(id);
  return project ? Response.json(project) : Response.json({ error: "项目不存在" }, { status: 404 });
}
export async function PUT(request: Request, context: Context) {
  const { id } = await context.params;
  if (!validId(id)) return Response.json({ error: "无效项目" }, { status: 400 });
  const existing = await getProject(id);
  if (!existing) return Response.json({ error: "项目不存在" }, { status: 404 });
  let project, expectedRevision: number;
  try {
    const update = await request.json();
    const match = request.headers.get("if-match");
    const revision = match === null ? update.revision : Number(match);
    if ((match !== null && !/^\d+$/.test(match)) || !Number.isSafeInteger(revision) || revision < 0)
      return Response.json({ error: "更新项目需要有效的预期版本" }, { status: 428 });
    expectedRevision = revision;
    project = parseProject({ ...existing, ...update, id, createdAt: existing.createdAt });
  } catch {
    return Response.json({ error: "项目数据格式不正确" }, { status: 400 });
  }
  try {
    return Response.json(await putProject(project, expectedRevision));
  } catch (error) {
    if (error instanceof ProjectConflict)
      return Response.json({ error: error.message }, { status: 409 });
    throw error;
  }
}
export async function DELETE(_request: Request, { params }: Context) {
  const { id } = await params;
  if (!validId(id)) return Response.json({ error: "无效项目" }, { status: 400 });
  return (await deleteProject(id))
    ? new Response(null, { status: 204 })
    : Response.json({ error: "项目不存在" }, { status: 404 });
}

export async function PATCH(request: Request, { params }: Context) {
  const { id } = await params;
  if (!validId(id)) return Response.json({ error: "无效项目" }, { status: 400 });
  let update;
  try {
    update = z
      .object({ name: projectNameSchema, revision: z.number().int().nonnegative() })
      .strict()
      .parse(await request.json());
  } catch {
    return Response.json({ error: "请输入 1–500 个字符的项目名称和有效版本号" }, { status: 400 });
  }
  try {
    const saved = await renameProject(id, update.name, update.revision);
    return saved ? Response.json(saved) : Response.json({ error: "项目不存在" }, { status: 404 });
  } catch (error) {
    if (error instanceof ProjectConflict)
      return Response.json({ error: error.message }, { status: 409 });
    throw error;
  }
}
