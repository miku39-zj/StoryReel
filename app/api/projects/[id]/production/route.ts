import { getProject } from "@/lib/server/projects";
import { canvasJobs } from "@/lib/server/canvas-jobs";
import {
  getVisualBatch,
  getVisualBatches,
  startVisualBatch,
  reconcileVisualBatches,
} from "@/lib/server/visual-batch";
import { projectWorkerOnline, startProjectWorker } from "@/lib/server/project-worker";
import { syncCanvasProduction, submitProduction } from "@/lib/server/production";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, { params }: Context) {
  const { id } = await params;
  if (!/^[\w-]{1,100}$/.test(id)) return Response.json({ error: "无效项目" }, { status: 400 });
  const state = await syncCanvasProduction(id);
  const project = await getProject(id);
  if (project) reconcileVisualBatches(project, state);
  const batches = getVisualBatches(id);
  const batch =
    batches.all ?? batches.characters ?? batches.scenes ?? batches.backgrounds ?? batches.frames;
  // Provider queue URLs are only used on the server.
  return Response.json({
    ...state,
    visualBatch: batch,
    visualBatches: batches,
    ...(batch ? { visualProject: project, canvasJobs: canvasJobs(id) } : {}),
    jobs: state.jobs.map((j) => ({
      ...j,
      providerTask: j.providerTask ? { requestId: j.providerTask.requestId } : undefined,
    })),
    workerOnline: projectWorkerOnline(id),
  });
}
export async function POST(request: Request, { params }: Context) {
  const { id } = await params;
  if (!/^[\w-]{1,100}$/.test(id)) return Response.json({ error: "无效项目" }, { status: 400 });
  try {
    const body = await request.json();
    if (body?.action === "visual-batch" || body?.action === "resume-visual-batch") {
      if (
        body.scope !== undefined &&
        !["all", "characters", "scenes", "backgrounds", "frames"].includes(body.scope)
      )
        throw Error("无效批量生成范围");
      if (body.action === "visual-batch") await startVisualBatch(id, body.scope);
      if (getVisualBatch(id, body.scope)?.status === "running") startProjectWorker(id);
    } else await submitProduction(id, body);
    return GET(request, { params: Promise.resolve({ id }) });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}
