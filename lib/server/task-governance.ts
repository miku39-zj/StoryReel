import type { DatabaseSync } from "node:sqlite";
function limit(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? Math.min(value, 100) : fallback;
}
export function taskLimits() {
  return {
    maxBatch: limit("STORYREEL_MAX_BATCH", 12),
    maxActive: limit("STORYREEL_MAX_ACTIVE", 24),
  };
}
export function assertProjectNotDeleted(db: DatabaseSync, projectId: string) {
  if (db.prepare("SELECT 1 FROM deleted_projects WHERE id=?").get(projectId))
    throw new Error("项目已删除，任务已停止");
}
export function activeTaskCount(db: DatabaseSync, projectId?: string): number {
  return Number(
    db
      .prepare(
        "SELECT count(*) AS count FROM generation_tasks WHERE status IN ('queued','running') AND (? IS NULL OR project_id=?)",
      )
      .get(projectId ?? null, projectId ?? null)!.count,
  );
}
/** Call inside the same write transaction that inserts jobs. */
export function assertTaskCapacity(db: DatabaseSync, added: number) {
  if (!added) return;
  const { maxBatch, maxActive } = taskLimits();
  if (added > maxBatch)
    throw new Error(`本批新增 ${added} 个任务，超过单批上限 ${maxBatch}，请分批生成`);
  if (activeTaskCount(db) + added > maxActive)
    throw new Error("进行中的任务已达到全局上限，请等待完成后再提交");
}
export function assertProjectIdle(db: DatabaseSync, projectId: string) {
  if (activeTaskCount(db, projectId))
    throw new Error("请先等待或取消该项目的生成任务，再恢复历史版本");
}
/** Transactional deletion fences queued work and invalidates in-flight result ownership. */
export function stopProjectTasks(db: DatabaseSync, projectId: string) {
  const now = new Date().toISOString();
  db.prepare("INSERT OR REPLACE INTO deleted_projects VALUES (?,?)").run(projectId, now);
  for (const row of db
    .prepare(
      "SELECT id,scope,document FROM generation_tasks WHERE project_id=? AND status IN ('queued','running')",
    )
    .all(projectId)) {
    const job = JSON.parse(String(row.document));
    Object.assign(job, {
      status: row.scope === "canvas" ? "cancelled" : "failed",
      error: "项目已删除，任务已停止",
      owner: undefined,
      lease: 0,
      leaseUntil: 0,
      updatedAt: now,
    });
    db.prepare("UPDATE generation_tasks SET document=? WHERE id=?").run(
      JSON.stringify(job),
      row.id,
    );
  }
  db.prepare("UPDATE production_states SET revision=revision+1 WHERE project_id=?").run(projectId);
}
