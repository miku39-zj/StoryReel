import { readGeneratedMedia } from "@/lib/server/generated-media";
import { editorAuthorized, editorChallenge } from "@/lib/access/editor";
import { publishedMedia } from "@/lib/server/media-access";
export const runtime = "nodejs";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const isPublic = publishedMedia(id);
  if (!isPublic && !editorAuthorized(request)) return editorChallenge();
  const media = await readGeneratedMedia(id);
  if (!media) return new Response("素材不存在", { status: 404 });
  const headers: Record<string, string> = {
    "Content-Type": media.type,
    "Accept-Ranges": "bytes",
    "Cache-Control": isPublic ? "public, max-age=31536000, immutable" : "private, no-store",
    "X-Content-Type-Options": "nosniff",
  };
  const range = request.headers.get("range");
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    const start = match?.[1]
      ? Number(match[1])
      : match?.[2]
        ? Math.max(0, media.bytes.length - Number(match[2]))
        : 0;
    const end =
      match?.[1] && match[2]
        ? Math.min(Number(match[2]), media.bytes.length - 1)
        : media.bytes.length - 1;
    if (!match || start > end || start >= media.bytes.length)
      return new Response(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${media.bytes.length}` },
      });
    headers["Content-Range"] = `bytes ${start}-${end}/${media.bytes.length}`;
    headers["Content-Length"] = String(end - start + 1);
    return new Response(new Uint8Array(media.bytes.subarray(start, end + 1)), {
      status: 206,
      headers,
    });
  }
  headers["Content-Length"] = String(media.bytes.length);
  return new Response(new Uint8Array(media.bytes), { headers });
}
