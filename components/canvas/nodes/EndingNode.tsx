"use client";
import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import { Trophy } from "lucide-react";
import type { EndingNodeData } from "@/lib/story/types";
import { NodeCard } from "./NodeCard";

export const EndingNode = memo(function EndingNode({ id, data, selected }: NodeProps) {
  const d = data as EndingNodeData;
  return (
    <NodeCard
      nodeId={id}
      type="ending"
      selected={selected}
      icon={<Trophy size={14} />}
      label="结局"
      title={d.title || "故事结局"}
      description={d.description}
      terminal
    />
  );
});
