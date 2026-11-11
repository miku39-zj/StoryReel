/**
 * Agent Harness — 顶层编排器
 *
 * 组装模型提供者、工具注册表、提示词构建器和执行循环。
 * Route handler 只需要构建一个 Harness 然后调用 run()。
 */

import type { CoreMessage } from "ai";
import { streamTextGeneration } from "./text-generation";
import { textGenerationError } from "./text-error";
import type { TextProvider } from "./providers/text-provider";
import type { ToolRegistry, TaskProfile } from "./tools/registry";
import type { PromptBuilder, PromptContext } from "./context/prompt-builder";
import { LoopDetector } from "./loop-detection";
import { isRetryable, calculateDelay, sleep } from "./retry";
import {
  parseModelJSON,
  validateStory,
  validateBranches,
  validateStoryboard,
} from "./output-validation";

const MAX_STEPS = 15;
const MAX_RETRIES = 3;

export type AgentTask = "story" | "branch" | "storyboard" | "visual" | "video";

export type AgentEvent =
  | { type: "text"; content: string }
  | { type: "tool_call"; name: string; input: unknown }
  | { type: "tool_result"; name: string; preview: string }
  | { type: "warning"; message: string }
  | { type: "progress"; step: number; maxSteps: number; tokens: number }
  | { type: "done"; steps: number; tokens: number; provider: string }
  | { type: "error"; message: string };

export interface HarnessRunOptions {
  task: AgentTask;
  messages: CoreMessage[];
  projectContext?: Record<string, unknown>;
  signal?: AbortSignal;
}

export class AgentHarness {
  constructor(
    private textProvider: TextProvider,
    private registry: ToolRegistry,
    private promptBuilder: PromptBuilder,
  ) {}

  async *run(options: HarnessRunOptions): AsyncGenerator<AgentEvent> {
    const { task, messages, projectContext } = options;

    // Set registry profile to match task
    const profileMap: Record<AgentTask, TaskProfile> = {
      story: "story",
      branch: "branch",
      storyboard: "storyboard",
      visual: "visual",
      video: "video",
    };
    this.registry.setProfile(profileMap[task]);
    this.registry.injectDeps({
      textProvider: this.textProvider,
      projectContext,
      signal: options.signal,
    });

    // Build system prompt via pipe chain
    const buildSystem = () => {
      const activeTools = this.registry.getActiveTools();
      const ctx: PromptContext = {
        task,
        profile: profileMap[task],
        toolCount: activeTools.length,
        toolNames: activeTools.map((tool) => tool.name),
        deferredSummary: this.registry.getDeferredSummary(),
        projectContext,
      };
      return this.promptBuilder.build(ctx);
    };

    // Run the agent loop
    yield* this.loop([...messages], buildSystem, options);
  }

