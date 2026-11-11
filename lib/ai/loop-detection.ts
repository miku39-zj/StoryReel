/**
 * Agent 循环检测
 * 检测重复工具调用（乒乓循环 / 无进展重复 / 全局熔断）
 */

import { createHash } from "crypto";

export interface ToolCallRecord {
  toolName: string;
  argsHash: string;
  resultHash?: string;
  timestamp: number;
}

export type DetectorKind = "generic_repeat" | "ping_pong" | "global_circuit_breaker";

export type DetectionResult =
  | { stuck: false }
  | {
      stuck: true;
      level: "warning" | "critical";
      detector: DetectorKind;
      count: number;
      message: string;
    };

const HISTORY_SIZE = 30;
const WARNING_THRESHOLD = 4;
const CRITICAL_THRESHOLD = 7;
const BREAKER_THRESHOLD = 10;

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`).join(",")}}`;
}

function hash(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

export function hashToolCall(toolName: string, params: unknown): string {
  return `${toolName}:${hash(stableStringify(params))}`;
}

export function hashResult(result: unknown): string {
  return hash(stableStringify(result));
}

export class LoopDetector {
  private history: ToolCallRecord[] = [];

  recordCall(toolName: string, params: unknown): void {
    this.history.push({
      toolName,
      argsHash: hashToolCall(toolName, params),
      timestamp: Date.now(),
    });
    if (this.history.length > HISTORY_SIZE) this.history.shift();
  }

  recordResult(toolName: string, params: unknown, result: unknown): void {
    const argsHash = hashToolCall(toolName, params);
    const resultH = hashResult(result);
    for (let i = this.history.length - 1; i >= 0; i--) {
      if (
        this.history[i].toolName === toolName &&
        this.history[i].argsHash === argsHash &&
        !this.history[i].resultHash
      ) {
        this.history[i].resultHash = resultH;
        break;
      }
    }
  }

  resetHistory(): void {
    this.history.length = 0;
  }

  private getNoProgressStreak(toolName: string, argsHash: string): number {
    let streak = 0;
    let lastResultHash: string | undefined;
    for (let i = this.history.length - 1; i >= 0; i--) {
      const r = this.history[i];
      if (r.toolName !== toolName || r.argsHash !== argsHash) continue;
      if (!r.resultHash) continue;
      if (!lastResultHash) {
        lastResultHash = r.resultHash;
        streak = 1;
        continue;
      }
      if (r.resultHash !== lastResultHash) break;
      streak++;
    }
    return streak;
  }

  private getPingPongCount(currentHash: string): number {
    if (this.history.length < 3) return 0;
    const last = this.history[this.history.length - 1];
    let otherHash: string | undefined;
    for (let i = this.history.length - 2; i >= 0; i--) {
      if (this.history[i].argsHash !== last.argsHash) {
        otherHash = this.history[i].argsHash;
        break;
      }
    }
    if (!otherHash) return 0;
    let count = 0;
    for (let i = this.history.length - 1; i >= 0; i--) {
      const expected = count % 2 === 0 ? last.argsHash : otherHash;
      if (this.history[i].argsHash !== expected) break;
      count++;
    }
    if (currentHash === otherHash && count >= 2) return count + 1;
    return 0;
  }

  detect(toolName: string, params: unknown): DetectionResult {
    const argsHash = hashToolCall(toolName, params);
    const noProgress = this.getNoProgressStreak(toolName, argsHash);

    if (noProgress >= BREAKER_THRESHOLD)
      return {
        stuck: true,
        level: "critical",
        detector: "global_circuit_breaker",
        count: noProgress,
        message: `[熔断] ${toolName} 已重复 ${noProgress} 次且无进展`,
      };

    const pingPong = this.getPingPongCount(argsHash);
    if (pingPong >= CRITICAL_THRESHOLD)
      return {
        stuck: true,
        level: "critical",
        detector: "ping_pong",
        count: pingPong,
        message: `[熔断] 检测到乒乓循环（${pingPong} 次交替）`,
      };
    if (pingPong >= WARNING_THRESHOLD)
      return {
        stuck: true,
        level: "warning",
        detector: "ping_pong",
        count: pingPong,
        message: `[警告] 检测到乒乓循环（${pingPong} 次交替），请换思路`,
      };

    const recentCount = this.history.filter(
      (h) => h.toolName === toolName && h.argsHash === argsHash,
    ).length;
    if (recentCount >= CRITICAL_THRESHOLD)
      return {
        stuck: true,
        level: "critical",
        detector: "generic_repeat",
        count: recentCount,
        message: `[熔断] ${toolName} 相同参数已调用 ${recentCount} 次`,
      };
    if (recentCount >= WARNING_THRESHOLD)
      return {
        stuck: true,
        level: "warning",
        detector: "generic_repeat",
        count: recentCount,
        message: `[警告] ${toolName} 相同参数已调用 ${recentCount} 次`,
      };

    return { stuck: false };
  }
}
