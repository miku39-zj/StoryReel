import { visualBatchTick } from "../lib/server/visual-batch";
import { parseArgs } from "node:util";
import { assertStorageId } from "../lib/server/storage-path";
import { canvasWorkerTick } from "../lib/server/canvas-jobs";
import { loadEnvConfig } from "@next/env";
import { randomUUID } from "node:crypto";
import { workerTick } from "../lib/server/generation-worker";
import {
  writeWorkerHeartbeat,
  closeDatabases,
  WORKER_HEARTBEAT_INTERVAL_MS,
} from "../lib/server/database";

loadEnvConfig(process.cwd());
const { values } = parseArgs({
  options: { project: { type: "string" }, once: { type: "boolean", default: false } },
  strict: true,
});
if (values.project !== undefined) assertStorageId(values.project);
const owner = randomUUID();
let stopping = false;
process.on("SIGINT", () => {
  stopping = true;
});
process.on("SIGTERM", () => {
  stopping = true;
});
async function main() {
  console.log("StoryReel generation worker started");
  do {
    try {
      writeWorkerHeartbeat(Date.now(), values.project);
      await visualBatchTick(values.project);
      const handled = await workerTick({ owner, projectId: values.project });
      if (!values.once || !handled) await canvasWorkerTick(values.project);
    } catch (error) {
      console.error("Generation worker:", (error as Error).message);
    }
    if (values.once) break;
    await new Promise((r) => setTimeout(r, 500));
  } while (!stopping);
}
const heartbeatTimer = setInterval(() => {
  try {
    writeWorkerHeartbeat(Date.now(), values.project);
  } catch (error) {
    console.error("Generation worker heartbeat:", (error as Error).message);
  }
}, WORKER_HEARTBEAT_INTERVAL_MS).unref();
void main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    clearInterval(heartbeatTimer);
    closeDatabases();
  });
