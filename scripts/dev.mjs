import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const grouped = process.platform !== "win32";
const children = new Set();
let stopping = false;
let forceTimer;

function signalChild(child, signal) {
  if (!child.pid) return;
  try {
    if (grouped) process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch (error) {
    if (error.code !== "ESRCH") console.error("[dev] Failed to stop service:", error);
  }
}

function stop(code) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) signalChild(child, "SIGTERM");
  forceTimer = setTimeout(() => {
    for (const child of children) signalChild(child, "SIGKILL");
  }, 5_000).unref();
}

function start(name, args) {
  const child = spawn(process.execPath, args, { stdio: "inherit", detached: grouped });
  children.add(child);
  child.on("error", (error) => {
    console.error(`[dev] ${name} failed to start:`, error.message);
    stop(1);
  });
  child.on("exit", (code, signal) => {
    // Also stop descendants (Next.js and tsx may launch their own processes).
    signalChild(child, "SIGTERM");
    children.delete(child);
    if (!stopping) {
      console.error(`[dev] ${name} exited (${signal ?? code}); stopping both services.`);
      stop(code || 1);
    }
    if (children.size === 0) clearTimeout(forceTimer);
  });
}

process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));

start("Next.js", [
  require.resolve("next/dist/bin/next"),
  "dev",
  "--turbopack",
  "--hostname",
  "127.0.0.1",
  ...process.argv.slice(2),
]);
start("generation worker", [require.resolve("tsx/cli"), "scripts/generation-worker.ts"]);
