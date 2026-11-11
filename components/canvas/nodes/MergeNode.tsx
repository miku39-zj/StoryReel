"use client";
import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import { GitMerge } from "lucide-react";
import type { MergeNodeData } from "@/lib/story/types";
import { NodeCard } from "./NodeCard";

export const MergeNode = memo(function MergeNode({ id, data, selected }: NodeProps) {
  const d = data as MergeNodeData;
  return (
    <NodeCard
      nodeId={id}
      type="merge"
      selected={selected}
      icon={<GitMerge size={14} />}
      label="汇合"
      title={d.label || "剧情汇合"}
      description={"多条路线在此继续"}
    />
  );
});
