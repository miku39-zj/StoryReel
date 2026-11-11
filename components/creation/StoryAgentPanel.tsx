/**
 * 01 故事与剧本 Agent — 生成大纲、角色关系、剧情节点和对白
 */
"use client";
import { StoryCastPicker } from "./StoryCastPicker";
import { initializeCharacterAssets } from "@/lib/story/character-design";

import { CreationReferenceList, CreationReferencePicker } from "./CreationReferences";
import { attachCreationReferences } from "@/lib/story/creation-references";
import { useCreationRequest } from "./useCreationRequest";
import {
  isLinearWork,
  storyBrief,
  storySource,
  sameStorySource,
} from "@/lib/story/creation-brief";
import { useState } from "react";
import { useCreationStore, creationSnapshot } from "@/stores/creation-store";
import { useCanvasStore } from "@/stores/canvas-store";
import { outlineToProject } from "@/lib/story/convert";
import { Sparkles, ImagePlus, Film, Clock, Loader2, RefreshCw, AlertCircle } from "lucide-react";
import { nanoid } from "nanoid";
import type { StoryOutline } from "@/stores/creation-store";
import { Button, Textarea, Card, Label } from "@/components/ui";
import { Select } from "@/components/ui/select";
import { ConfirmDialog, Alert } from "@/components/ui";
import { backupProject } from "@/lib/story/backup";
import { StoryInspirations } from "./StoryInspirations";
import { StoryBlueprint } from "./StoryBlueprint";
import { storyOutlineSchema } from "@/lib/story/creation-schema";

const ACCENT = "#ff715b";
const GENRES = ["自动", "悬疑", "爱情", "科幻", "奇幻", "恐怖", "喜剧"];
const STYLES = ["电影叙事", "第一人称", "纪录片", "动画风格"];
const DURATIONS = ["约 2 分钟", "约 4 分钟", "约 8 分钟", "自动"];
const MAX_LEN = 2000;

