"use client";
import { useState } from "react";
import { Button, Card, Alert, ConfirmDialog } from "@/components/ui";
import { useCanvasStore } from "@/stores/canvas-store";
import { rememberProjectRevision } from "@/lib/story/project-cache";
interface Version {
  revision: number;
  savedAt: string;
  name: string;
  nodes: number;
  edges: number;
}
export function ProjectHistory({ flush }: { flush: () => Promise<void> }) {
  const [open, setOpen] = useState(false),
    [versions, setVersions] = useState<Version[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const id = useCanvasStore((s) => s.projectId);
  const load = async () => {
    setOpen(true);
    setBusy(true);
    setError("");
    try {
      await flush();
      const r = await fetch(`/api/projects/${id}/history`);
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      setVersions(data.versions);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const restore = async (revision: number) => {
    setBusy(true);
    setError("");
    try {
      await flush();
      const state = useCanvasStore.getState();
      const r = await fetch(`/api/projects/${id}/history`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revision, expectedRevision: state.revision ?? 0 }),
      });
      const project = await r.json();
      if (!r.ok) throw new Error(project.error);
      if (useCanvasStore.getState().projectId !== id) return;
      rememberProjectRevision(id!, project.revision);
      state.loadProject(project);
      setOpen(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="relative">
      <Button
        variant="secondary"
        size="sm"
        disabled={busy}
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : load())}
      >
        历史
      </Button>
      {open && (
        <Card className="absolute right-0 top-11 z-50 max-h-[65vh] w-80 max-w-[85vw] space-y-3 overflow-y-auto p-4 shadow-xl">
          <h3 className="text-sm font-semibold">项目历史</h3>
          <p className="text-xs text-white/50">
            保留最近 50 次保存。恢复前先保存当前内容，之后仍可回退。
          </p>
          {error && <Alert tone="error">{error}</Alert>}
          {!versions.length && <p className="text-xs text-white/50">暂无历史版本</p>}
          {versions.map((v) => (
            <div
              key={v.revision}
              className="flex items-center justify-between gap-2 border-t border-white/10 pt-3"
            >
              <div>
                <p className="text-xs">
                  版本 {v.revision} · {v.name}
                </p>
                <p className="mt-1 text-[11px] text-white/40">
                  {new Date(v.savedAt).toLocaleString()} · {v.nodes} 节点 / {v.edges} 连接
                </p>
              </div>
              <ConfirmDialog
                title={`恢复到版本 ${v.revision}？`}
                description="当前内容已保存到历史。恢复会替换画布内容。"
                onConfirm={() => restore(v.revision)}
                confirmText="恢复"
              >
                <Button variant="secondary" size="sm" disabled={busy}>
                  恢复
                </Button>
              </ConfirmDialog>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
