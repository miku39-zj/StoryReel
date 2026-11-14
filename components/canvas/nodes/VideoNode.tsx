"use client";
import { useCanvasStore } from "@/stores/canvas-store";
import { useCreationStore } from "@/stores/creation-store";
import { memo } from "react";
import { type NodeProps } from "@xyflow/react";
import { Film, Clock } from "lucide-react";
import type { VideoNodeData } from "@/lib/story/types";
import { Badge } from "@/components/ui";
import { AssetStatusBadge } from "@/components/creation/CreationStepLayout";
import { NodeCard } from "./NodeCard";

export const VideoNode = memo(function VideoNode({ id, data, selected }: NodeProps) {
  const d = data as VideoNodeData;
  const shotId = useCanvasStore((state) => state.activeShotId);
  const isStoryRoute = useCreationStore((state) => !!state.storyOutline) && !shotId;
  const scene = useCreationStore((state) =>
    state.storyOutline?.scenes.find(
      (item) => item.id === (d.shotSceneId ?? id.replace(/^video_/, "")),
    ),
  );
  return (
    <NodeCard
      nodeId={id}
      type="video"
      selected={selected}
      icon={<Film size={14} />}
      label="视频"
      title={
        !shotId && scene ? `第 ${scene.episode ?? 1} 集 · ${scene.title}` : d.title || "未命名片段"
      }
      description={d.description}
    >
      <div className="relative flex h-24 items-center justify-center bg-white/[0.02]">
        {d.videoUrl && !isStoryRoute ? (
          <video
            controls
            preload={shotId ? "metadata" : "none"}
            src={d.videoUrl}
            poster={d.thumbnailUrl}
            aria-label={`${d.title}视频`}
            className="nodrag nopan h-full w-full object-cover"
          />
        ) : d.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={d.thumbnailUrl} alt={d.title} className="h-full w-full object-cover" />
        ) : (
          <Film size={24} className="text-white/15" />
        )}
        {!isStoryRoute && d.generationStatus && d.generationStatus !== "idle" && (
          <div className="absolute right-2 top-2">
            <AssetStatusBadge status={d.generationStatus} />
          </div>
        )}
        {d.interactionAt !== undefined && (
          <Badge className="absolute bottom-2 left-2 gap-1 bg-oii-surface text-white/70">
            <Clock size={10} />
            {d.interactionAt} 秒后选择
          </Badge>
        )}
      </div>
    </NodeCard>
  );
});
