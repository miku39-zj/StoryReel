/**
 * ToolRegistry — 工具注册与调度
 *
 * 主要能力：
 * - profile：按 task 激活不同工具集（story/visual/video/branch/storyboard）
 * - shouldDefer：重型工具先隐藏，搜索后才注入
 * - concurrency：读写互斥锁
 * - result truncation：head/tail 截断
 * - inject：支持注入 provider 依赖（ImageProvider、VideoProvider）
 */

import { tool as aiTool, zodSchema } from "ai";
import { estimateTokens } from "../context/defense";
import { z } from "zod";

export type TaskProfile = "story" | "branch" | "storyboard" | "visual" | "video" | "full";

export interface ToolDefinition {
  name: string;
  description: string;
  schema: z.ZodObject<z.ZodRawShape>;
  execute: (input: Record<string, unknown>, deps?: ToolDeps) => Promise<unknown>;
  /** 哪些 profile 下可用，不填表示所有 */
  profiles?: TaskProfile[];
  /** true = 并发安全（读操作），false = 独占锁 */
  isConcurrencySafe?: boolean;
  /** true = 延迟注入（不占用初始 tool list token） */
  shouldDefer?: boolean;
  /** 搜索提示词，用于 tool_search */
  searchHint?: string;
  maxResultChars?: number;
  preserveResult?: boolean;
}

/** provider 依赖注入包 */
export interface ToolDeps {
  textProvider?: import("../providers/text-provider").TextProvider;
  projectContext?: Record<string, unknown>;
  signal?: AbortSignal;
  onUsage?: (tokens: number) => void;
  imageProvider?: import("../providers/image-provider").ImageProvider;
  videoProvider?: import("../providers/video-provider").VideoProvider;
}

const DEFAULT_MAX_RESULT_CHARS = 3_000;

