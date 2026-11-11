export class TerminalTaskError extends Error {}

/** Shared execution rules; persistence and provider I/O belong to server adapters. */
export interface LeasedTask {
  status: string;
  owner?: string;
  leaseUntil?: number;
  nextRunAt?: number;
  stage?: string;
  updatedAt: string;
  error?: string;
  pollErrors?: number;
}
export function isRunnable(task: LeasedTask, now = Date.now()) {
  return (
    ["queued", "running"].includes(task.status) &&
    (task.leaseUntil ?? 0) <= now &&
    (task.nextRunAt ?? 0) <= now
  );
}
export function claimTask(
  task: LeasedTask,
  owner: string,
  hasProviderTask: boolean,
  leaseMs = 300000,
) {
  if (task.stage === "submitting" && !hasProviderTask) {
    task.status = "failed";
    task.error = "提交中断，外部结果未知；未自动重复计费，请确认后重试";
    task.owner = undefined;
    task.leaseUntil = 0;
    return false;
  }
  task.owner = owner;
  task.leaseUntil = Date.now() + leaseMs;
  task.status = "running";
  task.updatedAt = new Date().toISOString();
  if (!hasProviderTask) task.stage = "submitting";
  return true;
}
export function ownsTask(task: LeasedTask | undefined, owner: string): task is LeasedTask {
  return !!task && task.owner === owner && task.status === "running";
}
export function failOperation(
  task: LeasedTask,
  error: unknown,
  hasProviderTask: boolean,
  pollMs = 3000,
) {
  task.error = error instanceof Error ? error.message : String(error);
  task.leaseUntil = 0;
  task.updatedAt = new Date().toISOString();
  if (hasProviderTask && !(error instanceof TerminalTaskError) && (task.pollErrors ?? 0) < 3) {
    task.pollErrors = (task.pollErrors ?? 0) + 1;
    task.nextRunAt = Date.now() + pollMs;
  } else task.status = "failed";
}
