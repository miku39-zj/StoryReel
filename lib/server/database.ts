import { migrateGenerationLedger } from "./generation-ledger";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync, readdirSync, chmodSync, openSync, closeSync } from "node:fs";
import * as path from "node:path";
import { dataRoot, databasePath, assertStorageId } from "./storage-path";

// Reuse connections across Next.js hot reloads; workers open their own connections.
const globalStorage = globalThis as typeof globalThis & {
  storyreelDatabases?: Map<string, DatabaseSync>;
};
const connections = (globalStorage.storyreelDatabases ??= new Map<string, DatabaseSync>());

export function transaction<T>(db: DatabaseSync, action: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = action();
    if (result && typeof (result as { then?: unknown }).then === "function")
      throw new Error("数据库事务回调必须同步执行");
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
function legacyFiles(collection: string): string[] {
  try {
    return readdirSync(path.join(dataRoot(), collection))
      .filter((file) => file.endsWith(".json"))
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}
/** All-or-nothing, once per database. Original files remain as a recovery copy. */
function importLegacyFiles(db: DatabaseSync) {
  if (db.prepare("SELECT value FROM app_metadata WHERE key = ?").get("legacy-json-import-v1"))
    return;
  for (const collection of ["projects", "publications", "production", "assets"]) {
    for (const file of legacyFiles(collection)) {
      const id = file.slice(0, -5);
      try {
        assertStorageId(id);
        const raw = readFileSync(path.join(dataRoot(), collection, file), "utf8"),
          value = JSON.parse(raw);
        if (!value || (collection === "production" ? value.projectId : value.id) !== id)
          throw new Error("记录 ID 与文件名不一致");
        switch (collection) {
          case "projects":
            if (!Array.isArray(value.nodes) || !Array.isArray(value.edges))
              throw new Error("项目节点或连线无效");
            db.prepare(
              "INSERT INTO projects (id, name, created_at, updated_at, revision, document) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING",
            ).run(id, value.name, value.createdAt, value.updatedAt, value.revision ?? 0, raw);
            break;
          case "publications":
            db.prepare(
              "INSERT INTO publications (id, project_id, published_at, document) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO NOTHING",
            ).run(id, value.projectId, value.publishedAt, raw);
            break;
          case "production":
            if (
              !Array.isArray(value.jobs) ||
              !Array.isArray(value.assets) ||
              !value.selected ||
              typeof value.selected !== "object"
            )
              throw new Error("生成状态结构无效");
            db.prepare(
              "INSERT INTO production_states (project_id, revision, document) VALUES (?, ?, ?) ON CONFLICT(project_id) DO NOTHING",
            ).run(id, value.revision ?? 0, raw);
            break;
          case "assets":
            db.prepare(
              "INSERT INTO uploaded_assets (id, kind, created_at, document) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO NOTHING",
            ).run(id, value.type, value.createdAt, raw);
            break;
        }
      } catch (error) {
        throw new Error(`旧数据迁移失败 ${collection}/${file}：${(error as Error).message}`);
      }
    }
  }
  try {
    const heartbeat = Number(readFileSync(path.join(dataRoot(), "worker-heartbeat"), "utf8"));
    if (Number.isFinite(heartbeat))
      db.prepare("INSERT OR IGNORE INTO app_metadata (key, value) VALUES (?, ?)").run(
        "worker-heartbeat",
        String(heartbeat),
      );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  db.prepare("INSERT INTO app_metadata (key, value) VALUES (?, ?)").run(
    "legacy-json-import-v1",
    new Date().toISOString(),
  );
}
export function getDatabase(): DatabaseSync {
  const filename = databasePath(),
    existing = connections.get(filename);
  if (existing?.isOpen) return existing;
  mkdirSync(dataRoot(), { recursive: true });
  closeSync(openSync(filename, "a", 0o600));
  chmodSync(filename, 0o600);
  const db = new DatabaseSync(filename);
  try {
    db.exec(
      "PRAGMA busy_timeout = 10000; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON;",
    );
    transaction(db, () => {
      const version = Number(db.prepare("PRAGMA user_version").get()!.user_version);
      if (version > 1) throw new Error("数据库版本高于当前应用版本，请使用匹配的应用版本");
      if (version === 0) {
        db.exec(`
          CREATE TABLE projects (
            id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL, revision INTEGER NOT NULL CHECK (revision >= 0),
            document TEXT NOT NULL CHECK (json_valid(document))
          ) STRICT;
          CREATE INDEX projects_updated_at ON projects(updated_at DESC);
          CREATE TABLE publications (
            id TEXT PRIMARY KEY, project_id TEXT NOT NULL, published_at TEXT NOT NULL,
            document TEXT NOT NULL CHECK (json_valid(document))
          ) STRICT;
          CREATE INDEX publications_project ON publications(project_id, published_at DESC);
          CREATE TABLE production_states (
            project_id TEXT PRIMARY KEY, revision INTEGER NOT NULL CHECK (revision >= 0),
            document TEXT NOT NULL CHECK (json_valid(document))
          ) STRICT;
          CREATE TABLE uploaded_assets (
            id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('image', 'video', 'audio')),
            created_at TEXT NOT NULL, document TEXT NOT NULL CHECK (json_valid(document))
          ) STRICT;
          CREATE INDEX uploaded_assets_created_at ON uploaded_assets(created_at DESC);
          CREATE TABLE app_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
          PRAGMA user_version = 1;
        `);
      }
      importLegacyFiles(db);
      migrateGenerationLedger(db);
    });
    connections.set(filename, db);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
export function closeDatabases() {
  for (const db of connections.values()) if (db.isOpen) db.close();
  connections.clear();
}
export const WORKER_HEARTBEAT_INTERVAL_MS = 5_000;

export function writeWorkerHeartbeat(timestamp = Date.now(), projectId?: string) {
  if (projectId !== undefined) assertStorageId(projectId);
  getDatabase()
    .prepare(
      "INSERT INTO app_metadata (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .run(projectId ? `worker-heartbeat:${projectId}` : "worker-heartbeat", String(timestamp));
}
export function workerIsOnline(projectId?: string) {
  if (projectId !== undefined) assertStorageId(projectId);
  const keys = projectId
    ? ["worker-heartbeat", `worker-heartbeat:${projectId}`]
    : ["worker-heartbeat"];
  return keys.some((key) => {
    const row = getDatabase().prepare("SELECT value FROM app_metadata WHERE key=?").get(key);
    return !!row && Date.now() - Number(row.value) < 4 * WORKER_HEARTBEAT_INTERVAL_MS;
  });
}
