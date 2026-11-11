import { execFile } from "node:child_process";
import { writeFile, unlink, mkdir } from "node:fs/promises";
import { promisify } from "node:util";
import * as path from "node:path";
import * as os from "node:os";

const execFileAsync = promisify(execFile);

export interface ExportSegment {
  /** Shot ID for error reporting. */
  shotId: string;
  /** Absolute local path to the video clip. */
  videoPath: string;
  /** Absolute local path to the voiceover clip, if any. */
  audioPath?: string;
  /** Declared duration in seconds (from storyboard). */
  duration: number;
  /** Start trim point in seconds (default 0). */
  inPoint?: number;
  /** End trim point in seconds (default = duration). */
  outPoint?: number;
}

export interface ExportPlan {
  /** Stable identifier — used as the output filename stem. */
  episodeId: string;
  segments: ExportSegment[];
  /** Absolute path where the finished MP4 should be written. */
  outputPath: string;
}

export interface ExportResult {
  outputPath: string;
  durationSeconds: number;
  warnings: string[];
}

/**
 * Run ffprobe on a file and return its duration in seconds.
 * Throws when the file is missing or unreadable.
 */
async function probeDuration(filePath: string): Promise<number> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    filePath,
  ]);
  const dur = parseFloat(stdout.trim());
  if (!isFinite(dur) || dur <= 0) throw new Error(`ffprobe: 无法读取素材时长 ${filePath}`);
  return dur;
}

/**
 * Compose a finished episode MP4 from an ordered list of video segments.
 *
 * Strategy:
 * 1. ffprobe every clip to validate it exists and get the real duration.
 * 2. For segments with audio, mix video + audio into a temp file with ffmpeg.
 * 3. Write an ffmpeg concat demuxer list file.
 * 4. Run ffmpeg concat → normalize → encode to H.264/AAC MP4.
 *
 * The function is idempotent: re-running with the same outputPath overwrites it.
 * Individual segment failures surface as thrown errors with the shotId included.
 */
export async function exportEpisode(plan: ExportPlan): Promise<ExportResult> {
  if (!plan.segments.length) throw new Error("导出计划没有任何片段");

  const tmpDir = await makeTempDir(plan.episodeId);
  const warnings: string[] = [];

  try {
    // 1. Validate clips and optionally mix in voiceover.
    const readyPaths: string[] = [];
    for (const seg of plan.segments) {
      let realDuration: number;
      try {
        realDuration = await probeDuration(seg.videoPath);
      } catch (err) {
        throw new Error(`镜头 ${seg.shotId} 视频文件无法读取: ${(err as Error).message}`);
      }
      const declared = seg.duration;
      if (realDuration < declared * 0.8) {
        warnings.push(
          `镜头 ${seg.shotId}: 实际时长 ${realDuration.toFixed(1)}s 短于分镜声明 ${declared}s，可能需要重拍`,
        );
      }

      if (seg.audioPath) {
        // Mix video + voiceover into a temp file. The shortest stream wins the duration.
        const mixed = path.join(tmpDir, `mixed_${seg.shotId}.mp4`);
        await execFileAsync("ffmpeg", [
          "-y",
          "-i", seg.videoPath,
          "-i", seg.audioPath,
          "-c:v", "copy",
          "-c:a", "aac",
          "-shortest",
          mixed,
        ]);
        readyPaths.push(mixed);
      } else {
        readyPaths.push(seg.videoPath);
      }
    }

    // 2. Write concat list.
    const listPath = path.join(tmpDir, "concat.txt");
    const listContent = readyPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n");
    await writeFile(listPath, listContent, "utf8");

    // 3. Encode final MP4: unify frame rate (24 fps), pixel format, resolution (1920×1080 pad).
    await mkdir(path.dirname(plan.outputPath), { recursive: true });
    await execFileAsync("ffmpeg", [
      "-y",
      "-f", "concat",
      "-safe", "0",
      "-i", listPath,
      "-vf", "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2",
      "-r", "24",
      "-c:v", "libx264",
      "-preset", "fast",
      "-crf", "23",
      "-c:a", "aac",
      "-b:a", "128k",
      "-movflags", "+faststart",
      plan.outputPath,
    ]);

    const finalDuration = await probeDuration(plan.outputPath);
    return { outputPath: plan.outputPath, durationSeconds: finalDuration, warnings };
  } finally {
    // Best-effort cleanup of temp files; never throw from cleanup.
    cleanupDir(tmpDir).catch(() => undefined);
  }
}

async function makeTempDir(stem: string): Promise<string> {
  const dir = path.join(os.tmpdir(), `storyreel_export_${stem}_${Date.now()}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

async function cleanupDir(dir: string): Promise<void> {
  const { readdir } = await import("node:fs/promises");
  const entries = await readdir(dir).catch(() => []);
  await Promise.all(entries.map((f) => unlink(path.join(dir, f)).catch(() => undefined)));
  const { rmdir } = await import("node:fs/promises");
  await rmdir(dir).catch(() => undefined);
}
