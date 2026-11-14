"use client";

import { mainVideoNode } from "@/lib/canvas/shot-workspace";
import { NodeContextMenu } from "../NodeContextMenu";
import { useEffect, type ReactNode } from "react";
import { Handle, Position, useUpdateNodeInternals } from "@xyflow/react";
import { Card, Badge } from "@/components/ui";
import { useCreationStore } from "@/stores/creation-store";
import { useCanvasStore } from "@/stores/canvas-store";
import type { StoryNodeType } from "@/lib/story/types";
import { isStale } from "@/lib/canvas/workflow";
import { useCanvasJobs } from "@/stores/canvas-jobs-store";
import { cn } from "@/lib/utils";

export function NodeCard({
  nodeId,
  type,
  selected,
  icon,
  label,
  title,
  description,
  children,
  terminal = false,
}: {
  nodeId: string;
  type: StoryNodeType;
  selected?: boolean;
  icon: ReactNode;
  label: string;
  title: string;
  description?: string;
  children?: ReactNode;
  terminal?: boolean;
}) {
  const shotId = useCanvasStore((s) => s.activeShotId);
  useCanvasStore((s) => s.shotWorkspaces);
  const hasStory = useCreationStore((s) => !!s.storyOutline);
  const active = useCanvasStore((s) => s.selectedNodeId === nodeId);
  // Recompute staleness when connections change; toProject() reads the current edges.
  useCanvasStore((s) => s.edges);
  const nodes = useCanvasStore((s) => s.nodes),
    jobs = useCanvasJobs((s) => s.jobs);
  const project = useCanvasStore.getState().toProject(),
    node = nodes.find((n) => n.id === nodeId);
  const updateNodeInternals = useUpdateNodeInternals();
  useEffect(() => {
    updateNodeInternals(nodeId);
  }, [updateNodeInternals, nodeId, shotId, hasStory]);
  const isMain = !!(project && shotId && mainVideoNode(project, shotId)?.id === nodeId);
  const stale =
    (!hasStory || shotId) &&
    project &&
    node &&
    ["image", "video"].includes(type) &&
    isStale(project, node);
  const running = jobs.some((j) => j.nodeId === nodeId && ["queued", "running"].includes(j.status));
  selected = active || selected;
  return (
    <NodeContextMenu nodeId={nodeId}>
      <div className="relative w-[220px]">
        <Card
          className={cn(
            "overflow-hidden shadow-sm transition-[border-color,box-shadow]",
            selected && "border-brand-accent/60 ring-2 ring-brand-accent/15",
          )}
        >
          <div className="flex items-center gap-2 border-b border-white/[0.06] px-3 py-2">
            <span className="text-brand-accent">{icon}</span>
            <span className="text-[11px] font-medium text-white/50">{label}</span>
            {selected && (
              <Badge className="ml-auto border-brand-accent/20 bg-brand-accent/10 py-0 text-[9px] text-brand-accent">
                编辑中
              </Badge>
            )}
          </div>
          {shotId && type === "video" && (
            <div className="flex items-center justify-end border-b border-white/[0.06] px-3 py-1.5">
              {isMain ? (
                <span className="text-[10px] font-medium text-emerald-300">✓ 分镜主视频</span>
              ) : (
                <button
                  className="nodrag text-[10px] text-white/55 hover:text-brand-accent"
                  onClick={(event) => {
                    event.stopPropagation();
                    useCanvasStore.getState().setMainVideo(nodeId);
                  }}
                >
                  设为主视频
                </button>
              )}
            </div>
          )}
          {stale && <p className="px-3 pt-2 text-[10px] text-amber-300">输入已修改 · 素材过期</p>}
          {running && <p className="px-3 pt-2 text-[10px] text-brand-accent">生成任务进行中…</p>}
          {node?.data.groupLabel ? (
            <p className="px-3 pt-2 text-[10px] text-white/40">
              分组 · {String(node.data.groupLabel)}
            </p>
          ) : null}
          {children}
          <div className="p-3">
            <p className="break-words text-[13px] font-semibold leading-relaxed text-white/90">
              {title}
            </p>
            {description && (
              <p
                className="mt-1.5 line-clamp-2 text-[11px] leading-relaxed text-white/45"
                title={description}
              >
                {description}
              </p>
            )}
          </div>
        </Card>
        {(shotId || !hasStory) && (type === "video" || type === "image") && (
          <Handle
            id="context"
            type="target"
            position={Position.Left}
            title="素材输入：连接文本、图片或参考视频"
            className="!h-3 !w-3 !border-2 !border-oii-surface !bg-brand-accent"
          />
        )}
        {!shotId && type !== "text" && type !== "image" && (
          <Handle
            id="flow-in"
            type="target"
            position={Position.Left}
            title="剧情入口"
            style={!hasStory && type === "video" ? { top: "80%" } : undefined}
            className="!h-2.5 !w-2.5 !border-2 !border-oii-surface !bg-white/40"
          />
        )}
        {!terminal && (
          <Handle
            id="output"
            type="source"
            position={Position.Right}
            title="输出"
            className="!h-3 !w-3 !border-2 !border-oii-surface !bg-brand-accent"
          />
        )}
      </div>
    </NodeContextMenu>
  );
}
