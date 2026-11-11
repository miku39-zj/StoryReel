import { mkdir, writeFile, rename, readFile } from "node:fs/promises";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { dataRoot } from "./storage-path";
import type { GenerationResult } from "./generation-provider";

export async function storeGeneratedMedia(
  id: string,
  result: Extract<GenerationResult, { state: "done" }>,
) {
  let bytes = result.bytes;
  if (!bytes && result.url) {
    if (!/^https?:\/\//.test(result.url)) throw new Error("生成素材的下载地址无效");
    const response = await fetch(result.url, { signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw new Error(`保存素材失败 (${response.status})`);
    if (Number(response.headers.get("content-length")) > 200 * 1024 * 1024)
      throw new Error("素材文件过大");
    bytes = new Uint8Array(await response.arrayBuffer());
  }
  if (!bytes?.length || bytes.length > 200 * 1024 * 1024) throw new Error("生成素材为空或文件过大");
  let extension: string = result.extension;
  if (result.extension === "png" && bytes[0] === 0xff && bytes[1] === 0xd8) extension = "jpg";
  if (result.extension === "png" && Buffer.from(bytes.subarray(8, 12)).toString() === "WEBP")
    extension = "webp";
  const root = path.join(dataRoot(), "media");
  await mkdir(root, { recursive: true });
  const tmp = path.join(root, `${id}.${randomUUID()}.tmp`);
  await writeFile(tmp, bytes);
  await rename(tmp, path.join(root, `${id}.${extension}`));
  return `/api/media/${id}`;
}
export async function readGeneratedMedia(id: string) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) return null;
  for (const [extension, type] of Object.entries({
    png: "image/png",
    jpg: "image/jpeg",
    webp: "image/webp",
    mp4: "video/mp4",
    mp3: "audio/mpeg",
    wav: "audio/wav",
  })) {
    try {
      return { bytes: await readFile(path.join(dataRoot(), "media", `${id}.${extension}`)), type };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return null;
}
