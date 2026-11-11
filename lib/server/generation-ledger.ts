import type { DatabaseSync } from "node:sqlite";
export type GenerationScope = "canvas" | "shot";
export interface LedgerTask {
  id: string;
  projectId?: string;
  nodeId?: string;
  shotId?: string;
  kind: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}
export interface LedgerAsset {
  id: string;
  jobId: string;
  kind: string;
  url: string;
  createdAt: string;
  version: number;
  sourceRevision: string;
}
/** Called by the database migration transaction, before a connection is exposed. */
export function migrateGenerationLedger(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS generation_tasks (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, scope TEXT NOT NULL CHECK(scope IN ('canvas','shot')),
    target_id TEXT NOT NULL, status TEXT GENERATED ALWAYS AS (json_extract(document,'$.status')) STORED, document TEXT NOT NULL CHECK(json_valid(document)));
    CREATE INDEX IF NOT EXISTS generation_tasks_project ON generation_tasks(project_id,scope);
    CREATE INDEX IF NOT EXISTS generation_tasks_status ON generation_tasks(status);
    CREATE TABLE IF NOT EXISTS generated_versions (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, scope TEXT NOT NULL CHECK(scope IN ('canvas','shot')),
    target_id TEXT NOT NULL, kind TEXT NOT NULL, version INTEGER NOT NULL,
    job_id TEXT NOT NULL UNIQUE, document TEXT NOT NULL CHECK(json_valid(document)),
    UNIQUE(project_id,scope,target_id,kind,version));
    CREATE TABLE IF NOT EXISTS deleted_projects (id TEXT PRIMARY KEY, deleted_at TEXT NOT NULL);`);
  if (db.prepare("SELECT 1 FROM app_metadata WHERE key='generation-ledger-v1'").get()) return;
  if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='canvas_jobs'").get()) {
    for (const row of db
      .prepare("SELECT project_id,document FROM canvas_jobs ORDER BY rowid")
      .all()) {
      const job = JSON.parse(String(row.document));
      job.leaseUntil = job.lease;
      job.nextRunAt = job.nextPoll;
      delete job.lease;
      delete job.nextPoll;
      saveTask(db, String(row.project_id), "canvas", job);
      if (job.status === "succeeded" && job.url && job.fingerprint) recordCanvasVersion(db, job);
    }
    db.exec("DROP TABLE canvas_jobs");
  }
  for (const row of db.prepare("SELECT project_id,document FROM production_states").all()) {
    const state = JSON.parse(String(row.document)),
      id = String(row.project_id);
    for (const job of state.jobs ?? []) saveTask(db, id, "shot", job);
    for (const asset of state.assets ?? []) saveVersion(db, id, "shot", asset.shotId, asset);
    delete state.jobs;
    delete state.assets;
    db.prepare("UPDATE production_states SET document=? WHERE project_id=?").run(
      JSON.stringify(state),
      id,
    );
  }
  db.prepare("INSERT INTO app_metadata VALUES (?,?)").run(
    "generation-ledger-v1",
    new Date().toISOString(),
  );
}
export function tasks<T extends LedgerTask>(
  db: DatabaseSync,
  scope: GenerationScope,
  projectId?: string,
): T[] {
  const rows =
    projectId === undefined
      ? db.prepare("SELECT document FROM generation_tasks WHERE scope=? ORDER BY rowid").all(scope)
      : db
          .prepare(
            "SELECT document FROM generation_tasks WHERE scope=? AND project_id=? ORDER BY rowid",
          )
          .all(scope, projectId);
  return rows.map((row) => JSON.parse(String(row.document)));
}
export function saveTask(
  db: DatabaseSync,
  projectId: string,
  scope: GenerationScope,
  job: LedgerTask,
) {
  const written = db
    .prepare(
      `INSERT INTO generation_tasks (id,project_id,scope,target_id,document) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
    document=excluded.document WHERE generation_tasks.project_id=excluded.project_id AND generation_tasks.scope=excluded.scope`,
    )
    .run(job.id, projectId, scope, job.nodeId ?? job.shotId ?? "", JSON.stringify(job));
  if (!written.changes) throw new Error("任务 ID 已属于其他项目或生产流程");
}
export function versions<T extends LedgerAsset>(
  db: DatabaseSync,
  scope?: GenerationScope,
  projectId?: string,
): T[] {
  return db
    .prepare(
      "SELECT document FROM generated_versions WHERE (? IS NULL OR scope=?) AND (? IS NULL OR project_id=?) ORDER BY rowid",
    )
    .all(scope ?? null, scope ?? null, projectId ?? null, projectId ?? null)
    .map((row) => JSON.parse(String(row.document)));
}
/** Immutable versions: repeated commits are idempotent; conflicting writes roll back. */
export function saveVersion(
  db: DatabaseSync,
  projectId: string,
  scope: GenerationScope,
  targetId: string,
  asset: LedgerAsset,
) {
  const existing = db.prepare("SELECT document FROM generated_versions WHERE id=?").get(asset.id);
  if (existing) {
    if (String(existing.document) !== JSON.stringify(asset))
      throw new Error("素材版本不可修改，请创建新版本");
    return;
  }
  db.prepare("INSERT INTO generated_versions VALUES (?,?,?,?,?,?,?,?)").run(
    asset.id,
    projectId,
    scope,
    targetId,
    asset.kind,
    asset.version,
    asset.jobId ?? `legacy:${asset.id}`,
    JSON.stringify(asset),
  );
}
export function nextVersion(
  db: DatabaseSync,
  projectId: string,
  scope: GenerationScope,
  targetId: string,
  kind: string,
) {
  return Number(
    db
      .prepare(
        "SELECT COALESCE(MAX(version),0)+1 AS version FROM generated_versions WHERE project_id=? AND scope=? AND target_id=? AND kind=?",
      )
      .get(projectId, scope, targetId, kind)!.version,
  );
}
export function recordCanvasVersion(
  db: DatabaseSync,
  job: LedgerTask & {
    projectId: string;
    nodeId: string;
    url: string;
    fingerprint: string;
  },
) {
  const previous = versions<
    LedgerAsset & {
      nodeId: string;
    }
  >(db, "canvas", job.projectId);
  if (previous.some((asset) => asset.jobId === job.id)) return;
  saveVersion(db, job.projectId, "canvas", job.nodeId, {
    id: job.id,
    jobId: job.id,
    nodeId: job.nodeId,
    projectId: job.projectId,
    kind: job.kind,
    url: job.url,
    version: nextVersion(db, job.projectId, "canvas", job.nodeId, job.kind),
    sourceRevision: job.fingerprint,
    createdAt: job.updatedAt,
  } as LedgerAsset);
}
