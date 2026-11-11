import { getDatabase } from "./database";
/** Only media explicitly referenced by a currently published snapshot is public. */
export function publishedMedia(id: string) {
  if (!/^[\w-]{1,100}$/.test(id)) return false;
  return !!getDatabase()
    .prepare(
      `SELECT 1 FROM publications, json_tree(publications.document) AS media
    WHERE media.type='text' AND media.key IN ('videoUrl','audioUrl','thumbnailUrl') AND media.value=? LIMIT 1`,
    )
    .get(`/api/media/${id}`);
}