export function StoryAgentPanel() {
  const { request: requestDraft, cancel: cancelDraft } = useCreationRequest();
  const { request: requestExpansion, cancel: cancelExpansion } = useCreationRequest();
  const [inspiring, setInspiring] = useState(false);
  const [isExpanding, setIsExpanding] = useState(false);
  const [expansionError, setExpansionError] = useState<string | null>(null);
  const userPrompt = useCreationStore((s) => s.userPrompt);
  const storyOutline = useCreationStore((s) => s.pendingStoryOutline ?? s.storyOutline);
  const streamingText = useCreationStore((s) => s.streamingText);
  const stepStatus = useCreationStore((s) => s.stepStatuses.story);
  const setUserPrompt = useCreationStore((s) => s.setUserPrompt);
  const setStepStatus = useCreationStore((s) => s.setStepStatus);
  const appendStreaming = useCreationStore((s) => s.appendStreamingText);
  const clearStreaming = useCreationStore((s) => s.clearStreamingText);
  const setActiveStep = useCreationStore((s) => s.setActiveStep);
  const loadProject = useCanvasStore((s) => s.replaceProject);
  const setProjectName = useCanvasStore((s) => s.setProjectName);

  const rawBrief = useCreationStore((s) => s.brief);
  const brief = storyBrief(rawBrief);
  const pending = useCreationStore((s) => s.pendingStoryOutline);
  const pendingSource = useCreationStore((s) => s.pendingStorySource);
  const appliedSource = useCreationStore((s) => s.appliedStorySource);
  const resultSource = pending ? pendingSource : appliedSource;
  const stale = !!storyOutline && !sameStorySource(storySource(userPrompt, brief), resultSource);
  const setBrief = useCreationStore((s) => s.setBrief);
  const genre = brief.genre;
  const setGenre = (genre: string) => setBrief({ ...brief, genre });
  const style = brief.narrativeStyle;
  const setStyle = (narrativeStyle: string) => setBrief({ ...brief, narrativeStyle });
  const duration =
    brief.targetDurationSeconds === 120
      ? DURATIONS[0]
      : brief.targetDurationSeconds === 480
        ? DURATIONS[2]
        : brief.targetDurationSeconds === 240
          ? DURATIONS[1]
          : "自动";
  const setDuration = (value: string) =>
    setBrief({
      ...brief,
      targetDurationSeconds:
        value === "自动"
          ? undefined
          : value === DURATIONS[0]
            ? 120
            : value === DURATIONS[1]
              ? 240
              : 480,
    });
  const [selectingReference, setSelectingReference] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const projectId = useCanvasStore((s) => s.projectId);

  const isRunning = stepStatus === "running";
  const isBusy = isRunning || isExpanding || inspiring || applying;
  const isError = stepStatus === "error";

  const handleExpand = async () => {
    if (!userPrompt.trim() || isBusy) return;
    setIsExpanding(true);
    setExpansionError(null);
    try {
      const result = (await requestExpansion("/api/ai/expand-idea", {
        prompt: userPrompt,
        brief,
      })) as { prompt?: unknown };
      if (
        useCanvasStore.getState().projectId !== projectId ||
        useCreationStore.getState().userPrompt !== userPrompt
      )
        return;
      if (
        typeof result.prompt !== "string" ||
        !result.prompt.trim() ||
        result.prompt.length > MAX_LEN
      )
        throw new Error("扩写结果无效，请重试；原文已保留。");
      setUserPrompt(result.prompt);
    } catch (error) {
      if (useCanvasStore.getState().projectId !== projectId) return;
      setExpansionError(
        (error as Error).name === "AbortError"
          ? "已取消扩写，原文已保留"
          : (error as Error).message,
      );
    } finally {
      setIsExpanding(false);
    }
  };

  const handleGenerate = async () => {
    if (!userPrompt.trim() || isBusy) return;
    setStepStatus("story", "running");
    setGenerationError(null);
    clearStreaming();

    try {
      const result = await requestDraft(
        "/api/ai/script",
        { prompt: userPrompt, brief },
        (chunk) => {
          if (useCanvasStore.getState().projectId !== projectId)
            throw new DOMException("项目已切换", "AbortError");
          appendStreaming(chunk);
        },
      );
      if (useCanvasStore.getState().projectId !== projectId) return;
      useCreationStore.setState({
        pendingStoryBrief: brief,
        pendingStorySource: storySource(userPrompt, brief),
        pendingStoryOutline: storyOutlineSchema.parse(result) as StoryOutline,
      });
      setStepStatus("story", useCreationStore.getState().storyOutline ? "done" : "idle");
    } catch (err) {
      console.error(err);
      if (useCanvasStore.getState().projectId !== projectId) return;
      setGenerationError(
        (err as Error).name === "AbortError" ? "已取消生成" : (err as Error).message,
      );
      setStepStatus("story", "error");
    }
  };

  const handleApplyToCanvas = async () => {
    if (!storyOutline || !pending || !pendingSource || stale || isBusy) return;
    setApplying(true);
    setApplyError(null);
    try {
      const appliedBrief = pendingSource.brief;
      const current = useCanvasStore.getState().toProject();
      if (current?.nodes.length) await backupProject(current);
      if (
        useCanvasStore.getState().projectId !== projectId ||
        !sameStorySource(
          pendingSource,
          storySource(useCreationStore.getState().userPrompt, useCreationStore.getState().brief),
        )
      )
        return;
      const project = attachCreationReferences(
        outlineToProject(storyOutline, current?.id ?? nanoid(10), storyOutline.title),
        appliedBrief,
      );
      project.createdAt = current?.createdAt ?? project.createdAt;
      project.revision = current?.revision;
      project.initialVariables = current?.initialVariables;
      project.creation = {
        ...creationSnapshot(),
        brief: appliedBrief,
        appliedStorySource: pendingSource,
        pendingStorySource: null,
        userPrompt: pendingSource.prompt,
        activeStep: isLinearWork(appliedBrief) ? "storyboard" : "branch",
        storyOutline,
        pendingStoryOutline: null,
        pendingStoryBrief: null,
        branchDesign: null,
        storyboardShots: [],
        assets: [],
        stepStatuses: {
          story: "done",
          branch: "idle",
          storyboard: "idle",
          visual: "idle",
          video: "idle",
          validate: "idle",
        },
      } as ReturnType<typeof creationSnapshot>;
      loadProject(initializeCharacterAssets(project));
      setProjectName(storyOutline.title);
      setActiveStep(isLinearWork(appliedBrief) ? "storyboard" : "branch");
    } catch (error) {
      setApplyError((error as Error).message);
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="story-workspace h-full overflow-y-auto">
      <div className="story-workspace-grid grid grid-cols-1 min-[1280px]:grid-cols-[minmax(0,1fr)_288px] items-start gap-8 px-5 lg:px-8 py-7 max-w-[1200px] mx-auto pb-12">
        {/* ═══ 主列 ═══ */}
        <div className="flex-1 min-w-0">
          <h1 className="mb-6 text-xl font-semibold text-white tracking-tight">故事与剧本</h1>

          {isRunning && (
            <Button variant="ghost" onClick={cancelDraft}>
              取消生成
            </Button>
          )}
          {isExpanding && (
            <Button variant="ghost" onClick={cancelExpansion}>
              取消扩写
            </Button>
          )}
          {/* 故事设定卡片 */}
          <fieldset disabled={isBusy} className="story-settings">
            <div className="grid grid-cols-1 gap-5 mb-6 min-[900px]:grid-cols-[180px_minmax(0,1fr)]">
              <div>
                <Label htmlFor="story-mode">叙事形式</Label>
                <Select
                  id="story-mode"
                  ariaLabel="叙事形式"
                  disabled={isBusy}
                  value={brief.mode}
                  onChange={(mode) => setBrief({ ...brief, mode: mode as typeof brief.mode })}
                  options={[
                    { value: "interactive", label: "互动剧" },
                    { value: "linear", label: "线性短剧" },
                  ]}
                />
              </div>
              <div>
                {/* 故事类型 */}
                <Label id="story-genre-label">故事题材</Label>
                <div
                  role="group"
                  aria-labelledby="story-genre-label"
                  className="flex gap-1.5 flex-wrap"
                >
                  {GENRES.map((g) => {
                    const on = genre === g;
                    return (
                      <Button
                        key={g}
                        onClick={() => setGenre(g)}
                        aria-pressed={on}
                        size="sm"
                        className="h-8 px-3 rounded-lg text-[12px] font-medium"
                        style={{
                          background: on ? "rgba(255,113,91,0.12)" : "transparent",
                          color: on ? ACCENT : "rgba(255,255,255,0.6)",
                          border: `1px solid ${on ? "rgba(255,113,91,0.35)" : "rgba(255,255,255,0.1)"}`,
                          boxShadow: "none",
                        }}
                      >
                        {g}
                      </Button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* 故事创意 */}
            <div className="flex items-center justify-between gap-3 mb-2">
              <Label htmlFor="story-prompt" className="mb-0">
                故事创意
              </Label>
              <Button
                size="sm"
                variant="secondary"
                className="gap-1.5 text-xs"
                onClick={() => setSelectingReference(true)}
              >
                <ImagePlus size={14} /> 参考图片
                {brief.references.length > 0 ? ` · ${brief.references.length}` : ""}
              </Button>
            </div>
            <StoryCastPicker
              value={brief.characters ?? []}
              onChange={(characters) => setBrief({ ...brief, characters })}
            />
            <CreationReferenceList
              value={brief.references}
              onChange={(references) => setBrief({ ...brief, references })}
            />
            <CreationReferencePicker
              open={selectingReference}
              onClose={() => setSelectingReference(false)}
              value={brief.references}
              onChange={(references) => setBrief({ ...brief, references })}
            />
            <div className="rounded-xl p-4 mb-5 border border-white/10 bg-[#1d1d1f] transition-[border-color,box-shadow] focus-within:border-brand-accent/55 focus-within:shadow-[0_0_0_3px_rgba(255,113,91,0.08)]">
              <Textarea
                id="story-prompt"
                aria-describedby="story-prompt-count"
                className="w-full border-0 bg-transparent px-0 py-0 text-sm leading-7 resize-y min-h-[150px] max-h-[420px] focus:shadow-none"
                placeholder="写下人物、设定或故事片段…"
                value={userPrompt}
                maxLength={MAX_LEN}
                onChange={(e) => setUserPrompt(e.target.value)}
                disabled={isBusy}
                style={{ caretColor: ACCENT }}
              />
              <div className="flex items-center justify-between mt-2">
                <span
                  id="story-prompt-count"
                  className="text-[12px]"
                  style={{ color: "rgba(255,255,255,0.5)" }}
                >
                  {userPrompt.length} / {MAX_LEN}
                </span>
                <Button
                  onClick={handleExpand}
                  disabled={isBusy || !userPrompt.trim()}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors"
                  style={{
                    background: "rgba(255,113,91,0.1)",
                    color: ACCENT,
                    border: "1px solid rgba(255,113,91,0.25)",
                  }}
                >
                  {isExpanding ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <Sparkles size={12} />
                  )}
                  {isExpanding ? "AI 扩写中…" : "AI 扩写"}
                </Button>
              </div>
            </div>

            {expansionError && (
              <p role="alert" className="text-[12px] text-red-400 mb-4">
                {expansionError}
              </p>
            )}

            {/* 风格 + 时长 */}
            <div
              className={`grid grid-cols-1 gap-4 mb-6 ${isLinearWork(brief) ? "sm:grid-cols-2" : "sm:grid-cols-3"}`}
            >
              <div>
                <Label htmlFor="story-style">叙事风格</Label>
                <Select
                  disabled={isBusy}
                  id="story-style"
                  icon={<Film size={15} />}
                  value={style}
                  options={STYLES}
                  onChange={setStyle}
                />
              </div>
              <div>
                <Label htmlFor="story-duration">目标时长</Label>
                <Select
                  disabled={isBusy}
                  id="story-duration"
                  icon={<Clock size={15} />}
                  value={duration}
                  options={DURATIONS}
                  onChange={setDuration}
                />
              </div>
              {!isLinearWork(brief) && (
                <div>
                  <Label htmlFor="story-decisions">决策点</Label>
                  <Select
                    id="story-decisions"
                    disabled={isBusy}
                    ariaLabel="决策点数量"
                    value={brief.decisionPoints ? String(brief.decisionPoints) : "自动"}
                    onChange={(value) =>
                      setBrief({
                        ...brief,
                        decisionPoints: value === "自动" ? undefined : Number(value),
                      })
                    }
                    options={["自动", "1", "2", "3"]}
                  />
                </div>
              )}
            </div>

            {/* 生成按钮 */}
            <div className="flex items-center gap-3 flex-wrap">
              <Button
                onClick={handleGenerate}
                disabled={isBusy || !userPrompt.trim()}
                variant="primary"
                size="lg"
                className="h-10 gap-2 px-5 text-[13px] font-semibold"
              >
                {isRunning ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : (
                  <Sparkles size={18} />
                )}
                {isRunning ? "AI 生成中…" : storyOutline ? "重新生成故事大纲" : "生成故事大纲"}
              </Button>
            </div>

            {isError && (
              <p
                role="alert"
                className="flex items-center gap-1.5 text-[12px] mt-3"
                style={{ color: "#f87171" }}
              >
                <AlertCircle size={13} /> {generationError || "生成失败，请检查服务配置后重试"}
              </p>
            )}

            {isRunning && streamingText && (
              <div
                className="mt-4 rounded-xl p-3 text-[12px] font-mono whitespace-pre-wrap max-h-40 overflow-y-auto"
                style={{
                  background: "rgba(0,0,0,0.4)",
                  border: "1px solid rgba(255,255,255,0.06)",
                  color: "rgba(255,255,255,0.45)",
                }}
              >
                {streamingText}
              </div>
            )}
          </fieldset>

          {storyOutline && stale && (
            <Alert tone="warning" className="mt-4">
              {resultSource
                ? "创意或设置已修改，请重新生成后应用。"
                : "旧结果未记录生成设置，请重新生成后应用。"}
              {resultSource && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={isBusy}
                  onClick={() => {
                    setBrief(resultSource.brief);
                    setUserPrompt(resultSource.prompt);
                  }}
                >
                  恢复结果对应设置
                </Button>
              )}
            </Alert>
          )}
          {/* 生成结果 */}
          {storyOutline && !isBusy && (
            <Card className="p-4 mt-5 border-brand-accent/20">
              <div className="flex items-start justify-between gap-4 mb-4">
                <div>
                  <h3 className="text-[18px] font-semibold text-white">{storyOutline.title}</h3>
                  <p
                    className="text-[13px] mt-1 leading-relaxed"
                    style={{ color: "rgba(255,255,255,0.55)" }}
                  >
                    {storyOutline.description}
                  </p>
                </div>
                <Button variant="secondary" size="sm" onClick={handleGenerate}>
                  <RefreshCw size={12} /> 重新生成
                </Button>
              </div>
              <div className="flex gap-3">
                <Stat label="角色" value={storyOutline.characters?.length ?? 0} />
                <Stat label="场景节点" value={storyOutline.scenes?.length ?? 0} />
              </div>
              {applyError && <Alert tone="error">{applyError}</Alert>}
              {pending && (
                <div className="mt-3 flex justify-end">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={isBusy}
                    onClick={() =>
                      useCreationStore.setState({
                        pendingStoryOutline: null,
                        pendingStoryBrief: null,
                        pendingStorySource: null,
                      })
                    }
                  >
                    放弃草稿
                  </Button>
                </div>
              )}
              {pending && (
                <ConfirmDialog
                  title="应用新故事到画布？"
                  description="将替换剧情结构并重置后续生产步骤。原画布会先保存为独立备份，可在项目列表找回，也可在画布撤销。"
                  confirmText="备份并应用"
                  danger={false}
                  onConfirm={() => void handleApplyToCanvas()}
                >
                  <Button
                    variant="primary"
                    disabled={applying || stale}
                    className="w-full mt-5 h-12 text-[14px] font-semibold rounded-xl"
                  >
                    {applying
                      ? "备份并应用中…"
                      : isLinearWork(resultSource?.brief ?? brief)
                        ? "应用到剧情画布，进入分镜设计 →"
                        : "应用到剧情画布，进入分支设计 →"}
                  </Button>
                </ConfirmDialog>
              )}
            </Card>
          )}

          <StoryInspirations
            key={projectId ?? "new"}
            disabled={isRunning || isExpanding || applying}
            onBusyChange={setInspiring}
          />
        </div>

        {/* ═══ 右列 ═══ */}
        <StoryBlueprint
          outline={storyOutline}
          source={resultSource}
          pending={!!pending}
          stale={stale}
        />
      </div>
    </div>
  );
}

// ── 小组件 ────────────────────────────────────────────────────

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex-1 rounded-xl px-4 py-3" style={{ background: "rgba(255,255,255,0.03)" }}>
      <p className="text-[20px] font-bold text-white">{value}</p>
      <p className="text-[11px]" style={{ color: "rgba(255,255,255,0.4)" }}>
        {label}
      </p>
    </div>
  );
}
