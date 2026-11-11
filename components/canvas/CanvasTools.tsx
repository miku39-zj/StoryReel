"use client";
import { shotWorkspaceGraph } from "@/lib/canvas/shot-workspace";
import { useRef, useState } from "react";
import { useReactFlow } from "@xyflow/react";
import { useCanvasStore } from "@/stores/canvas-store";
import {
  copyFragment,
  pasteFragment,
  layoutGraph,
  reviewStory,
  type GraphFragment,
} from "@/lib/canvas/editing";
import { Button, Input, Card } from "@/components/ui";
export function CanvasTools() {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState(""),
    [group, setGroup] = useState(""),
    [copied, setCopied] = useState(0);
  const clipboard = useRef<GraphFragment | null>(null),
    offset = useRef(48),
    flow = useReactFlow();
  const allNodes = useCanvasStore((s) => s.nodes),
    allEdges = useCanvasStore((s) => s.edges),
    selectedId = useCanvasStore((s) => s.selectedNodeId);
  const shotId = useCanvasStore((s) => s.activeShotId);
  useCanvasStore((s) => s.shotWorkspaces);
  const full = useCanvasStore.getState().toProject();
  const graph =
    full && shotId ? shotWorkspaceGraph(full, shotId) : { nodes: allNodes, edges: allEdges };
  const { nodes, edges } = graph;
  const selected = nodes.filter((n) => n.selected || n.id === selectedId),
    store = useCanvasStore.getState(),
    project = full ? { ...full, nodes, edges } : null;
  const applyNodes = (next: typeof nodes) =>
    shotId ? store.updateShotNodes(next) : store.onNodesChange(next);
  const applyGraph = (next: typeof nodes, links: typeof edges) => {
    if (shotId) {
      store.updateShotNodes(next);
      store.updateShotEdges(links);
    } else store.applyGraph(next, links);
  };
  const locate = (id: string) => {
    store.selectNode(id);
    void flow.fitView({ nodes: [{ id }], padding: 1, duration: 250, maxZoom: 1 });
    setOpen(false);
  };
  const findings = project ? reviewStory(project) : [];
  return (
    <div className="relative">
      <Button variant="secondary" size="sm" aria-expanded={open} onClick={() => setOpen(!open)}>
        画布工具
      </Button>
      {open && (
        <Card className="absolute left-0 top-10 z-40 max-h-[65vh] w-80 space-y-3 overflow-auto p-4 shadow-xl">
          <p className="text-xs text-white/50">
            拖动空白处平移；Shift 拖动框选，Shift 点选可多选。已选 {selected.length} 项
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => applyNodes(nodes.map((n) => ({ ...n, selected: true })))}
            >
              全选
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={!selected.length}
              onClick={() => {
                if (project) {
                  clipboard.current = copyFragment(
                    project,
                    selected.map((n) => n.id),
                  );
                  setCopied(selected.length);
                  offset.current = 48;
                }
              }}
            >
              复制
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={!copied}
              onClick={() => {
                if (clipboard.current) {
                  const fragment = pasteFragment(clipboard.current, offset.current);
                  offset.current += 48;
                  applyGraph(
                    [...nodes.map((n) => ({ ...n, selected: false })), ...fragment.nodes],
                    [...edges, ...fragment.edges],
                  );
                }
              }}
            >
              粘贴{copied ? ` (${copied})` : ""}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={!nodes.length}
              onClick={() => {
                applyGraph(layoutGraph(nodes, edges), edges);
                requestAnimationFrame(() => flow.fitView({ padding: 0.2, duration: 250 }));
              }}
            >
              自动布局
            </Button>
          </div>
          <div className="flex gap-2">
            <Input
              aria-label="节点分组名称"
              placeholder="分组名称"
              value={group}
              onChange={(e) => setGroup(e.target.value)}
            />
            <Button
              size="sm"
              disabled={!selected.length}
              onClick={() =>
                applyGraph(
                  nodes.map((n) =>
                    selected.some((s) => s.id === n.id)
                      ? { ...n, data: { ...n.data, groupLabel: group.trim() || undefined } }
                      : n,
                  ),
                  edges,
                )
              }
            >
              设置分组
            </Button>
          </div>
          <Input
            aria-label="搜索节点"
            placeholder="搜索标题、内容或分组"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="max-h-40 space-y-1 overflow-auto">
            {nodes
              .filter((n) =>
                `${n.data.title ?? ""} ${n.data.question ?? ""} ${n.data.content ?? ""} ${n.data.groupLabel ?? ""}`
                  .toLowerCase()
                  .includes(query.toLowerCase()),
              )
              .map((n) => (
                <Button
                  key={n.id}
                  size="sm"
                  variant="ghost"
                  className="w-full justify-start truncate"
                  onClick={() => locate(n.id)}
                >
                  {String(n.data.title || n.data.question || n.type)}
                  {n.data.groupLabel ? ` · ${n.data.groupLabel}` : ""}
                </Button>
              ))}
          </div>
          {!shotId && (
            <details className="text-xs text-white/60">
              <summary className="cursor-pointer">剧情规则检查 · {findings.length} 项</summary>
              <p className="py-2 text-white/40">本地规则检查，不调用模型。</p>
              {findings.map((f, i) => (
                <button
                  key={i}
                  className="mb-2 block text-left text-amber-300/80"
                  onClick={() => locate(f.nodeId)}
                >
                  {f.message}
                </button>
              ))}
            </details>
          )}
        </Card>
      )}
    </div>
  );
}
