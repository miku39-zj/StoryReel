"use client";
import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import { ImageIcon } from "lucide-react";
import type { ImageNodeData } from "@/lib/story/types";
import { Badge } from "@/components/ui";
import { AssetStatusBadge } from "@/components/creation/CreationStepLayout";
import { NodeCard } from "./NodeCard";

export const ImageNode = memo(function ImageNode({ id, data, selected }: NodeProps) {
  const d = data as ImageNodeData;
  const role =
    d.seedanceRole &&
    { first_frame: "首帧", last_frame: "尾帧", reference: "参考图" }[d.seedanceRole];
  return (
    <NodeCard
      nodeId={id}
      type="image"
      selected={selected}
      icon={<ImageIcon size={14} />}
      label="图片"
      title={d.title || "场景图片"}
      description={d.style}
    >
      <div className="relative flex h-24 items-center justify-center bg-white/[0.02]">
        {d.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={d.imageUrl} alt={d.title} className="h-full w-full object-cover" />
        ) : (
          <ImageIcon size={24} className="text-white/15" />
        )}
        {d.generationStatus && d.generationStatus !== "idle" && (
          <div className="absolute right-2 top-2">
            <AssetStatusBadge status={d.generationStatus} />
          </div>
        )}
        {role && <Badge className="absolute bottom-2 left-2 bg-oii-surface">{role}</Badge>}
      </div>
    </NodeCard>
  );
});
