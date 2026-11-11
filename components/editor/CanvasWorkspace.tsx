"use client";

import { ShotWorkspaceBar } from "@/components/canvas/ShotWorkspaceBar";
import { useCreationStore } from "@/stores/creation-store";
import { shotWorkspaceGraph } from "@/lib/canvas/shot-workspace";
import { useShotProduction } from "@/components/creation/useShotProduction";
import { CanvasTools } from "@/components/canvas/CanvasTools";
import { useEffect, useState, useRef } from "react";
import { useReactFlow, useViewport, useInternalNode } from "@xyflow/react";
import {
  Film,
  HelpCircle,
  GitBranch,
  GitMerge,
  Trophy,
  FileText,
  ImageIcon,
  ZoomIn,
  ZoomOut,
  Scan,
  X,
  Plus,
  Send,
} from "lucide-react";
import { Button, Card, Badge, Label, Textarea, Tooltip } from "@/components/ui";
import { StoryCanvas } from "@/components/canvas/StoryCanvas";
import { NodeDetailPanel } from "@/components/panels/NodeDetailPanel";
import { useCanvasStore } from "@/stores/canvas-store";
import type { StoryNodeType } from "@/lib/story/types";
import { VariableEditor } from "./VariableEditor";

const NODE_TYPES = [
  { type: "video", label: "视频", icon: Film },
  { type: "choice", label: "选择", icon: HelpCircle },
  { type: "condition", label: "条件", icon: GitBranch },
  { type: "merge", label: "汇合", icon: GitMerge },
  { type: "ending", label: "结局", icon: Trophy },
  { type: "text", label: "文字", icon: FileText },
  { type: "image", label: "图片", icon: ImageIcon },
] as const;

