import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { storeGeneratedMedia } from "./generated-media";
import type { LibraryAsset } from "@/lib/assets";
import { listProjects } from "./projects";
import { getDatabase } from "./database";

export async function listAssets(): Promise<LibraryAsset[]> {
  const uploads: LibraryAsset[] = getDatabase()
    .prepare("SELECT document FROM uploaded_assets ORDER BY created_at DESC, id")
    .all()
    .map((row) => JSON.parse(String(row.document)));
  const generated: LibraryAsset[] = getDatabase()
    .prepare("SELECT project_id,target_id,document FROM generated_versions ORDER BY rowid")
    .all()
    .map((row) => {
      const asset = JSON.parse(String(row.document));
      return {
        id: asset.id,
        name: `${row.target_id} · ${asset.kind} v${asset.version}`,
        type: asset.kind,
        url: asset.url,
        createdAt: asset.createdAt,
        projectId: String(row.project_id),
        mock: asset.mock,
      };
    });
  const drafts: LibraryAsset[] = (await listProjects()).flatMap((project) =>
    project.nodes.flatMap((node) =>
      (["image", "video", "audio"] as const).flatMap((type) => {
        const url = node.data[`${type}Url`];
        return typeof url === "string" && /^(https?:\/\/|\/(?!\/))/.test(url)
          ? [
              {
                id: `${project.id}_${node.id}_${type}`,
                name: String(node.data.title || node.id),
                type,
                url,
                createdAt: project.updatedAt,
                projectId: project.id,
              },
            ]
          : [];
      }),
    ),
  );
  return [
    ...new Map([...uploads, ...generated, ...drafts].map((asset) => [asset.url, asset])).values(),
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export async function uploadAsset(file: File): Promise<LibraryAsset> {
  if (!file.size || file.size > 200 * 1024 * 1024) throw new Error("文件为空或超过 200 MB");
  const bytes = new Uint8Array(await file.arrayBuffer()),
    buffer = Buffer.from(bytes);
  const png = buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const webp =
    buffer.subarray(0, 4).toString() === "RIFF" && buffer.subarray(8, 12).toString() === "WEBP";
  const mp4 = buffer.subarray(4, 8).toString() === "ftyp";
  const wav =
    buffer.subarray(0, 4).toString() === "RIFF" && buffer.subarray(8, 12).toString() === "WAVE";
  const mp3 =
    buffer.subarray(0, 3).toString() === "ID3" || (bytes[0] === 255 && (bytes[1] & 224) === 224);
  if (!png && !jpg && !webp && !mp4 && !wav && !mp3)
    throw new Error("支持 PNG、JPG、WebP 图片，MP4 视频及 MP3、WAV 音频");
  if ((png || jpg || webp) && bytes.length > 30 * 1024 * 1024)
    throw new Error("图片不能超过 30 MB");
  const id = randomUUID(),
    type = png || jpg || webp ? "image" : mp4 ? "video" : "audio";
  const url = await storeGeneratedMedia(id, {
    state: "done",
    bytes,
    extension: type === "image" ? "png" : mp4 ? "mp4" : wav ? "wav" : "mp3",
    provider: "upload",
  });
  const asset: LibraryAsset = {
    id,
    name: path.basename(file.name).slice(0, 200),
    type,
    url,
    size: file.size,
    createdAt: new Date().toISOString(),
  };
  getDatabase()
    .prepare("INSERT INTO uploaded_assets (id, kind, created_at, document) VALUES (?, ?, ?, ?)")
    .run(id, type, asset.createdAt, JSON.stringify(asset));
  return asset;
}
