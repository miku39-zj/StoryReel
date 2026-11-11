/**
 * Agent 重试工具 — 指数退避 + 抖动
 */

export function isRetryable(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message || "";
  const m = msg.match(/(\d{3})/);
  if (m) {
    const s = parseInt(m[1]);
    if ([429, 529, 408].includes(s)) return true;
    if (s >= 500 && s < 600) return true;
    if (s >= 400 && s < 500) return false;
  }
  return msg.includes("ECONNRESET") || msg.includes("timeout") || msg.includes("fetch failed");
}

export function calculateDelay(attempt: number, baseMs = 600, maxMs = 30000): number {
  const exp = baseMs * Math.pow(2, attempt - 1);
  const capped = Math.min(exp, maxMs);
  const jitter = capped * 0.25;
  return Math.max(0, Math.round(capped + (Math.random() * 2 - 1) * jitter));
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
