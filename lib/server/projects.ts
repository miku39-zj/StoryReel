import { withProjectName } from "@/lib/story/project-name";
import { stopProjectTasks, assertProjectIdle, assertProjectNotDeleted } from "./task-governance";
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { StoryProject } from "@/lib/story/types";
import { repairLegacyDemo } from "@/lib/story/demo";
import { getDatabase, transaction } from "./database";
import { assertStorageId } from "./storage-path";

function readProject(db: DatabaseSync, id: string): StoryProject | null {
  const row = db.prepare("SELECT revision, document FROM projects WHERE id = ?").get(id);
  return row
    ? repairLegacyDemo({ ...JSON.parse(String(row.document)), revision: Number(row.revision) })
    : null;
}
export async function getProject(id: string) {
  assertStorageId(id);
  return readProject(getDatabase(), id);
}
export class ProjectConflict extends Error {
  constructor(message = "项目已在其他窗口更新。请先备份本地修改，再重新打开项目合并修改。") {
    super(message);
  }
}
export async function putProject(project: StoryProject, expectedRevision?: number) {
  assertStorageId(project.id);
  const db = getDatabase();
  ensureHistory(db);
  return transaction(db, () => writeProject(db, project, expectedRevision));
}
function writeProject(db: DatabaseSync, project: StoryProject, expectedRevision?: number) {
  try {
    assertProjectNotDeleted(db, project.id);
  } catch {
    throw new ProjectConflict("项目已删除，无法保存，请另存为新项目");
  }
  const previous = readProject(db, project.id);
  if (expectedRevision !== undefined && expectedRevision !== (previous?.revision ?? 0))
    throw new ProjectConflict();
  if (previous)
    db.prepare(
      "INSERT OR IGNORE INTO project_history (project_id,revision,saved_at,document) VALUES (?,?,?,?)",
    ).run(previous.id, previous.revision ?? 0, previous.updatedAt, JSON.stringify(previous));
  db.prepare(
    "DELETE FROM project_history WHERE project_id=? AND revision NOT IN (SELECT revision FROM project_history WHERE project_id=? ORDER BY revision DESC LIMIT 50)",
  ).run(project.id, project.id);
  const saved = {
    ...project,
    createdAt: previous?.createdAt ?? project.createdAt,
    revision: (previous?.revision ?? 0) + 1,
  };
  db.prepare(
    "INSERT INTO projects (id, name, created_at, updated_at, revision, document) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at, revision = excluded.revision, document = excluded.document",
  ).run(
    saved.id,
    saved.name,
    saved.createdAt,
    saved.updatedAt,
    saved.revision,
    JSON.stringify(saved),
  );
  return saved;
}

/** Patch only the name under the same revision lock used by full project saves. */
export async function renameProject(id: string, name: string, expectedRevision: number) {
  assertStorageId(id);
  const db = getDatabase();
  ensureHistory(db);
  return transaction(db, () => {
    const current = readProject(db, id);
    if (!current) return null;
    const renamed = withProjectName(current, name);
    if (current.revision !== expectedRevision) throw new ProjectConflict();
    if (renamed.name === current.name) return current;
    return writeProject(db, { ...renamed, updatedAt: new Date().toISOString() }, expectedRevision);
  });
}

export async function listProjects(): Promise<StoryProject[]> {
  return getDatabase()
    .prepare("SELECT revision, document FROM projects ORDER BY updated_at DESC, id")
    .all()
    .map((row) =>
      repairLegacyDemo({ ...JSON.parse(String(row.document)), revision: Number(row.revision) }),
    );
}
export async function deleteProject(id: string) {
  assertStorageId(id);
  const db = getDatabase();
  return transaction(db, () => {
    const deleted = db.prepare("DELETE FROM projects WHERE id = ?").run(id).changes > 0;
    if (deleted) stopProjectTasks(db, id);
    return deleted;
  });
}
export interface Publication {
  id: string;
  projectId: string;
  publishedAt: string;
  project: StoryProject;
}
export async function publishProject(project: StoryProject): Promise<Publication> {
  assertStorageId(project.id);
  const publication: Publication = {
    id: randomUUID(),
    projectId: project.id,
    publishedAt: new Date().toISOString(),
    project: { ...project, creation: undefined },
  };
  getDatabase()
    .prepare(
      "INSERT INTO publications (id, project_id, published_at, document) VALUES (?, ?, ?, ?)",
    )
    .run(
      publication.id,
      publication.projectId,
      publication.publishedAt,
      JSON.stringify(publication),
    );
  return publication;
}
export async function getPublication(id: string): Promise<Publication | null> {
  assertStorageId(id);
  const row = getDatabase().prepare("SELECT document FROM publications WHERE id = ?").get(id);
  return row ? JSON.parse(String(row.document)) : null;
}
export async function listPublications(projectId: string) {
  assertStorageId(projectId);
  return getDatabase()
    .prepare(
      "SELECT document FROM publications WHERE project_id = ? ORDER BY published_at DESC, id",
    )
    .all(projectId)
    .map((row) => {
      const p: Publication = JSON.parse(String(row.document));
      return {
        id: p.id,
        projectId: p.projectId,
        name: p.project.name,
        publishedAt: p.publishedAt,
        path: `/player/${p.id}`,
      };
    });
}
export async function revokePublication(projectId: string, id: string) {
  assertStorageId(projectId);
  assertStorageId(id);
  return (
    getDatabase()
      .prepare("DELETE FROM publications WHERE id = ? AND project_id = ?")
      .run(id, projectId).changes > 0
  );
}

function ensureHistory(db: DatabaseSync) {
  db.exec(
    "CREATE TABLE IF NOT EXISTS project_history (project_id TEXT NOT NULL, revision INTEGER NOT NULL, saved_at TEXT NOT NULL, document TEXT NOT NULL CHECK(json_valid(document)), PRIMARY KEY(project_id,revision))",
  );
}
export function projectHistory(id: string) {
  assertStorageId(id);
  const db = getDatabase();
  ensureHistory(db);
  return db
    .prepare(
      "SELECT revision,saved_at,document FROM project_history WHERE project_id=? ORDER BY revision DESC",
    )
    .all(id)
    .map((row) => {
      const p = JSON.parse(String(row.document));
      return {
        revision: Number(row.revision),
        savedAt: String(row.saved_at),
        name: p.name,
        nodes: p.nodes.length,
        edges: p.edges.length,
      };
    });
}
export async function restoreProjectRevision(
  id: string,
  revision: number,
  expectedRevision: number,
) {
  assertStorageId(id);
  const db = getDatabase();
  ensureHistory(db);
  return transaction(db, () => {
    assertProjectIdle(db, id);
    const row = db
      .prepare("SELECT document FROM project_history WHERE project_id=? AND revision=?")
      .get(id, revision);
    if (!row) throw new Error("历史版本不存在");
    const project = JSON.parse(String(row.document)) as StoryProject;
    return writeProject(
      db,
      { ...project, id, updatedAt: new Date().toISOString() },
      expectedRevision,
    );
  });
}
