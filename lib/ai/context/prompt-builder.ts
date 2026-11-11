/**
 * Prompt Builder — 组合提示词处理管道
 *
 * 每个 pipe 是 `(ctx: PromptContext) => string | null`。
 * null 表示这段不参与，PromptBuilder.build() 把非 null 的段落 join。
 */

export interface PromptContext {
  task: string;
  profile: string;
  toolCount: number;
  toolNames?: string[];
  deferredSummary: string;
  projectContext?: Record<string, unknown>;
}

type PipeFn = (ctx: PromptContext) => string | null;

export class PromptBuilder {
  private pipes: Array<{ name: string; fn: PipeFn }> = [];

  pipe(name: string, fn: PipeFn): this {
    this.pipes.push({ name, fn });
    return this;
  }

  build(ctx: PromptContext): string {
    return this.sections(ctx)
      .map((section) => section.content)
      .join("\n\n");
  }

  /** Inspect the same ordered sections used by build; callers decide whether to expose content. */
  sections(ctx: PromptContext): Array<{ name: string; content: string }> {
    return this.pipes.flatMap(({ name, fn }) => {
      const content = fn(ctx);
      return content?.trim() ? [{ name, content }] : [];
    });
  }

  /** 调试用：打印每个 pipe 的输出状态 */
  debug(ctx: PromptContext): void {
    console.log("\n=== Prompt Pipe Debug ===");
    for (const { name, fn } of this.pipes) {
      const result = fn(ctx);
      const status = result !== null ? `[ON] ${result.length} chars` : "[OFF]";
      console.log(`  ${name}: ${status}`);
    }
    console.log("========================\n");
  }
}
