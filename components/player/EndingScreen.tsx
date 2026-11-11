"use client";
import type { EndingNodeData } from "@/lib/story/types";
import { RotateCcw, Trophy } from "lucide-react";
import { Button, EmptyState } from "@/components/ui";

export function EndingScreen({
  ending,
  onRestart,
}: {
  ending: EndingNodeData | null;
  onRestart: () => void;
}) {
  return (
    <div className="absolute inset-0 flex items-center justify-center overflow-y-auto bg-[#101012]/95">
      <EmptyState
        className="w-full max-w-lg min-h-0 py-6 sm:py-8"
        icon={<Trophy size={26} />}
        title={ending?.title || "故事落幕"}
        description={ending?.description || "每一次选择，都会带来不一样的故事。"}
      >
        <Button variant="primary" onClick={onRestart}>
          <RotateCcw size={15} />
          重新体验
        </Button>
      </EmptyState>
    </div>
  );
}
