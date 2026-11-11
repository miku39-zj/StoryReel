import { setTimeout as delay } from "node:timers/promises";
import { canvasWorkerTick } from "./canvas-jobs";
import { getDatabase, workerIsOnline } from "./database";
import { workerTick } from "./generation-worker";
import { activeTaskCount } from "./task-governance";
import { getVisualBatches, visualBatchTick } from "./visual-batch";

const runtime = globalThis as typeof globalThis & { storyReelProjectWorkers?: Set<string> };
const running = (runtime.storyReelProjectWorkers ??= new Set<string>());

export function projectWorkerOnline(projectId: string) {
  return running.has(projectId) || workerIsOnline(projectId);
}

/** Run the durable queues in this Node server when a dedicated worker is offline. */
export function startProjectWorker(projectId: string) {
  if (projectWorkerOnline(projectId)) return;
  running.add(projectId);
  void drainProject(projectId)
    .catch((error: unknown) => console.error("Project generation worker stopped:", error))
    .finally(() => running.delete(projectId));
}

async function drainProject(projectId: string) {
  while (
    activeTaskCount(getDatabase(), projectId) ||
    Object.values(getVisualBatches(projectId)).some((batch) => batch?.status === "running")
  ) {
    await visualBatchTick(projectId);
    await workerTick({ projectId });
    await canvasWorkerTick(projectId);
    await delay(500);
  }
}
