"use client";
import { routeWorkspaceGraph } from "@/lib/canvas/route-workspace";
import { ShotContinuity } from "./ShotContinuity";
import { ChevronLeft, ChevronRight, Film } from "lucide-react";
import { useReactFlow } from "@xyflow/react";
import { useCanvasStore } from "@/stores/canvas-store";
import { useCreationStore } from "@/stores/creation-store";
import {
  mainVideoNode,
  shotWorkspaceGraph,
  workspaceVideo,
  videoWorkspaceId,
} from "@/lib/canvas/shot-workspace";
import { Button, Select } from "@/components/ui";

export function ShotWorkspaceBar() {
  const shotId = useCanvasStore((s) => s.activeShotId);
  const allShots = useCreationStore((s) => s.storyboardShots);
  const outline = useCreationStore((s) => s.storyOutline);
  useCanvasStore((s) => s.nodes);
  useCanvasStore((s) => s.edges);
  useCanvasStore((s) => s.shotWorkspaces);
  const flow = useReactFlow(),
    project = useCanvasStore.getState().toProject();
  if (!shotId || !project) return null;
  const current = allShots.find((shot) => shot.shotId === shotId);
  const shots = allShots
    .filter((shot) => shot.sceneId === current?.sceneId)
    .sort((a, b) => a.shotIndex - b.shotIndex);
  const index = shots.findIndex((s) => s.shotId === shotId);
  const graph = shotWorkspaceGraph(project, shotId),
    main = mainVideoNode(project, shotId);
  const switchShot = (id: string) => {
    const store = useCanvasStore.getState();
    store.saveShotViewport(flow.getViewport());
    store.setActiveShot(id);
  };
  const video = workspaceVideo(project, shotId);
  if (video) {
    const videos = routeWorkspaceGraph(project.nodes, project.edges).nodes.filter(
      (node) => node.type === "video",
    );
    return (
      <div className="absolute left-3 top-20 z-20 flex max-w-[calc(100%-24px)] items-center gap-2 rounded-xl border border-white/10 bg-oii-surface p-1.5 sm:left-4">
        <Button
          size="sm"
          onClick={() => {
            const store = useCanvasStore.getState();
            store.saveShotViewport(flow.getViewport());
            store.setActiveShot(null);
          }}
        >
          剧情路线
        </Button>
        <Select
          ariaLabel="当前视频画布"
          className="!w-52"
          value={shotId}
          onChange={switchShot}
          options={videos.map((node) => ({
            value: videoWorkspaceId(node.id),
            label: String(node.data.title ?? "未命名视频"),
          }))}
        />
        <ShotContinuity key={shotId} shotId={shotId} />
      </div>
    );
  }
  return (
    <div
      aria-label="分镜切换"
      className="absolute left-3 top-20 z-20 flex max-w-[calc(100%-24px)] items-center gap-1.5 rounded-xl border border-white/10 bg-[#1b1b1e]/95 p-1.5 shadow-xl backdrop-blur sm:left-4"
    >
      <Button
        size="sm"
        onClick={() => {
          const store = useCanvasStore.getState();
          store.saveShotViewport(flow.getViewport());
          store.setActiveShot(null);
        }}
      >
        剧情路线
      </Button>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-accent/10 text-brand-accent">
        <Film size={16} />
      </span>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-7"
        aria-label="上一分镜"
        disabled={index <= 0}
        onClick={() => switchShot(shots[index - 1].shotId)}
      >
        <ChevronLeft size={16} />
      </Button>
      <Select
        ariaLabel="当前分镜"
        className="!w-48 min-w-0 font-medium sm:!w-60"
        contentClassName="!max-h-[min(24rem,var(--radix-select-content-available-height))]"
        value={shotId}
        onChange={switchShot}
        options={[...new Set(shots.map((s) => s.sceneId))].map((sceneId) => {
          const scene = outline?.scenes.find((s) => s.id === sceneId);
          const title = `第 ${scene?.episode ?? 1} 集 · ${scene?.title ?? sceneId}`;
          return {
            label: title,
            options: shots
              .filter((s) => s.sceneId === sceneId)
              .map((s) => ({ value: s.shotId, label: `${title} · 镜头 ${s.shotIndex + 1}` })),
          };
        })}
      />
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-7"
        aria-label="下一分镜"
        disabled={index < 0 || index >= shots.length - 1}
        onClick={() => switchShot(shots[index + 1].shotId)}
      >
        <ChevronRight size={16} />
      </Button>
      <Select
        ariaLabel="切换播放片段"
        className="!w-36"
        value={current?.sceneId ?? ""}
        onChange={(sceneId) => {
          const next = allShots
            .filter((shot) => shot.sceneId === sceneId)
            .sort((a, b) => a.shotIndex - b.shotIndex)[0];
          if (next) switchShot(next.shotId);
        }}
        options={[...new Set(allShots.map((shot) => shot.sceneId))].map((sceneId) => {
          const scene = outline?.scenes.find((item) => item.id === sceneId);
          return {
            value: sceneId,
            label: `第 ${scene?.episode ?? 1} 集 · ${scene?.title ?? sceneId}`,
          };
        })}
      />
      <ShotContinuity key={shotId} shotId={shotId} />
      <span className="hidden border-l border-white/10 pl-3 pr-2 text-[11px] text-white/40 sm:inline">
        {graph.nodes.length} 节点 · {graph.edges.length} 连接
      </span>
      <span
        className={`hidden rounded-md px-2 py-1 text-[11px] md:inline ${main?.data.videoUrl ? "bg-emerald-400/10 text-emerald-300" : "bg-white/5 text-white/50"}`}
      >
        {main?.data.videoUrl ? "主视频已就绪" : main ? "主视频待生成" : "未指定主视频"}
      </span>
    </div>
  );
}
