import { getProject } from "@/lib/server/projects";
import { getProduction } from "@/lib/server/production-store";
import { syncCanvasProduction } from "@/lib/server/production";
import { productionShots } from "@/lib/production/shot-inputs";
import { shotRevision } from "@/lib/production/shots";
import { selectedAsset } from "@/lib/production/types";
import { exportEpisode, type ExportSegment } from "@/lib/production/export";
import { dataRoot } from "@/lib/server/storage-path";
import { readGeneratedMedia } from "@/lib/server/generated-media";
import { createReadStream, existsSync } from "node:fs";
import * as path from "node:path";
import * as fs from "node:fs/promises";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/** Download the finished MP4 for a single-episode project. */
export async function GET(_request: Request, { params }: Context) {
  const { id } = await params;
  if (!/^[\w-]{1,100}$/.test(id))
    return Response.json({ error: "无效项目" }, { status: 400 });

  const project = await getProject(id);
  if (!project) return Response.json({ error: "项目不存在" }, { status: 404 });

  const outputPath = path.join(dataRoot(), "exports", `${id}.mp4`);
  if (!existsSync(outputPath))
    return Response.json({ error: "尚未导出，请先 POST 触发导出" }, { status: 404 });

  const stat = await fs.stat(outputPath);
  const stream = createReadStream(outputPath);
  return new Response(stream as unknown as ReadableStream, {
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": String(stat.size),
      "Content-Disposition": `attachment; filename="${encodeURIComponent(project.name)}.mp4"`,
    },
  });
}

/** Trigger an export and return { status, outputPath, durationSeconds, warnings }. */
export async function POST(_request: Request, { params }: Context) {
  const { id } = await params;
  if (!/^[\w-]{1,100}$/.test(id))
    return Response.json({ error: "无效项目" }, { status: 400 });

  const project = await getProject(id);
  if (!project) return Response.json({ error: "项目不存在" }, { status: 404 });

  const state = await syncCanvasProduction(id);
  const shots = productionShots(project).sort((a, b) => a.shotIndex - b.shotIndex);
  if (!shots.length)
    return Response.json({ error: "请先生成分镜" }, { status: 400 });

  const segments: ExportSegment[] = [];
  const mediaRoot = path.join(dataRoot(), "media");

  for (const shot of shots) {
    const video = selectedAsset(state, shot.shotId, "video");
    if (!video || video.sourceRevision !== shotRevision(shot))
      return Response.json(
        { error: `镜头 ${shot.shotIndex + 1} 视频未就绪，请先完成视频生成` },
        { status: 400 },
      );

    // Resolve local file path from /api/media/<id> URL.
    const videoMatch = video.url.match(/^\/api\/media\/([\w-]{1,100})$/);
    if (!videoMatch)
      return Response.json({ error: `镜头 ${shot.shotIndex + 1} 视频地址无效` }, { status: 400 });

    const videoMedia = await readGeneratedMedia(videoMatch[1]);
    if (!videoMedia)
      return Response.json(
        { error: `镜头 ${shot.shotIndex + 1} 视频文件缺失，请重新生成` },
        { status: 400 },
      );

    // Write to a known temp path so FFmpeg can read it.
    const videoPath = path.join(mediaRoot, `${videoMatch[1]}.mp4`);

    let audioPath: string | undefined;
    if (shot.dialogue?.trim()) {
      const audio = selectedAsset(state, shot.shotId, "audio");
      if (audio) {
        const audioMatch = audio.url.match(/^\/api\/media\/([\w-]{1,100})$/);
        if (audioMatch) {
          const audioMedia = await readGeneratedMedia(audioMatch[1]);
          if (audioMedia) {
            const ext = audioMedia.type.includes("wav") ? "wav" : "mp3";
            audioPath = path.join(mediaRoot, `${audioMatch[1]}.${ext}`);
          }
        }
      }
    }

    segments.push({
      shotId: shot.shotId,
      videoPath,
      audioPath,
      duration: shot.duration,
    });
  }

  const outputDir = path.join(dataRoot(), "exports");
  await fs.mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `${id}.mp4`);

  try {
    const result = await exportEpisode({ episodeId: id, segments, outputPath });
    return Response.json({
      status: "done",
      outputPath: `/api/projects/${id}/export`,
      durationSeconds: result.durationSeconds,
      warnings: result.warnings,
    });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
}