export function CanvasWorkspace() {
  const { syncCanvas, loaded, busy: syncing, error: syncError } = useShotProduction();
  const shotId = useCanvasStore((s) => s.activeShotId);
  const settings = useCanvasStore((s) => s.shotWorkspaces);
  const shots = useCreationStore((s) => s.storyboardShots);
  const attempted = useRef("");
  useEffect(() => {
    const missing = shots
      .filter((s) => !settings[s.shotId]?.initialized)
      .map((s) => s.shotId)
      .join(",");
    const key = useCanvasStore.getState().projectId + ":" + missing;
    if (!loaded || syncing || !missing || attempted.current === key) return;
    attempted.current = key;
    void syncCanvas();
  }, [loaded, syncing, shots, settings, syncCanvas]);
  const nodes = useCanvasStore((s) => s.nodes);
  const edges = useCanvasStore((s) => s.edges);
  const selectedNodeId = useCanvasStore((s) => s.selectedNodeId);
  const selectedEdgeId = useCanvasStore((s) => s.selectedEdgeId);
  const addNode = useCanvasStore((s) => s.addNode);
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const selectNode = useCanvasStore((s) => s.selectNode);
  const selectEdge = useCanvasStore((s) => s.selectEdge);
  const [composerOpen, setComposerOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [variablesOpen, setVariablesOpen] = useState(false);
  const initialVariables = useCanvasStore((s) => s.initialVariables);
  const past = useCanvasStore((s) => s.past),
    future = useCanvasStore((s) => s.future);
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (
        target.closest("input,textarea,select,[contenteditable=true]") ||
        !(event.ctrlKey || event.metaKey)
      )
        return;
      if (event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) useCanvasStore.getState().redo();
        else useCanvasStore.getState().undo();
      } else if (event.key.toLowerCase() === "y") {
        event.preventDefault();
        useCanvasStore.getState().redo();
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, []);
  const flow = useReactFlow();
  const { zoom } = useViewport();

  const createNode = (type: StoryNodeType, description?: string) => {
    const element = document.getElementById("story-canvas-stage");
    const bounds = element?.getBoundingClientRect();
    const position = bounds
      ? flow.screenToFlowPosition({
          x: bounds.left + bounds.width / 2 - 110,
          y: bounds.top + bounds.height / 2 - 70,
        })
      : { x: 200, y: 200 };
    const id = addNode(type, position);
    if (description)
      updateNodeData(id, {
        title: description.slice(0, 24),
        scenePrompt: description,
        description,
      });
    selectNode(id);
    setComposerOpen(false);
    setPrompt("");
  };

  const openComposer = () => {
    selectNode(null);
    selectEdge(null);
    setComposerOpen((value) => !value);
  };

  return (
    <section
      className="canvas-workspace relative h-full w-full overflow-hidden"
      aria-label="全屏剧情画布"
      onPointerMove={(event) => {
        if (event.pointerType !== "mouse") return;
        const element = event.currentTarget,
          bounds = element.getBoundingClientRect();
        element.style.setProperty("--canvas-glow-x", `${event.clientX - bounds.left}px`);
        element.style.setProperty("--canvas-glow-y", `${event.clientY - bounds.top}px`);
        element.dataset.canvasGlow = "active";
      }}
      onPointerLeave={(event) => {
        delete event.currentTarget.dataset.canvasGlow;
      }}
    >
      <h1 className="sr-only">剧情画布</h1>
      {syncError && (
        <div
          role="alert"
          className="absolute bottom-20 left-4 z-30 rounded-lg bg-red-950 px-3 py-2 text-sm text-red-200"
        >
          {syncError}
        </div>
      )}
      {shotId && <ShotWorkspaceBar />}
      <div id="story-canvas-stage" className="absolute inset-0">
        <StoryCanvas />
      </div>

      <Card
        className="absolute bottom-3 left-1/2 z-20 flex max-w-[calc(100%-24px)] -translate-x-1/2 items-center gap-1 overflow-x-auto rounded-xl p-1.5 shadow-xl sm:bottom-4"
        aria-label="添加节点工具栏"
      >
        {NODE_TYPES.map(({ type, label, icon: Icon }) => (
          <Tooltip key={type} content={`添加${label}节点`}>
            <Button
              variant="ghost"
              className="h-8 shrink-0 gap-1.5 px-2.5 text-white/65"
              onClick={() => createNode(type)}
              aria-label={`添加${label}节点`}
            >
              <Icon size={16} />
              <span className="hidden xl:inline">{label}</span>
            </Button>
          </Tooltip>
        ))}
        <div className="mx-1 h-6 w-px shrink-0 bg-white/10" />
        <Tooltip content="描述新片段">
          <Button
            variant={composerOpen ? "outline" : "secondary"}
            className="h-8 shrink-0 gap-1.5 px-2.5"
            aria-label="描述新片段"
            aria-expanded={composerOpen}
            onClick={openComposer}
          >
            <Plus size={16} />
            <span className="hidden xl:inline">描述新片段</span>
          </Button>
        </Tooltip>
      </Card>

      <Card
        className="absolute bottom-20 left-3 z-10 flex items-center gap-1 rounded-xl p-1 shadow-lg lg:bottom-4 sm:left-4"
        aria-label="画布视图控制"
      >
        <Tooltip content="缩小">
          <Button variant="ghost" size="icon" aria-label="缩小画布" onClick={() => flow.zoomOut()}>
            <ZoomOut size={16} />
          </Button>
        </Tooltip>
        <span className="w-10 text-center text-xs tabular-nums text-white/60">
          {Math.round(zoom * 100)}%
        </span>
        <Tooltip content="放大">
          <Button variant="ghost" size="icon" aria-label="放大画布" onClick={() => flow.zoomIn()}>
            <ZoomIn size={16} />
          </Button>
        </Tooltip>
        <Tooltip content="适应画布">
          <Button
            variant="ghost"
            size="icon"
            aria-label="适应画布"
            onClick={() => {
              const p = useCanvasStore.getState().toProject();
              const visible = p && shotId ? shotWorkspaceGraph(p, shotId).nodes : nodes;
              void flow.fitView({ nodes: visible, padding: 0.25, duration: 200, maxZoom: 1 });
            }}
          >
            <Scan size={16} />
          </Button>
        </Tooltip>
      </Card>

      {!shotId && (
        <div className="pointer-events-none absolute left-4 top-20 hidden items-center gap-2 sm:flex">
          <Badge className="bg-oii-surface">{nodes.length} 个节点</Badge>
          <Badge className="bg-oii-surface">{edges.length} 条连接</Badge>
        </div>
      )}
      <div
        className="absolute left-3 top-28 z-20 flex flex-wrap gap-1 rounded-lg border border-white/[0.06] bg-oii-surface p-1 sm:left-4 sm:top-28"
        style={shotId ? { top: 136 } : undefined}
      >
        <Button
          variant="ghost"
          size="sm"
          disabled={!past.length}
          onClick={() => useCanvasStore.getState().undo()}
        >
          撤销
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={!future.length}
          onClick={() => useCanvasStore.getState().redo()}
        >
          重做
        </Button>
        <CanvasTools />
        {!shotId && (
          <Button
            variant="secondary"
            size="sm"
            aria-expanded={variablesOpen}
            onClick={() => setVariablesOpen(!variablesOpen)}
          >
            剧情变量
          </Button>
        )}
      </div>
      {variablesOpen && (
        <Card className="absolute left-3 top-44 z-30 max-h-[60vh] w-80 max-w-[calc(100%-24px)] space-y-4 overflow-y-auto p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">剧情变量</h2>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="关闭剧情变量"
              onClick={() => setVariablesOpen(false)}
            >
              <X size={15} />
            </Button>
          </div>
          <VariableEditor
            label="初始变量"
            value={initialVariables}
            onSave={(value) => useCanvasStore.getState().setInitialVariables(value)}
          />
        </Card>
      )}

      {composerOpen && (
        <Card className="absolute inset-x-3 bottom-36 z-20 mx-auto max-h-[calc(100%-280px)] max-w-lg overflow-y-auto p-4 shadow-xl sm:bottom-24">
          <div className="mb-3 flex items-center justify-between">
            <Label htmlFor="canvas-prompt" className="mb-0">
              描述新片段
            </Label>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="关闭片段输入"
              onClick={() => setComposerOpen(false)}
            >
              <X size={15} />
            </Button>
          </div>
          <Textarea
            id="canvas-prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="描述这个片段的画面、角色与动作…"
            rows={3}
            className="resize-none"
          />
          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="text-xs text-white/40">创建后可在属性面板中生成视频。</p>
            <Button
              variant="primary"
              disabled={!prompt.trim()}
              onClick={() => createNode("video", prompt.trim())}
            >
              <Send size={14} />
              添加片段
            </Button>
          </div>
        </Card>
      )}

      {selectedNodeId && <AnchoredNodePanel nodeId={selectedNodeId} />}

      {selectedEdgeId && !selectedNodeId && (
        <Card
          className="absolute bottom-36 right-3 top-32 z-20 flex w-[340px] max-w-[calc(100%-24px)] flex-col overflow-hidden shadow-xl sm:bottom-24 sm:right-4 sm:top-20"
          role="complementary"
          aria-label="节点属性"
        >
          <div className="flex shrink-0 items-center justify-between border-b border-white/[0.08] px-4 py-3">
            <h2 className="text-sm font-semibold text-white/85">属性面板</h2>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="关闭属性面板"
              onClick={() => {
                selectNode(null);
                selectEdge(null);
              }}
            >
              <X size={16} />
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <NodeDetailPanel />
          </div>
        </Card>
      )}
    </section>
  );
}

/** Anchor the composer below its node while keeping controls independent of canvas zoom. */
function AnchoredNodePanel({ nodeId }: { nodeId: string }) {
  const node = useInternalNode(nodeId);
  const { x, y, zoom } = useViewport();
  if (!node) return null;
  const position = node.internals.positionAbsolute;
  const width = node.measured.width ?? node.width ?? 220;
  const height = node.measured.height ?? node.height ?? 0;
  return (
    <Card
      key={nodeId}
      className="canvas-inspector nodrag nopan nowheel absolute z-30 flex max-h-[65vh] max-w-[calc(100%-24px)] -translate-x-1/2 flex-col overflow-hidden rounded-xl shadow-2xl"
      style={{
        width: node.type === "video" ? 620 : 440,
        left: x + (position.x + width / 2) * zoom,
        top: y + (position.y + height) * zoom + 12,
      }}
      role="complementary"
      aria-label={node.type === "video" ? "视频生成面板" : "节点编辑面板"}
    >
      <div className="min-h-0 flex-1 overflow-y-auto">
        <NodeDetailPanel />
      </div>
    </Card>
  );
}
