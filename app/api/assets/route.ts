import { listAssets, uploadAsset } from "@/lib/server/assets";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  return Response.json(await listAssets());
}
export async function POST(request: Request) {
  if (Number(request.headers.get("content-length")) > 201 * 1024 * 1024)
    return Response.json({ error: "上传文件超过 200 MB" }, { status: 413 });
  try {
    const form = await request.formData(),
      file = form.get("file");
    if (!(file instanceof File))
      return Response.json({ error: "请选择要上传的文件" }, { status: 400 });
    return Response.json(await uploadAsset(file), { status: 201 });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}
