/** A URL alone is not evidence of a successful generation. */
export function generatedImageResult(preview: string): string {
  let value;
  try {
    value = JSON.parse(preview);
  } catch {
    throw new Error("图片生成结果不完整，请重试");
  }
  if (value.status !== "done" || value.provider === "mock" || value.error)
    throw new Error(value.error || "未生成真实图片，请检查图片服务配置后重试");
  const url = value.imageUrl ?? value.image_url;
  if (typeof url !== "string" || !url) throw new Error("生成服务未返回图片");
  return url;
}
