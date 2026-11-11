"use client";
import { SaveCharacterButton } from "@/components/creation/SaveCharacterButton";
import { useCanvasStore } from "@/stores/canvas-store";
import { Button, Textarea, Select, Label, Alert } from "@/components/ui";
import { useState } from "react";
import { isContextEdge } from "@/lib/story/connections";
export function AssetBindings({ nodeId }: { nodeId: string }) {
  const nodes = useCanvasStore((s) => s.nodes),
    edges = useCanvasStore((s) => s.edges),
    [error, setError] = useState("");
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return null;
  const store = useCanvasStore.getState();
  if (node.type === "image")
    return (
      <section className="space-y-2 rounded-lg border border-white/10 p-3">
        <Label>素材用途</Label>
        <Select
          ariaLabel="素材用途"
          size="sm"
          value={String(node.data.assetKind ?? "image")}
          options={[
            { value: "image", label: "普通图片" },
            { value: "character", label: "角色参考" },
            { value: "scene", label: "场景参考" },
          ]}
          onChange={(value) => store.updateNodeData(nodeId, { assetKind: value })}
        />
        {["character", "scene"].includes(String(node.data.assetKind)) && (
          <>
            <Label>固定设定</Label>
            <Textarea
              aria-label="角色或场景固定设定"
              value={String(node.data.assetDescription ?? "")}
              onChange={(e) => store.updateNodeData(nodeId, { assetDescription: e.target.value })}
              placeholder="角色外貌、服装；或场景的建筑、环境与时间"
              rows={3}
            />
            <p className="text-xs text-white/40">
              此图片节点可被多个镜头图片和视频复用；修改设定后会提示下游素材过期。
            </p>
          </>
        )}
        {node.data.assetKind === "character" && <SaveCharacterButton nodeId={nodeId} />}
      </section>
    );
  if (!["video", "image"].includes(node.type!)) return null;
  const assets = nodes.filter(
    (n) => n.type === "image" && ["character", "scene"].includes(String(n.data.assetKind)),
  );
  return (
    <details className="space-y-2 text-xs text-white/60">
      <summary className="cursor-pointer">绑定角色与场景 · {assets.length} 个可用参考</summary>
      {!assets.length && <p>先添加图片节点，在“素材用途”中设为角色或场景参考。</p>}
      <div className="flex flex-wrap gap-2">
        {assets.map((asset) => {
          const links = edges.filter(
            (e) => e.source === asset.id && e.target === nodeId && isContextEdge(e, nodes),
          );
          return (
            <Button
              key={asset.id}
              variant={links.length ? "outline" : "secondary"}
              size="sm"
              aria-pressed={!!links.length}
              onClick={() => {
                if (links.length) links.forEach((e) => store.deleteEdge(e.id));
                else if (
                  !store.addEdge(asset.id, nodeId, {
                    kind: "context",
                    inputRole: "reference-image",
                  })
                )
                  setError("无法绑定，请检查素材连线");
              }}
            >
              {asset.data.assetKind === "character" ? "角色" : "场景"} ·{" "}
              {String(asset.data.title || "未命名")}
            </Button>
          );
        })}
      </div>
      <p>绑定会建立真实参考连线。首尾帧与多素材参考不能混用，可在输入面板调整用途。</p>
      {error && <Alert tone="error">{error}</Alert>}
    </details>
  );
}
