import type { StoryProject } from "@/lib/story/types";
import { generationPlan } from "@/lib/canvas/workflow";
export { taskLimits as canvasLimits } from "./task-governance";
import { taskLimits as canvasLimits } from "./task-governance";
export function canvasQuote(project: StoryProject, targets: string[]) {
  const ids = generationPlan(project, targets),
    images = ids.filter((id) => project.nodes.find((n) => n.id === id)?.type === "image").length,
    videos = ids.length - images,
    limits = canvasLimits();
  if (ids.length > limits.maxBatch)
    throw new Error(
      `本次含上游依赖共 ${ids.length} 个任务，超过单批上限 ${limits.maxBatch}，请分批生成`,
    );
  const rate = (name: string) => {
    const raw = process.env[name];
    const n = Number(raw);
    return raw !== undefined && Number.isFinite(n) && n >= 0 ? n : null;
  };
  const imageRate = rate("STORYREEL_IMAGE_ESTIMATE_CNY"),
    videoRate = rate("STORYREEL_VIDEO_ESTIMATE_CNY");
  const estimatedCny =
    (images === 0 || imageRate !== null) && (videos === 0 || videoRate !== null)
      ? images * (imageRate ?? 0) + videos * (videoRate ?? 0)
      : null;
  return { nodeIds: ids, images, videos, total: ids.length, estimatedCny, ...limits };
}
