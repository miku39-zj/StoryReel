import { listPublications, revokePublication } from "@/lib/server/projects";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, { params }: Context) {
  const { id } = await params;
  if (!/^[\w-]{1,100}$/.test(id)) return Response.json({ error: "无效项目" }, { status: 400 });
  return Response.json(await listPublications(id));
}
export async function DELETE(request: Request, { params }: Context) {
  const { id } = await params,
    publicationId = new URL(request.url).searchParams.get("publicationId");
  if (!/^[\w-]{1,100}$/.test(id) || !publicationId || !/^[\w-]{1,100}$/.test(publicationId))
    return Response.json({ error: "无效作品" }, { status: 400 });
  return (await revokePublication(id, publicationId))
    ? new Response(null, { status: 204 })
    : Response.json({ error: "作品不存在" }, { status: 404 });
}
