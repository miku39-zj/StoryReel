import { getDatabase } from "./database";
import { listProjects } from "./projects";
import { validateProject } from "@/lib/story/graph";
import type { PlaybackLibraryItem } from "@/lib/story/playback-library";

/** Author's library: draft readiness and the latest non-revoked publication are distinct. */
export async function listPlaybackLibrary(): Promise<PlaybackLibraryItem[]> {
  const latest = new Map<string, { id: string; publishedAt: string }>();
  const rows = getDatabase()
    .prepare("SELECT id,project_id,published_at FROM publications ORDER BY published_at DESC,id")
    .all();
  for (const row of rows)
    if (!latest.has(String(row.project_id)))
      latest.set(String(row.project_id), {
        id: String(row.id),
        publishedAt: String(row.published_at),
      });
  return (await listProjects()).map((project) => {
    const publication = latest.get(project.id),
      validation = validateProject(project);
    const cover = project.nodes
      .map((n) => n.data.thumbnailUrl || n.data.imageUrl)
      .find((url) => typeof url === "string" && url.length > 0) as string | undefined;
    return {
      id: project.id,
      name: project.name,
      updatedAt: project.updatedAt,
      cover,
      status: publication ? "published" : validation.valid ? "preview" : "incomplete",
      path: publication
        ? `/player/${publication.id}`
        : validation.valid
          ? `/editor/${project.id}#preview`
          : undefined,
      publishedAt: publication?.publishedAt,
      ready: validation.assetsReady,
      total: validation.assetsTotal,
    };
  });
}
