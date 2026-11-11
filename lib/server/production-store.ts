import { omit } from "@/lib/omit";
import type { DatabaseSync } from "node:sqlite";
import { emptyProduction, type ProductionState } from "@/lib/production/types";
import { getDatabase, transaction } from "./database";
import { tasks, versions, saveTask, saveVersion } from "./generation-ledger";
import { assertStorageId } from "./storage-path";
export { dataRoot } from "./storage-path";

function readProduction(db: DatabaseSync, id: string): ProductionState {
  const row = db
    .prepare("SELECT revision, document FROM production_states WHERE project_id = ?")
    .get(id);
  const state = row
    ? { ...JSON.parse(String(row.document)), revision: Number(row.revision) }
    : emptyProduction(id);
  return { ...state, jobs: tasks(db, "shot", id), assets: versions(db, "shot", id) };
}
export async function getProduction(id: string): Promise<ProductionState> {
  assertStorageId(id);
  const db = getDatabase();
  return transaction(db, () => readProduction(db, id));
}
export async function productionProjectIds(): Promise<string[]> {
  return getDatabase()
    .prepare("SELECT project_id FROM production_states ORDER BY project_id")
    .all()
    .map((row) => String(row.project_id));
}
/** The web process and independent workers share a short SQLite write transaction. */
export async function updateProduction<T>(
  id: string,
  mutate: (state: ProductionState) => T,
): Promise<T> {
  assertStorageId(id);
  const db = getDatabase();
  return transaction(db, () => {
    const state = readProduction(db, id),
      before = JSON.stringify(state);
    const previousJobs = new Map(state.jobs.map((job) => [job.id, JSON.stringify(job)]));
    const result = mutate(state);
    if (JSON.stringify(state) !== before) {
      state.revision++;
      for (const job of state.jobs)
        if (previousJobs.get(job.id) !== JSON.stringify(job)) saveTask(db, id, "shot", job);
      for (const asset of state.assets) saveVersion(db, id, "shot", asset.shotId, asset);
      const metadata = omit(state, ["jobs", "assets"]);
      db.prepare(
        "INSERT INTO production_states (project_id, revision, document) VALUES (?, ?, ?) ON CONFLICT(project_id) DO UPDATE SET revision = excluded.revision, document = excluded.document",
      ).run(id, state.revision, JSON.stringify(metadata));
    }
    return result;
  });
}
