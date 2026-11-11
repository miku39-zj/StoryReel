import { readGeneratedMedia } from "./generated-media";

/** Providers cannot fetch the application's local /api/media URLs. */
export async function providerMediaUrl(value: unknown): Promise<unknown> {
  if (typeof value !== "string") return value;
  const match = value.match(/^\/api\/media\/([\w-]{1,100})$/);
  if (!match) return value;
  const media = await readGeneratedMedia(match[1]);
  if (!media) throw new Error("参考素材已不存在，请重新上传或生成");
  if (media.bytes.length > 30 * 1024 * 1024) throw new Error("用于生成的参考素材不能超过 30 MB");
  return `data:${media.type};base64,${media.bytes.toString("base64")}`;
}
export async function resolveProviderMedia(raw: Record<string, unknown>) {
  const body = { ...raw };
  for (const key of ["firstFrameUrl", "lastFrameUrl"])
    if (body[key] !== undefined) body[key] = await providerMediaUrl(body[key]);
  for (const key of ["referenceImageUrls", "referenceVideoUrls"])
    if (Array.isArray(body[key]))
      body[key] = await Promise.all((body[key] as unknown[]).map(providerMediaUrl));
  return body;
}
