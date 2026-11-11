"use client";
import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import { HelpCircle } from "lucide-react";
import type { ChoiceNodeData } from "@/lib/story/types";
import { NodeCard } from "./NodeCard";

export const ChoiceNode = memo(function ChoiceNode({ id, data, selected }: NodeProps) {
  const d = data as ChoiceNodeData;
  return (
    <NodeCard
      nodeId={id}
      type="choice"
      selected={selected}
      icon={<HelpCircle size={14} />}
      label="选择"
      title={d.question || "你会怎么做？"}
      description={
        d.timeoutSecs !== undefined ? `${d.timeoutSecs} 秒后自动继续` : "等待观众选择剧情走向"
      }
    />
  );
});
