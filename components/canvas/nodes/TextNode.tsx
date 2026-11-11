"use client";
import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import { FileText } from "lucide-react";
import type { TextNodeData } from "@/lib/story/types";
import { Badge } from "@/components/ui";
import { AssetStatusBadge } from "@/components/creation/CreationStepLayout";
import { NodeCard } from "./NodeCard";

export const TextNode = memo(function TextNode({ id, data, selected }: NodeProps) {
  const d = data as TextNodeData;
  return (
    <NodeCard
      nodeId={id}
      type="text"
      selected={selected}
      icon={<FileText size={14} />}
      label="文字"
      title={d.title || "故事文字"}
      description={d.content || "添加场景描述、对白或提示词"}
    >
      <div className="flex flex-wrap gap-2 px-3.5 pt-3">
        <Badge>
          {
            { scene: "场景", dialogue: "对白", direction: "指导", prompt: "提示词" }[
              d.role ?? "scene"
            ]
          }
        </Badge>
        {d.generationStatus && d.generationStatus !== "idle" && (
          <AssetStatusBadge status={d.generationStatus} />
        )}
      </div>
    </NodeCard>
  );
});
