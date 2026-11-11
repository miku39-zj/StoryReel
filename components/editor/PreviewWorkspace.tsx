"use client";

import { Film, ArrowLeft } from "lucide-react";
import { Button, Card, Badge, EmptyState } from "@/components/ui";
import { StoryPlayer } from "@/components/player/StoryPlayer";
import { PlaybackPanel } from "@/components/player/PlaybackPanel";
import { useCanvasStore } from "@/stores/canvas-store";

export function PreviewWorkspace({ onEdit }: { onEdit: () => void }) {
  const nodes = useCanvasStore((s) => s.nodes);
  const startNodeId = useCanvasStore((s) => s.startNodeId);
  const name = useCanvasStore((s) => s.projectName);
  const ready = !!startNodeId && nodes.some((n) => n.id === startNodeId);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1440px] space-y-4 px-4 py-5 lg:px-6">
        <div>
          <p className="mb-3 text-[13px] text-white/40">
            工作空间 / <span className="text-white/75">预览</span>
          </p>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold tracking-tight lg:text-[28px]">作品预览</h1>
              <p className="mt-2 text-sm text-white/50">
                以观众的视角体验故事，检查每一次选择和结局。
              </p>
            </div>
            <Button variant="secondary" onClick={onEdit}>
              <ArrowLeft size={15} />
              返回画布
            </Button>
          </div>
        </div>
        {ready ? (
          <div className="grid items-start gap-4 min-[1280px]:grid-cols-[minmax(0,1fr)_300px]">
            <Card className="min-w-0 overflow-hidden">
              <div className="flex items-center justify-between gap-3 border-b border-white/[0.08] px-5 py-4">
                <h2 className="truncate text-sm font-semibold text-white/85">
                  {name || "未命名故事"}
                </h2>
                <Badge className="shrink-0">互动预览</Badge>
              </div>
              <div className="aspect-video w-full min-h-[300px] sm:min-h-[360px]">
                <StoryPlayer />
              </div>
              <div className="border-t border-white/[0.08] px-5 py-4 text-xs leading-relaxed text-white/45">
                播放到决策点时，选择一条路线继续。可在观看路径中检查故事走向。
              </div>
            </Card>
            <PlaybackPanel />
          </div>
        ) : (
          <Card>
            <EmptyState
              icon={<Film size={26} />}
              title="故事准备好后，在这里试映"
              description="先在画布添加剧情节点，并将视频节点设为起点，再来体验你的互动故事。"
            >
              <Button variant="primary" onClick={onEdit}>
                前往画布
              </Button>
            </EmptyState>
          </Card>
        )}
      </div>
    </div>
  );
}
