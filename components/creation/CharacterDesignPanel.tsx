"use client";
import NextImage from "next/image";
import { useCreationStore } from "@/stores/creation-store";
import { SaveCharacterButton } from "./SaveCharacterButton";
import { CharacterPicker } from "./CharacterLibrary";
import { addCharacterToProject } from "@/lib/characters";
import { useState } from "react";
import { useCanvasStore } from "@/stores/canvas-store";
import { useCanvasJobs } from "@/stores/canvas-jobs-store";
import { initializeCharacterAssets } from "@/lib/story/character-design";
import { GenerationTasks, NodeGenerationStatus } from "@/components/canvas/GenerationTasks";
import { AssetPicker } from "@/components/AssetPicker";
import { ImageIcon, CheckCircle2 } from "lucide-react";
import { Button, Card, Input, Textarea, Alert } from "@/components/ui";

export function CharacterDesignPanel() {
  const nodes = useCanvasStore((s) => s.nodes),
    jobs = useCanvasJobs((s) => s.jobs),
    loading = useCanvasJobs((s) => s.loading);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState("");
  const characters = nodes.filter((n) => n.type === "image" && n.data.assetKind === "character");
  const store = useCanvasStore.getState();
  const updateGraph = (project: ReturnType<typeof store.toProject>) => {
    if (!project) return;
    store.checkpoint();
    useCanvasStore.setState({ nodes: project.nodes, edges: project.edges });
    store.persist();
  };
  return (
    <section className="space-y-3 px-3 py-3 lg:px-4" aria-label="角色外观设计">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">角色设计</h2>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <GenerationTasks inline />
          <Button size="sm" onClick={() => setPicking(true)}>
            从角色库添加
          </Button>
          <Button
            size="sm"
            onClick={() => {
              const p = store.toProject();
              if (!p) return;
              updateGraph({
                ...p,
                nodes: [
                  ...p.nodes,
                  {
                    id: crypto.randomUUID(),
                    type: "image",
                    position: { x: -800, y: characters.length * 340 },
                    data: {
                      nodeType: "image",
                      assetKind: "character",
                      title: "新角色",
                      assetDescription: "",
                      prompt: "Character design reference, neutral background.",
                      generationStatus: "idle",
                    },
                  },
                ],
              });
            }}
          >
            新建角色
          </Button>
          <Button
            size="sm"
            onClick={() => {
              const p = store.toProject();
              if (p) updateGraph(initializeCharacterAssets(p));
            }}
          >
            从剧本建立角色卡
          </Button>
        </div>
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      <CharacterPicker
        open={picking}
        onClose={() => setPicking(false)}
        onSelect={(asset) => {
          const p = store.toProject();
          if (p) {
            const creation = useCreationStore.getState();
            if (!(creation.brief.characters ?? []).some((c) => c.id === asset.id)) {
              if ((creation.brief.characters ?? []).length >= 20) {
                setError("每个剧本最多添加 20 个角色");
                return;
              }
              creation.setBrief({
                ...creation.brief,
                characters: [...(creation.brief.characters ?? []), asset],
              });
            }
            updateGraph(addCharacterToProject(p, asset));
          }
        }}
      />
      <div className="grid items-stretch gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {characters.map((character) => {
          const busy = jobs.some(
            (j) => j.nodeId === character.id && ["queued", "running"].includes(j.status),
          );
          return (
            <Card
              key={character.id}
              className="flex h-full flex-col overflow-hidden rounded-xl border-white/[0.08] bg-white/[0.025] p-0"
            >
              <div className="relative h-32 w-full overflow-hidden sm:h-36 border-b border-white/[0.06] bg-black/25">
                {typeof character.data.imageUrl === "string" ? (
                  <NextImage
                    unoptimized
                    fill
                    src={character.data.imageUrl}
                    alt={String(character.data.title)}
                    className="object-contain"
                  />
                ) : (
                  <div className="flex h-full flex-col items-center justify-center gap-3 text-white/25">
                    <ImageIcon size={24} strokeWidth={1} />
                    <span className="text-xs">待生成参考图</span>
                  </div>
                )}
                <span
                  className={`absolute right-2 top-2 inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] backdrop-blur ${character.data.imageUrl ? "border-emerald-400/20 bg-black/70 text-emerald-300" : "border-white/10 bg-black/40 text-white/50"}`}
                >
                  {character.data.imageUrl ? (
                    <>
                      <CheckCircle2 size={12} />
                      已就绪
                    </>
                  ) : (
                    "未生成"
                  )}
                </span>
              </div>
              <div className="flex flex-1 flex-col gap-2 p-3">
                <Input
                  aria-label={`${character.id} 角色名称`}
                  value={String(character.data.title)}
                  onChange={(e) => store.updateNodeData(character.id, { title: e.target.value })}
                  className="h-8 text-sm font-semibold"
                />
                <details className="rounded-lg border border-white/[0.06] text-xs text-white/50">
                  <summary className="cursor-pointer min-h-7 px-2.5 py-1 leading-5 hover:text-white/80">
                    编辑设定与素材
                  </summary>
                  <div className="space-y-3 border-t border-white/[0.06] p-3">
                    <label className="block text-xs text-white/45">
                      外观设定
                      <Textarea
                        aria-label={`${character.id} 固定设定`}
                        rows={4}
                        value={String(character.data.assetDescription ?? "")}
                        onChange={(e) =>
                          store.updateNodeData(character.id, { assetDescription: e.target.value })
                        }
                        className="mt-2 resize-y text-xs leading-5"
                      />
                    </label>
                    <NodeGenerationStatus nodeId={character.id} />
                  </div>
                </details>
                <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-white/[0.06] pt-2">
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={loading || busy}
                    onClick={() => void useCanvasJobs.getState().submit([character.id])}
                  >
                    {busy ? "角色图生成中…" : character.data.imageUrl ? "重新生成" : "生成参考图"}
                  </Button>
                  <SaveCharacterButton nodeId={character.id} size="sm" />
                  <AssetPicker
                    title={`选择角色图 · ${String(character.data.title)}`}
                    types={["image"]}
                    onSelect={(asset) =>
                      store.updateNodeData(character.id, {
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
                      选择角色图
                    </Button>
                  </AssetPicker>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </section>
  );
}
