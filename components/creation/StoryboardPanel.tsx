/**
 * 03 分镜 Agent — 将每个剧情节点拆成镜头，生成画面描述和运镜指令
 */
"use client";

import { Fragment, useState, useMemo } from "react";
import { useCreationRequest } from "./useCreationRequest";
import { useCreationStore } from "@/stores/creation-store";
import { useCanvasStore } from "@/stores/canvas-store";
import { Camera, Sparkles, ChevronDown, Link2, Unlink } from "lucide-react";
import { normalizeShots, type StoryboardShot } from "@/lib/production/shots";
import {
  Button,
  Card,
  Badge,
  EmptyState,
  Textarea,
  Input,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui";
import {
  StorySummary,
  CreationStepLayout,
  StoryPrerequisite,
  GenerationFeedback,
} from "./CreationStepLayout";

/** Derive the ordered keyframe nodes from the shot list (A → B → C → …). */
function buildKeyframeChain(shots: StoryboardShot[]) {
  const frames: Array<{ id: string; label: string; sharedBy: string[] }> = [];
  const seen = new Map<string, number>();
  const sorted = [...shots].sort((a, b) => a.shotIndex - b.shotIndex);
  for (const shot of sorted) {
    const fid = shot.firstFrameId ?? `auto:${shot.shotId}:first`;
    const lid = shot.lastFrameId ?? `auto:${shot.shotId}:last`;
    for (const id of [fid, lid]) {
      if (!seen.has(id)) {
        seen.set(id, frames.length);
        frames.push({ id, label: "", sharedBy: [shot.shotId] });
      } else {
        frames[seen.get(id)!].sharedBy.push(shot.shotId);
      }
    }
  }
  // Label frames as A, B, C …
  frames.forEach((f, i) => {
    f.label = i < 26 ? String.fromCharCode(65 + i) : `F${i + 1}`;
  });
  return frames;
}

export function StoryboardPanel() {
  const { request: requestDraft, cancel: cancelDraft } = useCreationRequest();
  const [error, setError] = useState<string | null>(null);
  const storyOutline = useCreationStore((s) => s.storyOutline);
  const storyboardShots = useCreationStore((s) => s.storyboardShots);
  const stepStatus = useCreationStore((s) => s.stepStatuses.storyboard);
  const streamingText = useCreationStore((s) => s.streamingText);
  const setStoryboard = useCreationStore((s) => s.setStoryboardShots);
  const setStepStatus = useCreationStore((s) => s.setStepStatus);
  const appendStreaming = useCreationStore((s) => s.appendStreamingText);
  const clearStreaming = useCreationStore((s) => s.clearStreamingText);
  const setActiveStep = useCreationStore((s) => s.setActiveStep);

  const [editingShotId, setEditingShotId] = useState<string | null>(null);

  const isRunning = stepStatus === "running";

  // Derive keyframe chain for display
  const keyframeChain = useMemo(() => buildKeyframeChain(storyboardShots), [storyboardShots]);

  /** Toggle shared last/first frame between two consecutive shots. */
  const toggleSharedFrame = (shotA: StoryboardShot, shotB: StoryboardShot) => {
    const alreadyShared = shotA.lastFrameId && shotA.lastFrameId === shotB.firstFrameId;
    if (alreadyShared) {
      // Break the shared frame — give shotB its own first frame
      setStoryboard(
        storyboardShots.map((s) =>
          s.shotId === shotB.shotId ? { ...s, firstFrameId: `kf_${s.shotId}_first` } : s,
        ),
      );
    } else {
      // Share: set shotA's lastFrameId as shotB's firstFrameId
      const sharedId = shotA.lastFrameId ?? `kf_${shotA.shotId}_last`;
      setStoryboard(
        storyboardShots.map((s) => {
          if (s.shotId === shotA.shotId) return { ...s, lastFrameId: sharedId };
          if (s.shotId === shotB.shotId) return { ...s, firstFrameId: sharedId };
          return s;
        }),
      );
    }
  };

  const handleGenerate = async () => {
    if (!storyOutline) return;
    setError(null);
    setStepStatus("storyboard", "running");
    clearStreaming();
    const projectId = useCanvasStore.getState().projectId;
    try {
      const result = await requestDraft(
        "/api/ai/storyboard-agent",
        {
          brief: useCreationStore.getState().brief,
          storyOutline,
          creativeBrief: useCreationStore.getState().userPrompt,
          branchDesign: useCreationStore.getState().branchDesign,
        },
        (chunk) => {
          if (useCanvasStore.getState().projectId !== projectId)
            throw new DOMException("项目已切换", "AbortError");
          appendStreaming(chunk);
        },
      );
      if (useCanvasStore.getState().projectId !== projectId) return;
      const shots = normalizeShots(result, storyboardShots);
      if (shots.some((shot) => !storyOutline.scenes.some((scene) => scene.id === shot.sceneId)))
        throw new Error("分镜引用了不存在的场景");
      // Auto-assign shared keyframe IDs for consecutive shots in the same scene
      const withFrames = shots.map((shot, i) => {
        const prev = i > 0 ? shots[i - 1] : null;
        const sameScene = prev && prev.sceneId === shot.sceneId;
        return {
          ...shot,
          firstFrameId:
            shot.firstFrameId ??
            (sameScene && prev!.lastFrameId
              ? prev!.lastFrameId
              : `kf_${shot.shotId}_first`),
          lastFrameId: shot.lastFrameId ?? `kf_${shot.shotId}_last`,
        };
      });
      // For consecutive same-scene shots, make last frame of shot N = first frame of shot N+1
      const linked = withFrames.map((shot, i) => {
        const next = i < withFrames.length - 1 ? withFrames[i + 1] : null;
        if (next && next.sceneId === shot.sceneId) {
          return { ...shot, lastFrameId: next.firstFrameId! };
        }
        return shot;
      });
      setStoryboard(linked);
      setStepStatus("storyboard", "done");
    } catch (e) {
      console.error(e);
      if (useCanvasStore.getState().projectId !== projectId) return;
      setError(e instanceof Error ? e.message : "生成失败，请重试");
      setStepStatus("storyboard", "error");
    }
  };

  const page = { title: "分镜设计" };
  if (!storyOutline)
    return (
      <CreationStepLayout {...page}>
        <StoryPrerequisite icon={<Camera size={24} />} />
      </CreationStepLayout>
    );

  const sharedCount = keyframeChain.filter((f) => f.sharedBy.length > 1).length;

  return (
    <CreationStepLayout
      {...page}
      action={
        <Button variant="primary" onClick={handleGenerate} disabled={isRunning}>
          <Sparkles size={16} />
          {isRunning ? "生成分镜中…" : storyboardShots.length ? "重新生成分镜" : "生成分镜脚本"}
        </Button>
      }
    >
      <StorySummary title={storyOutline.title}>
        <Badge>{storyOutline.scenes.length} 个场景</Badge>
        <Badge>{storyboardShots.length} 个镜头</Badge>
        <Badge>总时长 {storyboardShots.reduce((total, shot) => total + shot.duration, 0)} 秒</Badge>
        {sharedCount > 0 && (
          <Badge className="border-brand-accent/30 text-brand-accent">
            <Link2 size={11} className="mr-1" />
            {sharedCount} 个共享帧
          </Badge>
        )}
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
      {!storyboardShots.length && !isRunning && (
        <Card>
          <EmptyState icon={<Camera size={24} />} title="暂无分镜脚本" />
        </Card>
      )}
      {storyboardShots.length > 0 && !isRunning && (
        <>
          {/* ── 关键帧链可视化 ── */}
          <Card className="bg-white/[0.02] p-4">
            <h2 className="mb-3 text-sm font-semibold text-white/80">关键帧链</h2>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {keyframeChain.map((frame, i) => (
                <Fragment key={frame.id}>
                  <div
                    className={`flex h-7 w-7 items-center justify-center rounded-md border text-[11px] font-bold ${
                      frame.sharedBy.length > 1
                        ? "border-brand-accent/50 bg-brand-accent/10 text-brand-accent"
                        : "border-white/[0.12] bg-white/[0.04] text-white/55"
                    }`}
                    title={
                      frame.sharedBy.length > 1
                        ? `共享帧：镜头 ${frame.sharedBy.map((id) => storyboardShots.findIndex((s) => s.shotId === id) + 1).join(" 和 ")} 共用此帧`
                        : `独立帧`
                    }
                  >
                    {frame.label}
                  </div>
                  {i < keyframeChain.length - 1 && (
                    <div className="h-px w-3 bg-white/[0.12]" />
                  )}
                </Fragment>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-white/35">
              橙色节点为共享帧，两镜共用同一张图生成一次。可在下方镜头行内切换衔接方式。
            </p>
          </Card>

          <Card className="min-w-0 overflow-hidden bg-white/[0.02]">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.08] px-4 py-3">
              <h2 className="text-base font-semibold text-white/90">分镜脚本</h2>
            </div>
            <Table className="min-w-[820px] [&_th]:px-3 [&_th]:py-2 [&_td]:px-3 [&_td]:py-3">
              <caption className="sr-only">{storyOutline.title}的分镜脚本</caption>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-36">场景 / 镜号</TableHead>
                  <TableHead className="w-20">景别</TableHead>
                  <TableHead className="w-28">运镜</TableHead>
                  <TableHead className="w-24">时长</TableHead>
                  <TableHead className="w-28">首尾帧</TableHead>
                  <TableHead>画面描述</TableHead>
                  <TableHead className="w-20">
                    <span className="sr-only">编辑</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {storyboardShots.map((shot, i) => {
                  const nextShot = i < storyboardShots.length - 1 ? storyboardShots[i + 1] : null;
                  const isSharedWithNext =
                    nextShot &&
                    shot.lastFrameId &&
                    shot.lastFrameId === nextShot.firstFrameId;
                  const firstLabel =
                    keyframeChain.find((f) => f.id === (shot.firstFrameId ?? ""))?.label ?? "?";
                  const lastLabel =
                    keyframeChain.find((f) => f.id === (shot.lastFrameId ?? ""))?.label ?? "?";

                  return (
                  <Fragment key={shot.shotId ?? `${shot.sceneId}-${shot.shotIndex}-${i}`}>
                    <TableRow>
                      <TableCell>
                        <p className="text-white/85">
                          {storyOutline.scenes.find((sc) => sc.id === shot.sceneId)?.title ??
                            shot.sceneId}
                        </p>
                        <p className="mt-1 text-xs text-white/40">
                          镜头 {String(shot.shotIndex + 1).padStart(2, "0")}
                        </p>
                      </TableCell>
                      <TableCell>
                        <Badge>{shot.frameType}</Badge>
                      </TableCell>
                      <TableCell>{shot.cameraMove}</TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums">
                        <Input
                          type="number"
                          min="0.1"
                          max="10"
                          step="0.1"
                          aria-label={`${shot.shotId} 时长`}
                          value={shot.duration}
                          onChange={(e) => {
                            const duration = Number(e.target.value);
                            if (duration > 0 && duration <= 10)
                              setStoryboard(
                                storyboardShots.map((s) =>
                                  s.shotId === shot.shotId ? { ...s, duration } : s,
                                ),
                              );
                          }}
                          className="h-7 w-14 px-2 text-xs"
                        />{" "}
                        秒
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1 text-[11px]">
                          <span
                            className={`flex h-5 w-5 items-center justify-center rounded border text-[10px] font-bold ${
                              keyframeChain.find((f) => f.id === shot.firstFrameId)?.sharedBy.length ?? 0 > 1
                                ? "border-brand-accent/40 bg-brand-accent/10 text-brand-accent"
                                : "border-white/[0.12] bg-white/[0.04] text-white/55"
                            }`}
                          >
                            {firstLabel}
                          </span>
                          <span className="text-white/30">→</span>
                          <span
                            className={`flex h-5 w-5 items-center justify-center rounded border text-[10px] font-bold ${
                              keyframeChain.find((f) => f.id === shot.lastFrameId)?.sharedBy.length ?? 0 > 1
                                ? "border-brand-accent/40 bg-brand-accent/10 text-brand-accent"
                                : "border-white/[0.12] bg-white/[0.04] text-white/55"
                            }`}
                          >
                            {lastLabel}
                          </span>
                          {nextShot && nextShot.sceneId === shot.sceneId && (
                            <button
                              type="button"
                              title={isSharedWithNext ? "断开与下一镜的共享帧" : "与下一镜共享尾帧"}
                              onClick={() => toggleSharedFrame(shot, nextShot)}
                              className="ml-1 rounded p-0.5 text-white/40 hover:text-brand-accent"
                            >
                              {isSharedWithNext ? <Link2 size={12} /> : <Unlink size={12} />}
                            </button>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <p>{shot.action}</p>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-expanded={editingShotId === shot.shotId}
                          aria-controls={`shot-editor-${shot.shotId}`}
                          aria-label={`编辑镜头 ${shot.shotIndex + 1} · ${storyOutline.scenes.find((sc) => sc.id === shot.sceneId)?.title ?? shot.sceneId}`}
                          onClick={() =>
                            setEditingShotId(editingShotId === shot.shotId ? null : shot.shotId)
                          }
                        >
                          编辑
                          <ChevronDown
                            size={12}
                            className={editingShotId === shot.shotId ? "rotate-180" : ""}
                          />
                        </Button>
                      </TableCell>
                    </TableRow>
                    {editingShotId === shot.shotId && (
                      <TableRow className="bg-black/15 hover:bg-black/15">
                        <TableCell colSpan={7}>
                          <div
                            id={`shot-editor-${shot.shotId}`}
                            className="grid gap-3 sm:grid-cols-[2fr_1fr]"
                          >
                            <label className="space-y-1.5 block text-xs text-white/60">
                              画面提示词
                              <Textarea
                                aria-label={`${shot.shotId} 画面提示词`}
                                value={shot.imagePrompt}
                                onChange={(e) => {
                                  if (e.target.value.trim())
                                    setStoryboard(
                                      storyboardShots.map((s) =>
                                        s.shotId === shot.shotId
                                          ? { ...s, imagePrompt: e.target.value }
                                          : s,
                                      ),
                                    );
                                }}
                                rows={4}
                              />
                            </label>
                            <label className="space-y-1.5 block text-xs text-white/60">
                              对白
                              <Textarea
                                aria-label={`${shot.shotId} 对白`}
                                value={shot.dialogue ?? ""}
                                onChange={(e) =>
                                  setStoryboard(
                                    storyboardShots.map((s) =>
                                      s.shotId === shot.shotId
                                        ? { ...s, dialogue: e.target.value }
                                        : s,
                                    ),
                                  )
                                }
                                rows={4}
                              />
                            </label>
                          </div>
                          <p className="mt-2 text-xs text-white/40">光线：{shot.lighting}</p>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
          <div className="flex justify-end border-t border-white/[0.08] pt-5">
            <Button variant="primary" size="lg" onClick={() => setActiveStep("visual")}>
              下一步：角色与画面 →
            </Button>
          </div>
        </>
      )}
    </CreationStepLayout>
  );
}

