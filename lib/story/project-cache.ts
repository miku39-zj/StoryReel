import type { StoryProject } from "./types";

export function cachedProjects(): StoryProject[] {
  try {
    const projects = JSON.parse(localStorage.getItem("storyreel:projects") ?? "[]");
    return Array.isArray(projects) ? projects : [];
  } catch {
    return [];
  }
}

export function cacheProject(project: StoryProject, activate = true) {
  const projects = cachedProjects().filter((p) => p.id !== project.id);
  projects.unshift(project);
  localStorage.setItem("storyreel:projects", JSON.stringify(projects));
  if (!activate) {
    let active;
    try {
      active = JSON.parse(localStorage.getItem("storyreel:canvas") ?? "null");
    } catch {}
    if (active?.projectId !== project.id) return;
  }
  localStorage.setItem(
    "storyreel:canvas",
    JSON.stringify({
      ...project,
      projectId: project.id,
      projectName: project.name,
      projectDescription: project.description,
    }),
  );
}

export function cachedProject(id: string): StoryProject | null {
  // Migrate the old single-canvas cache before opening the dashboard snapshot.
  try {
    const old = JSON.parse(localStorage.getItem("storyreel:canvas") ?? "null");
    const listed = cachedProjects().find((p) => p.id === id);
    if (old?.projectId === id && (!old.updatedAt || !listed || old.updatedAt >= listed.updatedAt)) {
      return {
        ...old,
        id,
        name: old.projectName,
        description: old.projectDescription,
        createdAt: old.createdAt ?? listed?.createdAt ?? new Date().toISOString(),
        updatedAt: old.updatedAt ?? new Date().toISOString(),
      };
    }
    return listed ?? null;
  } catch {
    return null;
  }
}

const saves = new Map<string, Promise<StoryProject>>();
const revisions = new Map<string, number>();
export function rememberProjectRevision(id: string, revision: number) {
  revisions.set(id, revision);
}
export function saveProject(project: StoryProject): Promise<StoryProject> {
  const save = (saves.get(project.id) ?? Promise.resolve())
    .catch(() => {})
    .then(async () => {
      const revision = revisions.get(project.id) ?? project.revision ?? 0;
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json", "If-Match": String(revision) },
        body: JSON.stringify(project),
      });
      if (!response.ok) {
        const failure = await response.json().catch(() => ({}));
        throw new Error(failure.error || "服务器保存失败，请重试");
      }
      const saved: StoryProject = await response.json();
      revisions.set(project.id, saved.revision ?? revision);
      // Keep newer unsent edits while recording the revision acknowledged by the server.
      if (typeof localStorage !== "undefined") {
        const local = cachedProject(project.id);
        if (local) {
          // A late save from another project must not replace the active canvas cache.
          try {
            cacheProject({ ...local, revision: saved.revision }, false);
          } catch {
            /* Server save already succeeded. */
          }
        }
      }
      return saved;
    });
  saves.set(project.id, save);
  return save;
}

/** Dashboard metadata update never sends a stale copy of the graph back to the server. */
export async function renameCachedProject(
  project: StoryProject,
  name: string,
): Promise<StoryProject> {
  const response = await fetch(`/api/projects/${encodeURIComponent(project.id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, revision: project.revision ?? 0 }),
  });
  const saved = await response.json();
  if (!response.ok) throw new Error(saved.error || "重命名失败，请重试");
  rememberProjectRevision(saved.id, saved.revision);
  cacheProject(saved, false);
  return saved;
}

/** A successful complete server list is authoritative for previously saved/deleted projects. */
export function mergeProjectLists(local: StoryProject[], remote: StoryProject[]) {
  const remoteIds = new Set(remote.map((project) => project.id));
  const merged = new Map(
    local
      .filter((project) => remoteIds.has(project.id) || !project.revision)
      .map((project) => [project.id, project]),
  );
  for (const project of remote)
    if (!merged.has(project.id) || project.updatedAt > merged.get(project.id)!.updatedAt)
      merged.set(project.id, project);
  return [...merged.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
