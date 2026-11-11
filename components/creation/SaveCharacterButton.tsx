"use client";
import { useState } from "react";
import { useCanvasStore } from "@/stores/canvas-store";
import { Button, Alert } from "@/components/ui";
export function SaveCharacterButton({
  nodeId,
  size = "sm",
}: {
  nodeId: string;
  size?: "sm" | "md";
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false);
  return (
    <div className="space-y-2">
      <Button
        size={size}
        disabled={busy}
        onClick={async () => {
          const node = useCanvasStore.getState().nodes.find((n) => n.id === nodeId);
          if (!node) return;
          setBusy(true);
          setError("");
          setSaved(false);
          const projectId = useCanvasStore.getState().projectId;
          const source = JSON.stringify(node.data);
          try {
            const response = await fetch("/api/characters", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                id: node.data.characterAssetId,
                revision: node.data.characterAssetRevision,
                name: node.data.title,
                description: node.data.assetDescription || node.data.prompt,
                imageUrl: node.data.imageUrl,
                style: node.data.style,
              }),
            });
            const data = await response.json();
            if (!response.ok) throw Error(data.error || "保存失败");
            const current = useCanvasStore.getState().nodes.find((n) => n.id === nodeId);
            if (
              useCanvasStore.getState().projectId === projectId &&
              current &&
              JSON.stringify(current.data) === source
            )
              useCanvasStore.getState().updateNodeData(nodeId, {
                characterAssetId: data.id,
                characterAssetRevision: data.revision,
              });
            setSaved(true);
          } catch (error) {
            setError((error as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "保存中…" : "保存到角色库"}
      </Button>
      {saved && (
        <span role="status" className="ml-2 text-xs text-green-300">
          已保存
        </span>
      )}
      {error && <Alert tone="error">{error}</Alert>}
    </div>
  );
}