export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();
  private discoveredDeferredTools = new Set<string>();
  private activeProfile: TaskProfile = "full";
  private deps: ToolDeps = {};

  // ── 并发锁 ─────────────────────────────────
  private exclusiveLock = false;
  private concurrentCount = 0;
  private waitQueue: Array<() => void> = [];

  // ── 注册 & 注入 ────────────────────────────

  register(...defs: ToolDefinition[]): this {
    if (defs.some((def) => def.name === "tool_search"))
      throw new Error("tool_search 是工具注册表保留名称");
    for (const def of defs) this.tools.set(def.name, def);
    return this;
  }

  injectDeps(deps: ToolDeps): this {
    this.deps = { ...this.deps, ...deps };
    return this;
  }

  setProfile(profile: TaskProfile): this {
    this.activeProfile = profile;
    return this;
  }

  getProfile(): TaskProfile {
    return this.activeProfile;
  }

  // ── 查询 ───────────────────────────────────

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }
  getAll(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  private eligibleTools(): ToolDefinition[] {
    return this.getAll().filter(
      (t) =>
        !t.profiles || t.profiles.includes(this.activeProfile) || this.activeProfile === "full",
    );
  }

  searchTools(query: string): ToolDefinition[] {
    const terms = query
      .toLowerCase()
      .split(/[,，\s]+/)
      .filter(Boolean);
    if (!terms.length) return [];
    const matches = this.eligibleTools()
      .filter((t) =>
        terms.some((term) =>
          `${t.name} ${t.description} ${t.searchHint ?? ""}`.toLowerCase().includes(term),
        ),
      )
      .slice(0, 5);
    matches.forEach((t) => this.markDiscovered(t.name));
    return matches;
  }

  /** 当前 profile 下可见的工具（排除 deferred 且未发现的） */
  getActiveTools(): ToolDefinition[] {
    const eligible = this.eligibleTools();
    const active = eligible.filter(
      (t) => !t.shouldDefer || this.discoveredDeferredTools.has(t.name),
    );
    if (eligible.some((t) => t.shouldDefer))
      active.push({
        name: "tool_search",
        description: "按工具名称或关键词搜索当前任务可用的工具；找到的工具会在下一轮开放调用。",
        schema: z.object({ query: z.string().trim().min(1).max(200) }),
        isConcurrencySafe: true,
        execute: async ({ query }) =>
          this.searchTools(String(query)).map((t) => ({
            name: t.name,
            description: t.description,
          })),
      });
    return active;
  }

  /** 返回 deferred 工具的摘要提示（注入 system prompt） */
  getDeferredSummary(): string {
    const deferred = this.eligibleTools().filter(
      (t) => t.shouldDefer && !this.discoveredDeferredTools.has(t.name),
    );
    if (deferred.length === 0) return "";
    const lines = deferred.map((t) => `  - ${t.name}${t.searchHint ? ` — ${t.searchHint}` : ""}`);
    return `\n以下工具可用但需先调用 tool_search 获取：\n${lines.join("\n")}`;
  }

  markDiscovered(name: string): void {
    if (this.eligibleTools().some((t) => t.name === name)) this.discoveredDeferredTools.add(name);
  }

  /** 粗略 token 估算（用于 context view） */
  countTokenEstimate(): { active: number; deferred: number } {
    let active = 0;
    let deferred = 0;
    const size = (t: ToolDefinition) =>
      estimateTokens([
        {
          role: "system",
          content: JSON.stringify({
            name: t.name,
            description: t.description,
            parameters: zodSchema(t.schema).jsonSchema,
          }),
        },
      ]);
    for (const t of this.getActiveTools()) active += size(t);
    for (const t of this.eligibleTools())
      if (t.shouldDefer && !this.discoveredDeferredTools.has(t.name)) deferred += size(t);
    return { active, deferred };
  }

  // ── Vercel AI SDK 格式转换 ────────────────

  toAISDKFormat(
    beforeExecute?: (name: string, input: unknown) => void,
    signal?: AbortSignal,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Record<string, any> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: Record<string, any> = {};
    const deps = this.deps;

    for (const def of this.getActiveTools()) {
      const maxChars = def.maxResultChars ?? DEFAULT_MAX_RESULT_CHARS;
      const isSafe = def.isConcurrencySafe !== false;

      result[def.name] = aiTool({
        description: def.description,
        parameters: def.schema,
        execute: async (input) => {
          if (isSafe) {
            await this.acquireConcurrent();
          } else {
            await this.acquireExclusive();
          }
          try {
            signal?.throwIfAborted();
            beforeExecute?.(def.name, input);
            const raw = await def.execute(input as Record<string, unknown>, { ...deps, signal });
            const text = typeof raw === "string" ? raw : JSON.stringify(raw, null, 2);
            return def.preserveResult ? text : truncateResult(text, maxChars);
          } finally {
            if (isSafe) this.releaseConcurrent();
            else this.releaseExclusive();
          }
        },
      });
    }
    return result;
  }

  // ── 锁实现 ─────────────────────────────────

  private async acquireConcurrent(): Promise<void> {
    while (this.exclusiveLock) await new Promise<void>((r) => this.waitQueue.push(r));
    this.concurrentCount++;
  }
  private releaseConcurrent(): void {
    this.concurrentCount--;
    if (this.concurrentCount === 0) this.drainQueue();
  }
  private async acquireExclusive(): Promise<void> {
    while (this.exclusiveLock || this.concurrentCount > 0)
      await new Promise<void>((r) => this.waitQueue.push(r));
    this.exclusiveLock = true;
  }
  private releaseExclusive(): void {
    this.exclusiveLock = false;
    this.drainQueue();
  }
  private drainQueue(): void {
    const waiting = this.waitQueue.splice(0);
    for (const r of waiting) r();
  }
}

/** Head/Tail 截断：保留开头 60% + 结尾 40% */
export function truncateResult(text: string, maxChars = DEFAULT_MAX_RESULT_CHARS): string {
  if (text.length <= maxChars) return text;
  const head = Math.floor(maxChars * 0.6);
  const tail = maxChars - head;
  const dropped = text.length - head - tail;
  return `${text.slice(0, head)}\n\n...[省略 ${dropped} 字符]...\n\n${text.slice(-tail)}`;
}
