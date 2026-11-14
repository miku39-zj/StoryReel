"use client";

import * as Dialog from "@radix-ui/react-alert-dialog";
import NextImage from "next/image";
import { useState } from "react";
import { ImagePlus, X } from "lucide-react";
import { Button } from "@/components/ui";
import { useCanvasStore } from "@/stores/canvas-store";
import { useCreationStore } from "@/stores/creation-store";
import type { StoryboardShot } from "@/lib/production/shots";

/** Stores node identities only; productionShots resolves current image versions at submission. */
export function ShotReferencePicker({ shot }: { shot: StoryboardShot }) {
  const nodes = useCanvasStore((s) => s.nodes);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>([]);
  const references = nodes.filter(
    (node) => node.type === "image" && ["character", "scene"].includes(String(node.data.assetKind)),
  );
  const selectedIds = shot.referenceNodeIds ?? shot.referenceImages?.map((ref) => ref.nodeId) ?? [];
  const inherited = shot.referenceNodeIds === undefined;
  const selected = selectedIds.map((id) => references.find((node) => node.id === id));
  const cast = selected.filter((node) => node?.data.assetKind === "character");
  const scenes = selected.filter((node) => node?.data.assetKind === "scene");
  return (
    <div className="flex items-start justify-between gap-2 rounded-lg bg-white/[0.025] px-2.5 py-2">
      <div className="min-w-0 space-y-1 text-xs leading-5 text-white/65">
        <p>
          人物：
          {cast.length
            ? cast.map((node) => String(node!.data.title)).join("、")
            : shot.characterNames?.length === 0
              ? "空镜"
              : "待确认"}
        </p>
        <p>
          场景：
          {scenes.length
            ? scenes.map((node) => String(node!.data.title)).join("、")
            : "待补齐参考图"}
        </p>
      </div>
      <Dialog.Root
        open={open}
        onOpenChange={(next) => {
          if (next) setDraft([...selectedIds]);
          setOpen(next);
        }}
      >
        <Dialog.Trigger asChild>
          <Button
            size="sm"
            variant="ghost"
            className="h-auto min-h-7 justify-start whitespace-normal text-left"
          >
            <ImagePlus size={14} className="shrink-0" />
            调整
          </Button>
        </Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[400] bg-black/70 backdrop-blur-sm" />
          <Dialog.Content
            role="dialog"
            aria-describedby={undefined}
            className="fixed left-1/2 top-1/2 z-[401] flex max-h-[85vh] w-[640px] max-w-[calc(100vw-24px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-white/10 bg-oii-surface shadow-2xl outline-none"
          >
            <header className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <Dialog.Title className="text-sm font-semibold">
                画面参考 · 镜头 {shot.shotIndex + 1}
              </Dialog.Title>
              <Dialog.Cancel asChild>
                <Button size="sm" variant="ghost" aria-label="关闭画面参考">
                  <X size={16} />
                </Button>
              </Dialog.Cancel>
            </header>
            <div className="space-y-4 overflow-y-auto p-4">
              <p className="text-xs text-white/50">{shot.action}</p>
              <p className="text-xs text-white/40">
                {inherited ? "已继承分镜确定的人物与场景" : "已手动调整本镜参考"}
              </p>
              {(["character", "scene"] as const).map((kind) => (
                <section key={kind} className="space-y-2">
                  <h3 className="text-sm font-medium">{kind === "character" ? "人物" : "场景"}</h3>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {references
                      .filter((node) => node.data.assetKind === kind)
                      .map((node) => (
                        <button
                          key={node.id}
                          type="button"
                          aria-pressed={draft.includes(node.id)}
                          disabled={!draft.includes(node.id) && draft.length >= 4}
                          onClick={() =>
                            setDraft(
                              draft.includes(node.id)
                                ? draft.filter((id) => id !== node.id)
                                : [...draft, node.id],
                            )
                          }
                          className={`overflow-hidden rounded-lg border text-left transition-colors focus-visible:outline focus-visible:outline-brand-accent disabled:opacity-40 ${draft.includes(node.id) ? "border-brand-accent bg-brand-accent/10" : "border-white/10 hover:border-white/30"}`}
                        >
                          <div className="relative aspect-video bg-black/25">
                            {Boolean(node.data.imageUrl) && (
                              <NextImage
                                fill
                                unoptimized
                                src={String(node.data.imageUrl)}
                                alt={String(node.data.title)}
                                className="object-contain"
                              />
                            )}
                          </div>
                          <div className="p-2 text-xs">
                            <p className="truncate">{String(node.data.title)}</p>
                            <span
                              className={node.data.imageUrl ? "text-white/45" : "text-amber-300/80"}
                            >
                              {draft.includes(node.id) ? "已选 · " : ""}
                              {node.data.imageUrl ? "参考图已就绪" : "需先生成参考图"}
                            </span>
                          </div>
                        </button>
                      ))}
                  </div>
                  {!references.some((node) => node.data.assetKind === kind) && (
                    <p className="text-xs text-white/40">
                      暂无{kind === "character" ? "人物" : "场景"}参考，请先在对应 Tab 中创建。
                    </p>
                  )}
                </section>
              ))}
            </div>
            <footer className="flex items-center justify-between gap-2 border-t border-white/10 p-3">
              <span className="text-xs text-white/45">已选 {draft.length} / 4</span>
              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  const store = useCreationStore.getState();
                  store.setStoryboardShots(
                    store.storyboardShots.map((item) =>
                      item.shotId === shot.shotId ? { ...item, referenceNodeIds: draft } : item,
                    ),
                  );
                  const canvas = useCanvasStore.getState();
                  const target = `shot_frame:${shot.shotId}`;
                  if (canvas.nodes.some((node) => node.id === target)) {
                    const edges = canvas.edges.filter(
                      (edge) =>
                        !(
                          edge.target === target &&
                          edge.id.startsWith("shot_input:") &&
                          edge.data?.inputRole === "reference-image"
                        ),
                    );
                    for (const source of draft) {
                      if (edges.some((edge) => edge.source === source && edge.target === target))
                        continue;
                      edges.push({
                        id: `shot_input:${source}:${target}`,
                        source,
                        target,
                        data: { kind: "context", inputRole: "reference-image" },
                      });
                    }
                    canvas.onEdgesChange(edges);
                  } else canvas.persist();
                  setOpen(false);
                }}
              >
                应用到此画面
              </Button>
            </footer>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
