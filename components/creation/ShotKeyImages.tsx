"use client";

import Image from "next/image";
import { useState } from "react";
import { nanoid } from "nanoid";
import { Button } from "@/components/ui";
import { splitShotAtImage } from "@/lib/production/split-shot";
import { mainVideoNode } from "@/lib/canvas/shot-workspace";
import { connectedInputs } from "@/lib/story/connections";
import type { StoryFlowEdge, StoryFlowNode } from "@/lib/story/types";
import { useCanvasStore } from "@/stores/canvas-store";

export function ShotKeyImages({ shotId }: { shotId: string }) {
  const nodes = useCanvasStore((state) => state.nodes);
  const edges = useCanvasStore((state) => state.edges);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const project = useCanvasStore.getState().toProject();
  const video = project && mainVideoNode(project, shotId);
  if (!project || !video) return null;
  const inputs = connectedInputs(video.id, nodes, edges);
  const frames = inputs.filter(
    (input) => input.role === "reference-image" && input.source.data.middleKeyImage,
  );
  const enable = () => {
    const store = useCanvasStore.getState();
    store.applyGraph(
      store.nodes.map((node) =>
        node.id === video.id
          ? {
              ...node,
              data: {
                ...node.data,
                seedanceMode: "reference-to-video",
                firstFrameUrl: undefined,
                lastFrameUrl: undefined,
              },
            }
          : node,
      ),
      store.edges.map((edge): StoryFlowEdge => {
        const input = inputs.find((item) => item.edge.id === edge.id);
        return input && ["first-frame", "last-frame"].includes(input.role)
          ? { ...edge, data: { ...edge.data, kind: "context", inputRole: "reference-image" } }
          : edge;
      }),
    );
  };
  const add = async (file: File) => {
    setBusy(true);
    setError("");
    try {
      const data = new FormData();
      data.append("file", file);
      const response = await fetch("/api/assets", { method: "POST", body: data });
      const asset = await response.json();
      if (!response.ok || asset.type !== "image") throw new Error(asset.error || "请选择图片");
      const store = useCanvasStore.getState();
      const latest = store.toProject();
      const target = latest && mainVideoNode(latest, shotId);
      if (
        latest?.id !== project.id ||
        target?.id !== video.id ||
        target.data.seedanceMode !== "reference-to-video"
      )
        throw new Error("镜头或生成模式已变更");
      if (
        connectedInputs(video.id, store.nodes, store.edges).filter(
          (input) => input.role === "reference-image",
        ).length >= 9
      )
        throw new Error("最多使用 9 张参考图");
      const id = `middle_frame:${nanoid(10)}`;
      const node: StoryFlowNode = {
        id,
        type: "image",
        position: { x: 340, y: 520 + frames.length * 240 },
        data: {
          nodeType: "image",
          title: file.name.slice(0, 150),
          imageUrl: asset.url,
          canvasShotId: shotId,
          middleKeyImage: true,
        },
      };
      store.applyGraph(
        [...store.nodes, node],
        [
          ...store.edges,
          {
            id: `input:${id}`,
            source: id,
            target: video.id,
            data: { kind: "context", inputRole: "reference-image" },
          },
        ],
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法添加关键画面");
    } finally {
      setBusy(false);
    }
  };
  return (
    <details className="rounded-lg border border-white/10 px-3 py-2 text-sm">
      <summary className="cursor-pointer">
        中间关键画面{frames.length > 0 && ` · ${frames.length} 张`}
      </summary>
      <div className="mt-2 space-y-2">
        {video.data.seedanceMode !== "reference-to-video" ? (
          <Button size="sm" onClick={enable}>
            切换多参考，将已连首尾帧转为参考图
          </Button>
        ) : (
          <label className="block text-xs">
            添加参考画面
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              disabled={busy}
              className="ml-2 max-w-full"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void add(file);
                event.target.value = "";
              }}
            />
          </label>
        )}
        {frames.map(({ source, edge }, index) => (
          <div key={source.id} className="flex flex-wrap items-center gap-2">
            {typeof source.data.imageUrl === "string" && (
              <Image
                unoptimized
                src={source.data.imageUrl}
                alt={`中间画面 ${index + 1}`}
                width={96}
                height={54}
                className="h-12 w-20 rounded object-contain"
              />
            )}
            <input
              aria-label={`中间画面 ${index + 1} 名称`}
              maxLength={150}
              className="min-w-0 rounded bg-white/5 px-2 py-1"
              value={String(source.data.title ?? "")}
              onChange={(event) =>
                useCanvasStore.getState().updateNodeData(source.id, { title: event.target.value })
              }
            />
            <Button
              size="sm"
              disabled={index === 0}
              onClick={() => {
                const store = useCanvasStore.getState();
                const previous = frames[index - 1].edge;
                store.onEdgesChange(
                  store.edges.map((item) =>
                    item.id === edge.id ? previous : item.id === previous.id ? edge : item,
                  ),
                );
              }}
            >
              上移
            </Button>
            <Button
              size="sm"
              onClick={() => {
                try {
                  const store = useCanvasStore.getState();
                  const draft = store.toProject();
                  if (!draft) return;
                  store.replaceProject(
                    splitShotAtImage(draft, shotId, source.id, `shot_${nanoid(10)}`),
                  );
                  useCanvasStore.getState().persist();
                } catch (cause) {
                  setError(cause instanceof Error ? cause.message : "无法拆分镜头");
                }
              }}
            >
              在此画面拆成两镜
            </Button>
            <Button
              size="sm"
              onClick={() =>
                useCanvasStore
                  .getState()
                  .onEdgesChange(
                    useCanvasStore.getState().edges.filter((item) => item.id !== edge.id),
                  )
              }
            >
              移除参考
            </Button>
          </div>
        ))}
        {error && (
          <p role="alert" className="text-red-300">
            {error}
          </p>
        )}
      </div>
    </details>
  );
}
