"use client";
import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import { GitBranch } from "lucide-react";
import type { ConditionNodeData } from "@/lib/story/types";
import { NodeCard } from "./NodeCard";

export const ConditionNode = memo(function ConditionNode({ id, data, selected }: NodeProps) {
  const d = data as ConditionNodeData;
  return (
    <NodeCard
      nodeId={id}
      type="condition"
      selected={selected}
      icon={<GitBranch size={14} />}
      label="条件"
      title={"条件判断"}
      description={
        d.conditions?.length
          ? `${d.conditionMode === "any" ? "任一" : "全部"}满足：${d.conditions.map((r) => `${r.variable} ${r.operator} ${r.value}`).join("；")}`
          : d.variable && d.operator && d.value !== undefined
            ? `${d.variable} ${d.operator} ${d.value}`
            : "设置条件，自动分配剧情路线"
      }
    />
  );
});
