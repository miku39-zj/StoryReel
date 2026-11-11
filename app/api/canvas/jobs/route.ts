import { workerIsOnline } from "@/lib/server/database";
import { canvasLimits } from "@/lib/server/canvas-policy";
import { z } from "zod";
import { parseProject } from "@/lib/story/project-schema";
import {
  canvasJobs,
  planCanvas,
  enqueueCanvas,
  cancelCanvas,
  resumeCanvas,
  canvasWorkerTick,
} from "@/lib/server/canvas-jobs";
export const runtime = "nodejs";
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
export async function GET(req: Request) {
  try {
    const projectId = id.parse(new URL(req.url).searchParams.get("projectId"));
    return Response.json({
      jobs: canvasJobs(projectId),
      workerOnline: workerIsOnline(projectId),
      limits: canvasLimits(),
    });
  } catch {
    return Response.json({ error: "项目 ID 无效" }, { status: 400 });
  }
}
export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (body.action === "poll") {
      const projectId = id.parse(body.projectId);
      await canvasWorkerTick(projectId);
      return Response.json({
        jobs: canvasJobs(projectId),
        workerOnline: workerIsOnline(projectId),
        limits: canvasLimits(),
      });
    }
    if (body.action === "resume")
      return Response.json({ job: resumeCanvas(id.parse(body.projectId), id.parse(body.jobId)) });
    if (body.action === "cancel")
      return Response.json({
        job: await cancelCanvas(id.parse(body.projectId), id.parse(body.jobId)),
      });
    const project = parseProject(body.project),
      targets = z.array(z.string().min(1)).min(1).max(100).parse(body.targets),
      requestKey = id.parse(body.requestKey);
    if (body.action === "plan") return Response.json({ quote: planCanvas(project, targets) });
    return Response.json({ jobs: enqueueCanvas(project, targets, requestKey) }, { status: 202 });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}
