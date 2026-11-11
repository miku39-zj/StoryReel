/**
 * AI 创作链路 — 6 步流水线（左侧创作流程导航 + 右侧步骤面板）
 */
"use client";

import { isLinearWork, sameStorySource, storySource } from "@/lib/story/creation-brief";
import { useEffect } from "react";
import { useCreationStore, PIPELINE_STEPS, type PipelineStep } from "@/stores/creation-store";
import { Check, Loader2, AlertCircle } from "lucide-react";
import { Alert, Button, CardAction } from "@/components/ui";
import { StoryAgentPanel } from "./StoryAgentPanel";
import { BranchAgentPanel } from "./BranchAgentPanel";
import { StoryboardPanel } from "./StoryboardPanel";
import { VisualAudioPanel } from "./VisualAudioPanel";
import { VideoGenPanel } from "./VideoGenPanel";
import { ValidationPanel } from "./ValidationPanel";

const ACCENT = "#ff715b";

const stepComponents: Record<PipelineStep, React.FC> = {
  story: StoryAgentPanel,
  branch: BranchAgentPanel,
  storyboard: StoryboardPanel,
  visual: VisualAudioPanel,
  video: VideoGenPanel,
  validate: ValidationPanel,
};

// 侧栏使用更简洁的步骤名
const STEP_LABELS: Record<PipelineStep, { title: string; desc: string }> = {
  story: { title: "故事与剧本", desc: "生成大纲、角色关系和剧情节点" },
  branch: { title: "分支剧情", desc: "设计不同选择与剧情走向" },
  storyboard: { title: "分镜设计", desc: "生成分镜与镜头脚本" },
  visual: { title: "角色与画面", desc: "设计角色外观、生成场景与首尾帧图片" },
  video: { title: "视频生成", desc: "生成镜头视频、对白与旁白配音" },
  validate: { title: "校验与发布", desc: "预览效果并发布作品" },
};

export function AICreationPipeline({ initialStep }: { initialStep?: PipelineStep | null }) {
  const brief = useCreationStore((s) => s.brief);
  const appliedSource = useCreationStore((s) => s.appliedStorySource);
  const userPrompt = useCreationStore((s) => s.userPrompt);
  const changed =
    !!appliedSource && !sameStorySource(appliedSource, storySource(userPrompt, brief));
  const steps = PIPELINE_STEPS.filter(
    (step) => step.id !== "branch" || !isLinearWork(appliedSource?.brief ?? brief),
  );
  const activeStep = useCreationStore((s) => s.activeStep);
  const stepStatuses = useCreationStore((s) => s.stepStatuses);
  const setActiveStep = useCreationStore((s) => s.setActiveStep);

  useEffect(() => {
    if (initialStep) setActiveStep(initialStep);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialStep]);

  const ActivePanel = stepComponents[activeStep];
  const doneCount = steps.filter((s) => stepStatuses[s.id] === "done").length;

  return (
    <div className="flex flex-col md:flex-row h-full min-h-0 bg-[#101012]">
      {/* ── 左侧：创作流程 ── */}
      <aside
        className="w-full md:w-[184px] xl:w-[192px] shrink-0 flex flex-col overflow-y-auto max-md:border-b max-md:border-white/[0.08]"
        style={{ borderRight: "1px solid rgba(255,255,255,0.05)" }}
      >
        <p className="px-4 pt-4 pb-3 max-md:hidden text-[11px] font-semibold text-white">
          创作流程
        </p>

        <nav
          aria-label="创作流程"
          className="flex md:flex-col gap-1 px-2 py-2 md:py-0 overflow-x-auto"
        >
          {steps.map((step) => {
            const status = stepStatuses[step.id];
            const isActive = activeStep === step.id;
            const isDone = status === "done";
            const isRunning = status === "running";
            const isError = status === "error";
            const label = STEP_LABELS[step.id];

            return (
              <div key={step.id} className="relative shrink-0 md:shrink">
                <CardAction
                  onClick={() => setActiveStep(step.id)}
                  aria-current={isActive ? "step" : undefined}
                  title={label.desc}
                  className="relative w-full flex items-start gap-3 px-3 py-3 rounded-lg text-left transition-colors duration-150"
                  style={{
                    background: isActive ? "rgba(255,113,91,0.08)" : "transparent",
                    border: `1px solid ${isActive ? "rgba(255,113,91,0.28)" : "transparent"}`,
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) e.currentTarget.style.background = "rgba(255,255,255,0.03)";
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) e.currentTarget.style.background = "transparent";
                  }}
                >
                  {/* 序号圆 */}
                  <div
                    className="w-6 h-6 shrink-0 rounded-md flex items-center justify-center text-[11px] font-semibold"
                    style={{
                      background: isActive
                        ? ACCENT
                        : isDone
                          ? "rgba(255,113,91,0.14)"
                          : "rgba(255,255,255,0.05)",
                      color: isActive ? "#281512" : isDone ? ACCENT : "rgba(255,255,255,0.45)",
                      boxShadow: "none",
                    }}
                  >
                    {isRunning ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : isError ? (
                      <AlertCircle size={14} style={{ color: "#ef4444" }} />
                    ) : isDone && !isActive ? (
                      <Check size={14} />
                    ) : (
                      step.no
                    )}
                  </div>

                  <div className="flex-1 min-w-0 pt-0.5">
                    <p
                      className="text-[13px] font-medium leading-tight"
                      style={{ color: isActive ? "#f2f2f4" : "rgba(255,255,255,0.75)" }}
                    >
                      {label.title}
                    </p>
                    <p
                      className="hidden"
                      style={{
                        color: isActive ? "rgba(255,255,255,0.55)" : "rgba(255,255,255,0.3)",
                      }}
                    >
                      {label.desc}
                    </p>
                  </div>
                </CardAction>
              </div>
            );
          })}
        </nav>

        {/* 项目进度 */}
        <div
          className="mx-3 mt-4 mb-4 rounded-lg px-3 py-3 max-md:hidden"
          style={{
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          <div className="flex items-center justify-between mb-2.5">
            <span className="text-[12px]" style={{ color: "rgba(255,255,255,0.5)" }}>
              项目进度
            </span>
            <span className="text-[12px] font-semibold text-white">
              {doneCount}
              <span style={{ color: "rgba(255,255,255,0.35)" }}> / {steps.length}</span>
            </span>
          </div>
          <div
            className="h-1.5 rounded-full overflow-hidden"
            style={{ background: "rgba(255,255,255,0.06)" }}
          >
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${Math.max(doneCount / steps.length, 0.04) * 100}%`,
                background: `linear-gradient(90deg, ${ACCENT}, #ef6552)`,
              }}
            />
          </div>
        </div>
      </aside>

      {/* ── 右侧内容面板 ── */}
      <div className="flex-1 min-h-0 min-w-0 overflow-hidden">
        {changed && activeStep !== "story" ? (
          <div className="mx-auto max-w-[1200px] px-5 py-7 lg:px-8">
            <Alert tone="warning">
              故事创意或设置已变更。请重新生成并应用故事，或恢复已应用设置后继续。
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="primary" onClick={() => setActiveStep("story")}>
                  返回故事与剧本
                </Button>
                <Button
                  onClick={() => {
                    if (appliedSource) {
                      useCreationStore.getState().setBrief(appliedSource.brief);
                      useCreationStore.getState().setUserPrompt(appliedSource.prompt);
                    }
                  }}
                >
                  恢复已应用设置
                </Button>
              </div>
            </Alert>
          </div>
        ) : (
          <ActivePanel />
        )}
      </div>
    </div>
  );
}
