"use client";

import { Film, ImageIcon, FileText, GitBranch, Trophy } from "lucide-react";
import { useReactFlow } from "@xyflow/react";
import { Button, DropdownMenu } from "@/components/ui";
import { useCanvasStore } from "@/stores/canvas-store";
import { isContextEdge, inputRole } from "@/lib/story/connections";
import { connectionNodeOptions } from "@/lib/story/connection-options";
import type { StoryNodeType } from "@/lib/story/types";

export function NodeConnectionMenu({
  nodeId,
  type,
  direction,
  floatingPoint,
  onClose,
}: {
  nodeId: string;
  type: StoryNodeType;
  direction: "input" | "output";
  handleId?: string | null;
  floatingPoint: { x: number; y: number };
  onClose: () => void;
}) {
  const addConnectedNode = useCanvasStore((s) => s.addConnectedNode);
  const nodes = useCanvasStore((s) => s.nodes);
  const edges = useCanvasStore((s) => s.edges);
  const title = String(nodes.find((n) => n.id === nodeId)?.data.title || "剧情节点");
  const { screenToFlowPosition } = useReactFlow();
  const videoCanvas = useCanvasStore((state) => state.activeShotId?.startsWith("video-canvas:"));
  const options = connectionNodeOptions(type, direction).filter(
    (option) =>
      !videoCanvas ||
      (option.data.kind === "context" && (option.type !== "video" || direction === "input")),
  );
  if (!options.length) return null;
  const icons = {
    text: FileText,
    image: ImageIcon,
    video: Film,
    choice: GitBranch,
    ending: Trophy,
    condition: GitBranch,
    merge: GitBranch,
  };
  return (
    <DropdownMenu
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      label={direction === "input" ? "选择输入节点" : "选择输出节点"}
      side={direction === "input" ? "left" : "right"}
      trigger={
        <Button
          onClick={(event) => event.stopPropagation()}
          style={{
            position: "fixed",
            left: floatingPoint.x,
            top: floatingPoint.y,
            width: 1,
            height: 1,
            opacity: 0,
            transform: "none",
          }}
          variant="secondary"
          size="icon-sm"
          aria-label={`${direction === "input" ? "添加输入" : "添加输出"}：${title}`}
          className="nodrag nopan"
        />
      }
      items={options.map((option) => {
        const Icon = icons[option.type];
        return {
          key: option.label,
          label: option.label,
          icon: <Icon size={15} />,
          disabled:
            direction === "input" &&
            ["first-frame", "last-frame"].includes(option.data.inputRole || "") &&
            edges.some(
              (e) =>
                e.target === nodeId &&
                isContextEdge(e, nodes) &&
                inputRole(e, nodes) === option.data.inputRole,
            ),
          onSelect: () => {
            addConnectedNode(
              nodeId,
              direction,
              option.type,
              option.data,
              screenToFlowPosition(floatingPoint),
            );
            onClose();
          },
        };
      })}
    />
  );
}
