"use client";
import { ShotKeyImages } from "./ShotKeyImages";
import { KeyframePanel } from "./KeyframePanel";
import { ShotReferencePicker } from "./ShotReferencePicker";
import { mainVideoNode } from "@/lib/canvas/shot-workspace";
import { productionShots } from "@/lib/production/shot-inputs";
import { useCanvasStore } from "@/stores/canvas-store";
import NextImage from "next/image";
import { useEffect, useMemo, useState } from "react";
import { useCreationStore } from "@/stores/creation-store";
import { Button, Card, Badge, Alert, EmptyState, Progress, Select } from "@/components/ui";
import { CreationStepLayout } from "./CreationStepLayout";
import { useShotProduction } from "./useShotProduction";
import { selectedAsset, type AssetKind } from "@/lib/production/types";
import { shotRevision, imageRevision, videoRevision, audioRevision } from "@/lib/production/shots";
import { Film, ImageIcon } from "lucide-react";

const kindLabels = { image: "图片", audio: "配音", video: "视频" };
const statusLabels = {
  queued: "已排队",
  running: "生成中",
  succeeded: "已完成",
  failed: "失败",
  cancelled: "已取消",
};
export function ShotProductionPanel({
  mode,
  onOpenShot,
}: {
  mode: "visual" | "video";
  onOpenShot?: (shotId: string) => void;
}) {
  const rawShots = useCreationStore((s) => s.storyboardShots);
  const nodes = useCanvasStore((s) => s.nodes),
    edges = useCanvasStore((s) => s.edges);
  const shots = useMemo(() => {
    const project = useCanvasStore.getState().toProject();
    return project ? productionShots({ ...project, nodes, edges }) : rawShots;
  }, [rawShots, nodes, edges]);
  const outline = useCreationStore((s) => s.storyOutline);
  const [episodeFilter, setEpisodeFilter] = useState("all");
  const sceneById = new Map(outline?.scenes.map((scene) => [scene.id, scene]));
  const episodeOf = (sceneId: string) => sceneById.get(sceneId)?.episode ?? 1;
  const episodes = [...new Set(shots.map((shot) => episodeOf(shot.sceneId)))].sort((a, b) => a - b);
  const visibleShots = shots.filter(
    (shot) => episodeFilter === "all" || String(episodeOf(shot.sceneId)) === episodeFilter,
  );
  const setActiveStep = useCreationStore((s) => s.setActiveStep);
  const { state, error, busy, applied, generate, select, apply, syncCanvas, loaded } =
    useShotProduction();
  const project = useCanvasStore.getState().toProject();
  const canvasVideos = new Map(
    shots.flatMap((shot) => {
      const main = project && mainVideoNode(project, shot.shotId);
      return main &&
        (main.data.seedanceMode === "reference-to-video" ||
          main.data.seedanceMode === "first-last-frame" ||
          edges.some(
            (edge) =>
              edge.target === main.id &&
              (edge.id.startsWith("outpoint:") || edge.data?.inputRole === "last-frame"),
          ))
        ? [[shot.shotId, main] as const]
        : [];
    }),
  );
  const batchShots = visibleShots.filter((shot) => !canvasVideos.has(shot.shotId));
  const kinds = useMemo<AssetKind[]>(
    () => (mode === "visual" ? ["image"] : ["image", "video", "audio"]),
    [mode],
  );
  const active = state.jobs.filter(
    (j) => kinds.includes(j.kind) && ["queued", "running"].includes(j.status),
  );
  const frameJobs = new Map(
    (state.canvasJobs ?? []).filter((j) => j.kind === "image").map((j) => [j.nodeId, j]),
  );
  const activeFrames =
    mode === "visual"
      ? shots.filter((shot) =>
          ["queued", "running"].includes(frameJobs.get(`shot_frame:${shot.shotId}`)?.status ?? ""),
        ).length
      : 0;
  const done = shots.filter((shot) =>
    kinds.every((kind) => {
      if (kind === "audio") return true;
      const asset = selectedAsset(state, shot.shotId, kind);
      if (!asset) return false;
      const rev =
        kind === "image"
          ? imageRevision(shot)
          : kind === "video"
            ? videoRevision(shot)
            : audioRevision(shot);
      return asset.sourceRevision === rev || asset.sourceRevision === shotRevision(shot);
    }),
  ).length;
  useEffect(() => {
    const step = mode === "visual" ? "visual" : "video";
    const relevant =
      activeFrames > 0 ||
      active.some((j) => shots.some((s) => s.shotId === j.shotId) && kinds.includes(j.kind));
    const status = relevant ? "running" : shots.length && done === shots.length ? "done" : "idle";
    if (useCreationStore.getState().stepStatuses[step] !== status)
      useCreationStore.getState().setStepStatus(step, status);
  }, [mode, done, shots, active, kinds, activeFrames]);
  return (
    <CreationStepLayout
      embedded={mode === "visual"}
      title={mode === "visual" ? "镜头画面" : "视频生成"}
      action={
        mode === "video" ? (
          <Button
            variant="primary"
            disabled={busy || !batchShots.length}
            onClick={() =>
              generate(
                batchShots.map((s) => s.shotId),
                "pipeline",
              )
            }
          >
            生成缺失镜头素材
          </Button>
        ) : undefined
      }
    >
      {episodes.length > 1 && (
        <Select
          ariaLabel="筛选集数"
          value={episodeFilter}
          onChange={setEpisodeFilter}
          options={[
            { value: "all", label: "全部集数" },
            ...episodes.map((episode) => ({ value: String(episode), label: `第 ${episode} 集` })),
          ]}
        />
      )}
      {mode === "video" && (
        <details className="rounded-lg border border-white/10 p-3">
          <summary className="cursor-pointer text-sm">共享关键帧</summary>
          <KeyframePanel />
        </details>
      )}
      {error && <Alert tone="error">{error}</Alert>}
      {state.workerOnline === false && active.length + activeFrames > 0 && (
        <Alert tone="warning">后台服务暂未连接。任务已保存，服务恢复后将继续执行。</Alert>
      )}
      {!!shots.length && (
        <div className="space-y-2 rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3 text-sm">
          <div className="flex flex-wrap justify-between gap-2">
            <span>
              镜头就绪 {done} / {shots.length}
            </span>
            {active.length + activeFrames > 0 && (
              <Badge>{active.length + activeFrames} 个任务进行中</Badge>
            )}
          </div>
          <Progress value={done} max={shots.length} label="镜头生产进度" />
        </div>
      )}
      {!shots.length && (
        <Card>
          <EmptyState icon={<Film size={24} />} title="请先生成分镜脚本">
            <Button onClick={() => setActiveStep("storyboard")}>前往分镜设计</Button>
          </EmptyState>
        </Card>
      )}
      <div
        className={
          mode === "visual"
            ? "grid items-stretch gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"
            : "space-y-5"
        }
      >
        {visibleShots.map((shot) => {
          const main = project && mainVideoNode(project, shot.shotId);
          const canvasGeneration = canvasVideos.has(shot.shotId);
          return (
            <Card
              key={shot.shotId}
              data-shot-id={shot.shotId}
              className={
                mode === "visual"
                  ? "flex min-w-0 flex-col gap-3 overflow-hidden bg-[#171719] p-3"
                  : "space-y-4 p-4"
              }
            >
              <div className="flex flex-wrap justify-between gap-3">
                <div>
                  {mode === "video" && (
                    <p className="text-xs text-white/50">
                      第 {episodeOf(shot.sceneId)} 集 ·{" "}
                      {sceneById.get(shot.sceneId)?.title ?? shot.sceneId} · 镜头{" "}
                      {shot.shotIndex + 1} · {shot.duration} 秒
                    </p>
                  )}
                  <h2
                    className={
                      mode === "visual"
                        ? "line-clamp-2 min-h-10 text-sm font-medium leading-5 text-white/90"
                        : "mt-2 text-base font-semibold text-white/90"
                    }
                  >
                    {shot.action || "未命名镜头"}
                  </h2>
                </div>
                {mode === "video" && (
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() =>
                      canvasGeneration && onOpenShot
                        ? onOpenShot(shot.shotId)
                        : generate([shot.shotId], "pipeline")
                    }
                  >
                    {canvasGeneration && onOpenShot ? "前往画布生成" : "生成该镜头全流程"}
                  </Button>
                )}
              </div>
              <ShotReferencePicker shot={shot} />
              {mode === "video" &&
                (main ? (
                  <ShotKeyImages shotId={shot.shotId} />
                ) : (
                  <Button size="sm" disabled={busy || !loaded} onClick={() => void syncCanvas()}>
                    准备镜头素材与关键画面
                  </Button>
                ))}
              {onOpenShot && (
                <Button size="sm" onClick={() => onOpenShot(shot.shotId)}>
                  打开镜头画布
                </Button>
              )}
              <details className="text-xs text-white/55">
                <summary className="w-fit cursor-pointer rounded focus-visible:outline focus-visible:outline-brand-accent">
                  画面提示词
                </summary>
                <p className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap break-words leading-relaxed text-white/65">
                  {shot.imagePrompt}
                </p>
              </details>
              <div
                className={
                  mode === "video" &&
                  (shot.dialogue?.trim() || selectedAsset(state, shot.shotId, "audio"))
                    ? "grid items-start gap-4 lg:grid-cols-2"
                    : mode === "visual"
                      ? "mt-auto"
                      : "space-y-4"
                }
              >
                {kinds.map((kind) => {
                  const asset = selectedAsset(state, shot.shotId, kind);
                  const versions = state.assets.filter(
                    (a) => a.shotId === shot.shotId && a.kind === kind,
                  );
                  const shotJob = state.jobs
                    .filter((j) => j.shotId === shot.shotId && j.kind === kind)
                    .at(-1);
                  const canvasJob =
                    kind === "image" ? frameJobs.get(`shot_frame:${shot.shotId}`) : undefined;
                  const latest =
                    canvasJob && (!shotJob || canvasJob.createdAt >= shotJob.createdAt)
                      ? canvasJob
                      : shotJob;
                  const running = latest && ["queued", "running"].includes(latest.status);
                  const silent = kind === "audio" && !shot.dialogue?.trim();
                  if (silent && !asset && !running) return null;
                  return (
                    <section
                      key={kind}
                      aria-label={`${shot.shotId} ${kindLabels[kind]}`}
                      className="min-w-0 space-y-3 border-t border-white/[0.08] pt-4"
                    >
                      {mode === "video" && (
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <h3 className="text-sm font-medium">{kindLabels[kind]}</h3>
                          <Badge>
                            {silent
                              ? "无需配音"
                              : running
                                ? statusLabels[latest.status]
                                : asset
                                  ? `已选 v${asset.version}`
                                  : latest
                                    ? statusLabels[latest.status]
                                    : "未生成"}
                          </Badge>
                        </div>
                      )}
                      {mode === "visual" && running && <Badge>{statusLabels[latest.status]}</Badge>}
                      {asset?.mock && <Badge>演示素材</Badge>}
                      {asset?.provider === "canvas" && <Badge>来自画布已选素材</Badge>}
                      {kind === "image" &&
                        (asset ? (
                          <NextImage
                            loading="eager"
                            unoptimized
                            width={640}
                            height={360}
                            src={asset.url}
                            alt={`镜头 ${shot.shotIndex + 1} 图片`}
                            className={
                              mode === "visual"
                                ? "aspect-video w-full rounded-lg bg-black object-contain"
                                : "aspect-video max-h-64 w-full rounded-lg object-contain bg-black"
                            }
                          />
                        ) : (
                          <div className="flex aspect-video flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-white/[0.08] bg-black/20 text-white/30">
                            <ImageIcon size={24} strokeWidth={1.5} />
                            <span className="text-xs">待生成画面</span>
                          </div>
                        ))}
                      {kind === "video" && asset && (
                        <video
                          key={asset.id}
                          controls
                          preload="metadata"
                          src={asset.url}
                          className="aspect-video max-h-72 w-full rounded-lg bg-black"
                          aria-label={`镜头 ${shot.shotIndex + 1} 视频预览`}
                        />
                      )}
                      {kind === "audio" && (
                        <>
                          {shot.dialogue && (
                            <p className="text-xs text-white/60">{shot.dialogue}</p>
                          )}
                          {asset && (
                            <audio
                              key={asset.id}
                              controls
                              preload="none"
                              src={asset.url}
                              aria-label={`镜头 ${shot.shotIndex + 1} 配音预览`}
                              className="w-full"
                            />
                          )}
                        </>
                      )}
                      {!!versions.length && (
                        <Select
                          size="sm"
                          ariaLabel={`${shot.shotId} ${kindLabels[kind]}版本`}
                          value={asset?.id ?? ""}
                          disabled={busy}
                          onChange={select}
                          options={versions.map((v) => {
                            const rev =
                              kind === "image"
                                ? imageRevision(shot)
                                : kind === "video"
                                  ? videoRevision(shot)
                                  : audioRevision(shot);
                            const isCurrent =
                              v.sourceRevision === rev || v.sourceRevision === shotRevision(shot);
                            return {
                              value: v.id,
                              label: `v${v.version} · ${new Date(v.createdAt).toLocaleString("zh-CN")}${!isCurrent ? " · 旧分镜" : ""}`,
                            };
                          })}
                        />
                      )}
                      {asset &&
                        (() => {
                          const rev =
                            kind === "image"
                              ? imageRevision(shot)
                              : kind === "video"
                                ? videoRevision(shot)
                                : audioRevision(shot);
                          return (
                            asset.sourceRevision !== rev &&
                            asset.sourceRevision !== shotRevision(shot)
                          );
                        })() && (
                          <Alert tone="warning">
                            此版本来自旧分镜。更新镜头素材后再应用到剧情。
                          </Alert>
                        )}
                      {latest?.error && (
                        <Alert tone={latest.status === "failed" ? "error" : "warning"}>
                          {latest.error}
                        </Alert>
                      )}
                      {!silent && (
                        <Button
                          variant={mode === "visual" ? "primary" : "outline"}
                          className={mode === "visual" ? "w-full" : undefined}
                          disabled={busy || !!running}
                          onClick={() =>
                            kind === "video" && canvasGeneration && onOpenShot
                              ? onOpenShot(shot.shotId)
                              : generate([shot.shotId], kind)
                          }
                        >
                          {running
                            ? statusLabels[latest.status]
                            : latest?.status === "failed"
                              ? `重试${kindLabels[kind]}`
                              : asset
                                ? `重新生成${kindLabels[kind]}`
                                : `生成${kindLabels[kind]}`}
                        </Button>
                      )}
                    </section>
                  );
                })}
              </div>
            </Card>
          );
        })}
      </div>
      {!!shots.length && (
        <div className="flex flex-wrap justify-end gap-3 border-t border-white/10 pt-5">
          {mode === "visual" ? (
            <Button variant="primary" onClick={() => setActiveStep("video")}>
              下一步：视频生成 →
            </Button>
          ) : (
            <>
              <Button disabled={busy} onClick={apply}>
                将选中版本应用到剧情
              </Button>
              <Button variant="primary" onClick={() => setActiveStep("validate")}>
                前往校验与发布 →
              </Button>
            </>
          )}
        </div>
      )}
      {applied && <Alert tone="success">已应用到剧情</Alert>}
    </CreationStepLayout>
  );
}
