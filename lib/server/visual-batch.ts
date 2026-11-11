import { randomUUID } from "node:crypto";
import { getDatabase, transaction } from "./database";
import { getProject, putProject, ProjectConflict } from "./projects";
import { canvasJobs, enqueueCanvas } from "./canvas-jobs";
import { activeTaskCount, taskLimits } from "./task-governance";
import { generationPlan } from "@/lib/canvas/workflow";
import { canvasResultPatch } from "@/lib/generation/results";
import {
  missingVisuals,
  visualSource,
  type VisualScope,
  type VisualBatch,
} from "@/lib/production/visual-plan";
import { syncCanvasProduction, submitProduction } from "./production";

interface StoredBatch extends VisualBatch {
  source: string;
  taskIds: string[];
}
function database() {
  const db = getDatabase();
  db.exec(
    "CREATE TABLE IF NOT EXISTS visual_batches_scoped (project_id TEXT NOT NULL,scope TEXT NOT NULL,document TEXT NOT NULL,owner TEXT,lease_until INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(project_id,scope))",
  );
  if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='visual_batches'").get())
    db.exec(
      "INSERT OR IGNORE INTO visual_batches_scoped SELECT project_id,'all',document,NULL,0 FROM visual_batches",
    );
  return db;
}
export function getVisualBatch(projectId: string, scope: VisualScope = "all"): VisualBatch | null {
  const row = database()
    .prepare("SELECT document FROM visual_batches_scoped WHERE project_id=? AND scope=?")
    .get(projectId, scope);
  if (!row) return null;
  const { id, status, error, createdAt, updatedAt } = JSON.parse(
    String(row.document),
  ) as StoredBatch;
  return { id, projectId, scope, status, error, createdAt, updatedAt };
}
/** Manual retries can finish a stopped batch. Reconcile readiness without enqueueing work. */
export function reconcileVisualBatches(
  project: import("@/lib/story/types").StoryProject,
  state: import("@/lib/production/types").ProductionState,
) {
  const db = database();
  transaction(db, () => {
    for (const scope of ["all", "characters", "scenes", "backgrounds", "frames"] as const) {
      const row = db
        .prepare("SELECT document FROM visual_batches_scoped WHERE project_id=? AND scope=?")
        .get(project.id, scope);
      if (!row) continue;
      const batch = JSON.parse(String(row.document)) as StoredBatch;
      if (batch.status !== "failed") continue;
      const missing = missingVisuals(project, state, scope);
      if (missing.images.length || missing.shots.length) continue;
      batch.status = "done";
      delete batch.error;
      batch.updatedAt = new Date().toISOString();
      db.prepare("UPDATE visual_batches_scoped SET document=? WHERE project_id=? AND scope=?").run(
        JSON.stringify(batch),
        project.id,
        scope,
      );
    }
  });
}
export async function startVisualBatch(projectId: string, scope: VisualScope = "all") {
  const project = await getProject(projectId);
  if (!project) throw Error("项目不存在");
  const db = database();
  transaction(db, () => {
    const current = getVisualBatch(projectId, scope);
    if (current?.status === "running") return;
    const now = new Date().toISOString();
    const batch: StoredBatch = {
      id: randomUUID(),
      projectId,
      status: "running",
      scope,
      source: visualSource(project),
      taskIds: [],
      createdAt: now,
      updatedAt: now,
    };
    db.prepare(
      "INSERT INTO visual_batches_scoped VALUES (?,?,?,NULL,0) ON CONFLICT(project_id,scope) DO UPDATE SET document=excluded.document,owner=NULL,lease_until=0",
    ).run(projectId, scope, JSON.stringify(batch));
  });
  return getVisualBatch(projectId, scope);
}
/** Coordinate existing queues; never call providers or own a second asset/version store. */
export async function visualBatchTick(projectId?: string) {
  const db = database();
  const rows = db
    .prepare(
      "SELECT project_id,scope FROM visual_batches_scoped WHERE (? IS NULL OR project_id=?) AND json_extract(document,'$.status')='running'",
    )
    .all(projectId ?? null, projectId ?? null);
  for (const row of rows) {
    const id = String(row.project_id),
      scope = String(row.scope) as VisualScope,
      owner = randomUUID();
    const claimed = db
      .prepare(
        "UPDATE visual_batches_scoped SET owner=?,lease_until=? WHERE project_id=? AND scope=? AND lease_until<? RETURNING document",
      )
      .get(owner, Date.now() + 30000, id, scope, Date.now());
    if (!claimed) continue;
    const batch = JSON.parse(String(claimed.document)) as StoredBatch;
    try {
      let project = await getProject(id);
      if (!project) throw Error("项目已删除，批量任务已停止");
      if (visualSource(project) !== batch.source)
        throw Error("角色、分镜或连线已修改，请重新一键生成未完成素材");
      const jobs = canvasJobs(id);
      // Use the same guarded version/application rules as the canvas polling consumer.
      let changed = false;
      for (const job of jobs) {
        const patch = canvasResultPatch(project, job);
        if (patch) {
          project = {
            ...project,
            nodes: project.nodes.map((n) =>
              n.id === job.nodeId ? { ...n, data: { ...n.data, ...patch } } : n,
            ),
          };
          changed = true;
        }
      }
      if (changed)
        project = await putProject(
          { ...project, updatedAt: new Date().toISOString() },
          project.revision,
        );
      const state = await syncCanvasProduction(id);
      const missing = missingVisuals(project, state, scope);
      if (!missing.images.length && !missing.shots.length) {
        batch.status = "done";
        delete batch.error;
        continue;
      }
      const tracked = [...jobs, ...state.jobs].filter((j) => batch.taskIds.includes(j.id));
      const failures = tracked.filter((j) => ["failed", "cancelled"].includes(j.status));
      const failure = failures[0];
      if (failure && scope !== "frames")
        throw Error(failure.error || "部分素材生成失败，请重试未完成素材");
      if (failure) {
        const failedNodes = new Set(failures.flatMap((j) => ("nodeId" in j ? [j.nodeId] : [])));
        missing.images = missing.images.filter((id) => !failedNodes.has(id));
        missing.shots = missing.shots.filter(
          (work) =>
            !failedNodes.has(`shot_frame:${work.shotId}`) &&
            !failures.some(
              (j) => "shotId" in j && j.shotId === work.shotId && j.kind === work.kind,
            ),
        );
        if (!missing.images.length && !missing.shots.length) {
          if (tracked.some((j) => j.status === "queued" || j.status === "running")) continue;
          throw Error(
            `${failures.length} 个画面任务未完成。${failure.error || "请检查镜头卡片后重试。"}`,
          );
        }
      }
      if (
        jobs.some(
          (j) =>
            batch.taskIds.includes(j.id) &&
            j.status === "succeeded" &&
            missing.images.includes(j.nodeId),
        ) ||
        state.jobs.some(
          (j) =>
            batch.taskIds.includes(j.id) &&
            j.status === "succeeded" &&
            missing.shots.some(
              (w) => w.shotId === j.shotId && w.kind === j.kind && w.revision === j.sourceRevision,
            ),
        )
      )
        throw Error("素材输入或选定版本已改变，请重新一键生成未完成素材");
      let room = taskLimits().maxActive - activeTaskCount(db);
      if (missing.images.length) {
        for (const target of missing.images) {
          const busy = jobs.find(
            (j) => j.nodeId === target && ["queued", "running"].includes(j.status),
          );
          if (busy) {
            if (!batch.taskIds.includes(busy.id)) batch.taskIds.push(busy.id);
            continue;
          }
          const first = generationPlan(project, [target])[0];
          if (jobs.some((j) => j.nodeId === first && ["queued", "running"].includes(j.status)))
            continue;
          if (
            ["scenes", "frames"].includes(scope) &&
            project.nodes.find((n) => n.id === first)?.data.assetKind === "character"
          ) {
            if (getVisualBatch(id, "characters")?.status === "running") continue;
            throw Error("场景引用的角色图尚未就绪，请先执行角色批量生成");
          }
          if (room <= 0) break;
          const added = enqueueCanvas(project, [first], `${batch.id}:canvas:${first}`);
          batch.taskIds.push(...added.map((j) => j.id));
          jobs.push(...added);
          room -= added.length;
        }
      } else {
        for (const work of missing.shots) {
          if (
            work.kind === "image" &&
            jobs.some(
              (j) =>
                j.nodeId === `shot_frame:${work.shotId}` &&
                ["queued", "running"].includes(j.status),
            )
          )
            continue;
          const busy = state.jobs.find(
            (j) =>
              j.shotId === work.shotId &&
              j.kind === work.kind &&
              j.sourceRevision === work.revision &&
              ["queued", "running"].includes(j.status),
          );
          if (busy) {
            if (!batch.taskIds.includes(busy.id)) batch.taskIds.push(busy.id);
            continue;
          }
          if (room <= 0) break;
          const key = `${batch.id}:${work.shotId}:${work.kind}`;
          const result = await submitProduction(id, {
            action: "generate",
            shotIds: [work.shotId],
            kind: work.kind,
            requestKey: key,
          });
          batch.taskIds.push(...result.jobs.filter((j) => j.requestKey === key).map((j) => j.id));
          state.jobs = result.jobs;
          room--;
        }
        if (!missing.shots.length) batch.status = "done";
      }
    } catch (error) {
      if (!(error instanceof ProjectConflict)) {
        batch.status = "failed";
        batch.error = (error as Error).message;
      }
    } finally {
      batch.updatedAt = new Date().toISOString();
      db.prepare(
        "UPDATE visual_batches_scoped SET document=?,owner=NULL,lease_until=0 WHERE project_id=? AND scope=? AND owner=?",
      ).run(JSON.stringify(batch), id, scope, owner);
    }
  }
}

export function getVisualBatches(id: string) {
  return {
    all: getVisualBatch(id),
    characters: getVisualBatch(id, "characters"),
    scenes: getVisualBatch(id, "scenes"),
    backgrounds: getVisualBatch(id, "backgrounds"),
    frames: getVisualBatch(id, "frames"),
  };
}