  private async *loop(
    messages: CoreMessage[],
    buildSystem: () => string,
    options: HarnessRunOptions,
  ): AsyncGenerator<AgentEvent> {
    let step = 0;
    let totalTokens = 0;
    const mediaResults: Array<Record<string, unknown>> = [];
    this.registry.injectDeps({
      onUsage: (tokens) => {
        totalTokens += tokens;
      },
    });
    const detector = new LoopDetector();
    let completed = false;

    while (step < MAX_STEPS) {
      step++;

      let hasToolCall = false;
      let shouldBreak = false;
      let emitted = false;
      let text = "";
      const calls = new Map<string, { name: string; input: unknown }>();

      for (let attempt = 1; ; attempt++) {
        try {
          options.signal?.throwIfAborted();

          const result = streamTextGeneration({
            provider: this.textProvider,
            system: buildSystem(),
            tools: this.registry.toAISDKFormat((name, input) => {
              const detection = detector.detect(name, input);
              if (detection.stuck && detection.level === "critical")
                throw new Error(detection.message);
              emitted = true; // Tool execution may incur cost even if the stream later disconnects.
              detector.recordCall(name, input);
            }, options.signal),
            signal: options.signal,
            messages,
          });
          messages = result.context.messages;
          const { cleared, compacted } = result.context;
          if (cleared > 0 || compacted > 0) {
            yield {
              type: "warning",
              message: `[Context] 压缩了 ${cleared} 条旧结果，释放了 ${compacted} 条 budget 超限结果`,
            };
          }

          for await (const part of result.fullStream) {
            if (part.type === "text-delta") {
              if (part.textDelta) emitted = true; // Do not replay a request after paid model output has started.
              text += part.textDelta;
            }

            if (part.type === "tool-call") {
              hasToolCall = true;
              emitted = true;
              calls.set(part.toolCallId, { name: part.toolName, input: part.args });

              const detection = detector.detect(part.toolName, part.args);
              if (detection.stuck) {
                yield { type: "warning", message: detection.message };
                if (detection.level === "critical") {
                  shouldBreak = true;
                } else {
                  messages.push({
                    role: "user",
                    content: `[系统提醒] ${detection.message}。请换一个思路。`,
                  });
                }
              }

              yield { type: "tool_call", name: part.toolName, input: part.args };
            }

            if ((part as { type: string }).type === "tool-result") {
              const r = part as unknown as {
                toolCallId: string;
                toolName: string;
                result: unknown;
              };
              const resultText = typeof r.result === "string" ? r.result : JSON.stringify(r.result);
              if (["generate_image", "poll_video_job"].includes(r.toolName)) {
                const media = typeof r.result === "string" ? JSON.parse(r.result) : r.result;
                if (media.status === "failed" || media.status === "placeholder")
                  throw new Error(media.error ?? "生成服务返回占位或失败结果");
                mediaResults.push(media);
              }
              // Media consumers need the complete structured result, including long URLs.
              const preview = ["generate_image", "submit_video_job", "poll_video_job"].includes(
                r.toolName,
              )
                ? resultText
                : resultText.slice(0, 200);
              yield { type: "tool_result", name: r.toolName, preview };
              const call = calls.get(r.toolCallId);
              if (call) detector.recordResult(call.name, call.input, r.result);
            }
          }

          const [response, usage] = await Promise.all([result.response, result.usage]);
          if (response?.messages) messages.push(...(response.messages as CoreMessage[]));
          if (usage) totalTokens += (usage.promptTokens ?? 0) + (usage.completionTokens ?? 0);
          if (hasToolCall && (options.task === "visual" || options.task === "video")) {
            const key = options.task === "visual" ? "imageUrl" : "videoUrl";
            const scenes = options.projectContext?.scenes as Array<{ id: string }> | undefined;
            const ready = mediaResults.filter(
              (media) => media.status === "done" && typeof media[key] === "string",
            );
            // A verified media result needs no additional paid model call to rewrite its URL.
            if (
              ready.length &&
              (!scenes ||
                scenes.every((scene) => ready.some((media) => media.sceneId === scene.id)))
            )
              hasToolCall = false;
          }
          if (!hasToolCall) {
            let output: unknown;
            if (options.task === "story") output = validateStory(parseModelJSON(text));
            else if (options.task === "branch")
              output = validateBranches(
                parseModelJSON(text),
                (options.projectContext?.scenes ?? []) as Array<{ id: string }>,
              );
            else if (options.task === "storyboard")
              output = validateStoryboard(
                parseModelJSON(text),
                (options.projectContext?.scenes ?? []) as Array<{ id: string }>,
                (options.projectContext?.characters ?? []) as Array<{ name: string }>,
              );
            if (options.task === "visual" || options.task === "video") {
              const key = options.task === "visual" ? "imageUrl" : "videoUrl";
              const scenes = options.projectContext?.scenes as Array<{ id: string }> | undefined;
              const completed = mediaResults.filter(
                (media) => media.status === "done" && typeof media[key] === "string",
              );
              if (
                !completed.length ||
                scenes?.some((scene) => !completed.some((media) => media.sceneId === scene.id))
              )
                throw new Error("素材尚未全部完成，禁止返回成功");
              output = completed; // Only provider results can supply final URLs/status, never model inventions.
            }
            yield { type: "text", content: output ? JSON.stringify(output) : text };
          }
          break;
        } catch (err) {
          if (
            emitted ||
            options.signal?.aborted ||
            attempt > MAX_RETRIES ||
            !isRetryable(err as Error)
          ) {
            yield { type: "error", message: textGenerationError(err, this.textProvider).error };
            return;
          }
          const delay = calculateDelay(attempt);
          yield {
            type: "warning",
            message: `[重试] 第 ${attempt}/${MAX_RETRIES} 次，${delay}ms 后...`,
          };
          await sleep(delay);
          hasToolCall = false;
          shouldBreak = false;
          text = "";
          calls.clear();
        }
      }

      yield { type: "progress", step, maxSteps: MAX_STEPS, tokens: totalTokens };

      if (shouldBreak) {
        yield { type: "error", message: "循环检测触发，Agent 已停止" };
        return;
      }
      if (!hasToolCall) {
        completed = true;
        break;
      }
    }

    if (!completed) {
      yield { type: "error", message: `达到最大步数 ${MAX_STEPS}，任务未完成` };
      return;
    }

    yield { type: "done", steps: step, tokens: totalTokens, provider: this.textProvider.id };
  }
}

/** 把 AgentEvent 流序列化成 SSE ReadableStream（供 Next.js Route Handler 使用） */
export function agentEventsToSSE(
  events: AsyncGenerator<AgentEvent>,
  abort?: AbortController,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    async pull(controller) {
      try {
        const next = await events.next();
        if (next.done) controller.close();
        else controller.enqueue(encoder.encode(`data: ${JSON.stringify(next.value)}\n\n`));
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel() {
      abort?.abort();
      await events.return(undefined);
    },
  });
}
