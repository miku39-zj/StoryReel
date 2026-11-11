"use client";
import NextImage from "next/image";
import { ImageIcon } from "lucide-react";
import { Button, Card, Input, Textarea } from "@/components/ui";
import { AssetPicker } from "@/components/AssetPicker";
import { GenerationTasks, NodeGenerationStatus } from "@/components/canvas/GenerationTasks";
import { useCanvasStore } from "@/stores/canvas-store";
import { useCanvasJobs } from "@/stores/canvas-jobs-store";
import { initializeSceneAssets } from "@/lib/story/scene-design";

export function SceneDesignPanel() {
  const nodes = useCanvasStore((s) => s.nodes);
  const jobs = useCanvasJobs((s) => s.jobs);
  const loading = useCanvasJobs((s) => s.loading);
  const scenes = nodes.filter((n) => n.type === "image" && n.data.assetKind === "scene");
  const store = useCanvasStore.getState();
  return (
    <section aria-label="场景参考设计" className="space-y-3 px-3 py-3 lg:px-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold">场景参考</h2>
        <Button
          onClick={() => {
            const p = store.toProject();
            if (!p) return;
            store.checkpoint();
            useCanvasStore.setState({ nodes: initializeSceneAssets(p).nodes });
            store.persist();
          }}
        >
          从剧本建立场景卡
        </Button>
      </header>
      <GenerationTasks inline />
      {!scenes.length && (
        <div className="rounded-xl border border-dashed border-white/10 p-8 text-center text-sm text-white/45">
          暂无场景参考图
        </div>
      )}
      <div className="grid items-start gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {scenes.map((scene) => {
          const busy = jobs.some(
            (j) => j.nodeId === scene.id && ["queued", "running"].includes(j.status),
          );
          return (
            <Card key={scene.id} className="space-y-3 overflow-hidden bg-[#171719] p-3">
              <div className="relative aspect-video overflow-hidden rounded-lg bg-black/30">
                {scene.data.imageUrl ? (
                  <NextImage
                    fill
                    unoptimized
                    src={String(scene.data.imageUrl)}
                    alt={String(scene.data.title)}
                    className="object-contain"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-white/25">
                    <ImageIcon size={24} />
                  </div>
                )}
              </div>
              <Input
                aria-label={`${scene.id} 场景名称`}
                value={String(scene.data.title)}
                onChange={(e) => store.updateNodeData(scene.id, { title: e.target.value })}
              />
              <details className="rounded-lg border border-white/[0.08] text-xs text-white/60">
                <summary className="cursor-pointer px-3 py-2">编辑环境与参考图</summary>
                <div className="space-y-3 border-t border-white/[0.08] p-3">
                  <Textarea
                    aria-label={`${scene.id} 环境提示词`}
                    rows={5}
                    value={String(scene.data.prompt ?? "")}
                    onChange={(e) => store.updateNodeData(scene.id, { prompt: e.target.value })}
                  />
                  <NodeGenerationStatus nodeId={scene.id} />
                </div>
              </details>
              <Button
                variant="primary"
                className="w-full"
                disabled={loading || busy}
                onClick={() => void useCanvasJobs.getState().submit([scene.id])}
              >
                {busy ? "生成中…" : scene.data.imageUrl ? "重新生成场景" : "生成场景参考图"}
              </Button>
              <AssetPicker
                title={`选择场景图 · ${String(scene.data.title)}`}
                types={["image"]}
                onSelect={(asset) =>
                  store.updateNodeData(scene.id, {
                    imageUrl: asset.url,
                    generationJobId: undefined,
                    generationFingerprint: undefined,
                    generationStatus: "done",
                    generationError: undefined,
                  })
                }
              >
                <Button size="sm">
                  <ImageIcon size={14} />
                  选择场景图
                </Button>
              </AssetPicker>
            </Card>
          );
        })}
      </div>
    </section>
  );
}
