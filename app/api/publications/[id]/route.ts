import { getPublication } from "@/lib/server/projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id))
    return Response.json({ error: "无效作品" }, { status: 400 });
  const publication = await getPublication(id);
  return publication
    ? Response.json(publication)
    : Response.json({ error: "作品不存在或尚未发布" }, { status: 404 });
}
