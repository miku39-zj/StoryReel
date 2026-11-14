/**
 * 02 分支剧情 Agent — 识别决策点、设计选项、生成分支及结局
 */
"use client";

import { useCreationRequest } from "./useCreationRequest";
import { useState } from "react";
import { useCreationStore } from "@/stores/creation-store";
import { useCanvasStore } from "@/stores/canvas-store";
import { GitBranch, Sparkles, Trophy } from "lucide-react";
import type { BranchDesign } from "@/stores/creation-store";
import { applyBranchDesign } from "@/lib/story/apply-branches";
import { Button, Card, Badge, EmptyState } from "@/components/ui";
import {
  StorySummary,
  CreationStepLayout,
  StoryPrerequisite,
  GenerationFeedback,
} from "./CreationStepLayout";
import { branchDesignSchema } from "@/lib/story/creation-schema";

export function BranchAgentPanel() {
  const { request: requestDraft, cancel: cancelDraft } = useCreationRequest();
  const [error, setError] = useState<string | null>(null);
  const storyOutline = useCreationStore((s) => s.storyOutline);
  const branchDesign = useCreationStore((s) => s.branchDesign);
  const stepStatus = useCreationStore((s) => s.stepStatuses.branch);
  const streamingText = useCreationStore((s) => s.streamingText);
  const setBranchDesign = useCreationStore((s) => s.setBranchDesign);
  const setStepStatus = useCreationStore((s) => s.setStepStatus);
  const appendStreaming = useCreationStore((s) => s.appendStreamingText);
  const clearStreaming = useCreationStore((s) => s.clearStreamingText);
  const setActiveStep = useCreationStore((s) => s.setActiveStep);

  const isRunning = stepStatus === "running";

  const handleGenerate = async () => {
    if (!storyOutline) return;
    setStepStatus("branch", "running");
    setError(null);
    clearStreaming();
    const projectId = useCanvasStore.getState().projectId;

    try {
      const result = await requestDraft(
        "/api/ai/branch-agent",
        {
          brief: useCreationStore.getState().brief,
          storyOutline,
          creativeBrief: useCreationStore.getState().userPrompt,
        },
        (chunk) => {
          if (useCanvasStore.getState().projectId !== projectId)
            throw new DOMException("项目已切换", "AbortError");
          appendStreaming(chunk);
        },
      );
      if (useCanvasStore.getState().projectId !== projectId) return;
      const parsed = branchDesignSchema.parse(result) as BranchDesign;
      const canvas = useCanvasStore.getState();
      const project = canvas.toProject();
      if (!project) throw new Error("请先将故事应用到画布");
      const updated = applyBranchDesign(project, storyOutline, parsed);
      canvas.checkpoint();
      // Preserve the running creation session while atomically replacing the graph.
      useCanvasStore.setState({
        nodes: updated.nodes,
        edges: updated.edges,
        startNodeId: updated.startNodeId ?? null,
      });
      setBranchDesign(parsed);
      canvas.persist();
      setStepStatus("branch", "done");
    } catch (err) {
      console.error(err);
      if (useCanvasStore.getState().projectId !== projectId) return;
      setError((err as Error).message);
      setStepStatus("branch", "error");
    }
  };

  const page = { title: "分支剧情" };
  if (!storyOutline)
    return (
      <CreationStepLayout {...page}>
        <StoryPrerequisite icon={<GitBranch size={24} />} />
      </CreationStepLayout>
    );

  return (
    <CreationStepLayout
      {...page}
      action={
        <Button variant="primary" disabled={isRunning} onClick={handleGenerate}>
          <Sparkles size={16} />
          {isRunning ? "分析决策点中…" : branchDesign ? "重新生成分支" : "生成分支方案"}
        </Button>
      }
    >
      <StorySummary title={storyOutline.title}>
        <Badge>{storyOutline.scenes.length} 个场景</Badge>
        <Badge>{branchDesign?.decisionPoints.length ?? 0} 个决策点</Badge>
        <Badge>{branchDesign?.endings.length ?? 0} 个结局</Badge>
      </StorySummary>
      {isRunning && (
        <Button variant="ghost" onClick={cancelDraft}>
          取消生成
        </Button>
      )}
      <GenerationFeedback
        running={isRunning}
        error={error || stepStatus === "error"}
        text={streamingText}
      />
      {!branchDesign && !isRunning && (
        <Card>
          <EmptyState icon={<GitBranch size={24} />} title="暂无分支方案" />
        </Card>
      )}
      {branchDesign && !isRunning && (
        <>
          <div className="grid items-start gap-5 min-[1100px]:grid-cols-[minmax(0,1fr)_280px]">
            <section aria-label="剧情决策点" className="min-w-0 space-y-4">
              <h2 className="text-base font-semibold text-white/90">剧情决策点</h2>
              {branchDesign.decisionPoints.length === 0 && (
                <p className="text-sm text-white/50">尚未识别到决策点，可以重新生成分支方案。</p>
              )}
              {branchDesign.decisionPoints.map((dp, i) => (
                <Card key={`${dp.sceneId}-${i}`} className="p-4">
                  <div className="mb-4 flex flex-wrap items-center gap-2">
                    <Badge className="border-brand-accent/20 bg-brand-accent/10 text-brand-accent">
                      决策点 {String(i + 1).padStart(2, "0")}
                    </Badge>
                    <span className="break-all text-xs text-white/40">
                      {storyOutline.scenes.find((sc) => sc.id === dp.sceneId)?.title ?? "关联场景"}
                    </span>
                  </div>
                  <h3 className="mb-5 text-base font-semibold leading-relaxed text-white/90">
                    {dp.question}
                  </h3>
                  <div className="divide-y divide-white/[0.06]">
                    {dp.choices.map((c, j) => (
                      <div key={j} className="flex items-start gap-3 py-4 first:pt-0 last:pb-0">
                        <Badge className="mt-0.5 rounded-lg">{String.fromCharCode(65 + j)}</Badge>
                        <div className="min-w-0">
                          <p className="break-words text-sm font-medium text-white/85">{c.label}</p>
                          <p className="mt-1 text-xs leading-relaxed text-white/50">
                            {c.consequence}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              ))}
            </section>
            <section aria-label="故事结局" className="space-y-4">
              <h2 className="flex items-center gap-2 text-base font-semibold text-white/90">
                <Trophy size={16} className="text-brand-accent" />
                故事结局
              </h2>
              <Card className="divide-y divide-white/[0.06] px-5">
                {branchDesign.endings.length === 0 && (
                  <p className="py-5 text-sm text-white/50">暂无结局，可以重新生成方案。</p>
                )}
                {branchDesign.endings.map((e, i) => (
                  <div key={i} className="py-5">
                    <p className="mb-2 text-xs text-white/40">
                      结局 {String(i + 1).padStart(2, "0")}
                    </p>
                    <h3 className="text-sm font-semibold text-white/90">{e.title}</h3>
                    <p className="mt-2 text-xs leading-relaxed text-white/50">{e.description}</p>
                  </div>
                ))}
              </Card>
            </section>
          </div>
          <div className="flex justify-end border-t border-white/[0.08] pt-5">
            <Button variant="primary" size="lg" onClick={() => setActiveStep("visual")}>
              下一步：分镜设计 →
            </Button>
          </div>
        </>
      )}
    </CreationStepLayout>
  );
}
