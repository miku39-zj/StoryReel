"use client";
import { useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { Copy, Flag, Pencil, Trash2 } from "lucide-react";
import { useCanvasStore } from "@/stores/canvas-store";
import { shotWorkspaceGraph } from "@/lib/canvas/shot-workspace";
import { copyFragment, pasteFragment } from "@/lib/canvas/editing";

export function NodeContextMenu({ nodeId, children }: { nodeId: string; children: ReactNode }) {
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const node = useCanvasStore((s) => s.nodes.find((n) => n.id === nodeId));
  const shotId = useCanvasStore((s) => s.activeShotId);
  const start = useCanvasStore((s) => s.startNodeId);
  function duplicate() {
    const store = useCanvasStore.getState(),
      project = store.toProject();
    if (!project) return;
    const scoped = store.activeShotId
      ? { ...project, ...shotWorkspaceGraph(project, store.activeShotId) }
      : project;
    const copied = pasteFragment(copyFragment(scoped, [nodeId]));
    if (store.activeShotId)
      for (const n of copied.nodes) {
        delete n.data.productionShotId;
        delete n.data.productionSourceRevision;
        n.data.canvasShotId = store.activeShotId;
      }
    store.applyGraph(
      [...store.nodes.map((n) => ({ ...n, selected: false })), ...copied.nodes],
      [...store.edges, ...copied.edges],
    );
    if (copied.nodes[0]) store.selectNode(copied.nodes[0].id);
  }
  const item =
    "flex cursor-default select-none items-center gap-2.5 rounded-md px-2.5 py-2 text-xs text-white/80 outline-none data-[highlighted]:bg-white/10 data-[disabled]:opacity-40";
  return (
    <div
      ref={wrapper}
      tabIndex={0}
      className="outline-none focus-visible:rounded-xl focus-visible:ring-2 focus-visible:ring-brand-accent/60"
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setPoint({ x: event.clientX, y: event.clientY });
      }}
      onKeyDown={(event) => {
        if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
          event.preventDefault();
          event.stopPropagation();
          const rect = event.currentTarget.getBoundingClientRect();
          setPoint({ x: rect.left + 24, y: rect.top + 24 });
        }
      }}
    >
      {children}
      {point &&
        node &&
        createPortal(
          <Menu.Root
            open
            modal={false}
            onOpenChange={(open) => {
              if (!open) setPoint(null);
            }}
          >
            <Menu.Trigger
              aria-label="节点菜单定位"
              style={{
                position: "fixed",
                left: point.x,
                top: point.y,
                width: 1,
                height: 1,
                opacity: 0,
                pointerEvents: "none",
              }}
            />
            <Menu.Portal>
              <Menu.Content
                aria-label="节点操作"
                align="start"
                sideOffset={2}
                collisionPadding={8}
                onCloseAutoFocus={(event) => {
                  event.preventDefault();
                  wrapper.current?.focus({ preventScroll: true });
                }}
                onContextMenu={(event) => event.preventDefault()}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => event.stopPropagation()}
                className="z-[300] min-w-44 rounded-lg border border-white/10 bg-oii-surface p-1 shadow-2xl"
              >
                <Menu.Label className="max-w-56 truncate px-2.5 py-2 text-[11px] text-white/45">
                  {String(node.data.title || node.data.question || node.data.label || "节点")}
                </Menu.Label>
                <Menu.Item
                  className={item}
                  onSelect={() => useCanvasStore.getState().selectNode(nodeId)}
                >
                  <Pencil size={14} />
                  编辑节点
                </Menu.Item>
                <Menu.Item className={item} onSelect={duplicate}>
                  <Copy size={14} />
                  创建副本
                </Menu.Item>
                {node.type === "video" && shotId && (
                  <Menu.Item
                    className={item}
                    onSelect={() => useCanvasStore.getState().setMainVideo(nodeId)}
                  >
                    <Flag size={14} />
                    设为分镜主视频
                  </Menu.Item>
                )}
                {node.type === "video" && !shotId && (
                  <Menu.Item
                    className={item}
                    disabled={start === nodeId}
                    onSelect={() => useCanvasStore.getState().setStartNode(nodeId)}
                  >
                    <Flag size={14} />
                    {start === nodeId ? "已是剧情起点" : "设为剧情起点"}
                  </Menu.Item>
                )}
                <Menu.Separator className="my-1 h-px bg-white/10" />
                <Menu.Item
                  className={`${item} !text-red-400 data-[highlighted]:!bg-red-400/10`}
                  onSelect={() => useCanvasStore.getState().deleteNode(nodeId)}
                >
                  <Trash2 size={14} />
                  删除节点<span className="ml-auto pl-4 text-[10px] text-white/35">可撤销</span>
                </Menu.Item>
              </Menu.Content>
            </Menu.Portal>
          </Menu.Root>,
          document.body,
        )}
    </div>
  );
}
