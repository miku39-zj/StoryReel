"use client";
import { useState } from "react";
import { StoryRuntime } from "@/lib/story/runtime";
import { validateProject } from "@/lib/story/graph";
import { useCanvasStore } from "@/stores/canvas-store";
import { Button, Alert } from "@/components/ui";
import { VariableEditor } from "@/components/editor/VariableEditor";
import type { StoryVariables } from "@/lib/story/types";
export function GraphDebugger() {
  const [open, setOpen] = useState(false),
    [runtime, setRuntime] = useState<StoryRuntime | null>(null),
    [revision, setRevision] = useState(0),
    [error, setError] = useState("");
  const nodes = useCanvasStore((s) => s.nodes),
    edges = useCanvasStore((s) => s.edges),
    initial = useCanvasStore((s) => s.initialVariables);
  const [overrides, setOverrides] = useState<StoryVariables | null>(null);
  const project = useCanvasStore.getState().toProject(),
    validation = project ? validateProject(project) : null;
  const step = (action: () => void) => {
    try {
      action();
      setError("");
      setRevision((v) => v + 1);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const start = () =>
    step(() => {
      if (!project?.startNodeId) throw new Error("请设置视频起点");
      setRuntime(new StoryRuntime(nodes, edges, project.startNodeId, overrides ?? initial));
    });
  const state = runtime?.snapshot(),
    title = (id: string) =>
      String(
        nodes.find((n) => n.id === id)?.data.title ||
          nodes.find((n) => n.id === id)?.data.question ||
          id,
      );
  return (
    <div
      className={`absolute right-4 top-40 sm:top-20 z-20 rounded-lg border border-white/[0.08] bg-oii-surface p-1 shadow-lg ${open ? "w-[310px]" : "w-auto"}`}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <Button size="sm" variant="ghost" aria-expanded={open} onClick={() => setOpen(!open)}>
        分支调试 {validation?.errors.length ? `· ${validation.errors.length} 项待完善` : ""}
      </Button>
      {open && (
        <div className="max-h-[52vh] space-y-3 overflow-y-auto p-2 text-xs">
          <p className="text-white/45">
            不调用 AI、不播放素材。使用当前画布快照模拟路线；修改画布后请重新开始。
          </p>
          <VariableEditor
            label="测试初始变量（不修改项目）"
            value={overrides ?? initial}
            onSave={setOverrides}
          />
          <Button size="sm" onClick={start}>
            从起点重新测试
          </Button>
          {error && <Alert tone="error">{error}</Alert>}
          {state && (
            <div key={revision} className="space-y-3">
              <p className="font-medium text-white/90">
                {title(state.currentNodeId!)}
                {state.ending ? " · 已到结局" : ""}
              </p>
              {!state.ending &&
              (runtime!.current.type === "choice" || runtime!.getChoices().length > 1) ? (
                runtime!.getChoices().map((c) => (
                  <Button
                    key={c.edgeId}
                    size="sm"
                    variant="secondary"
                    className="mr-2"
                    onClick={() =>
                      step(() => {
                        runtime!.choose(c.edgeId);
                      })
                    }
                  >
                    {c.label}
                  </Button>
                ))
              ) : !state.ending ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    step(() => {
                      if (runtime!.isTerminal()) throw new Error("该节点没有后续路线");
                      runtime!.advance();
                    })
                  }
                >
                  前进到下一节点
                </Button>
              ) : null}
              <pre className="whitespace-pre-wrap rounded-lg bg-white/5 p-2 text-brand-accent">
                {JSON.stringify(state.variables, null, 2)}
              </pre>
              <p className="text-white/60">{state.history.map(title).join(" → ")}</p>
              <ol className="space-y-2 text-white/50">
                {state.trace?.map((entry, i) => (
                  <li key={i}>{entry.message}</li>
                ))}
              </ol>
            </div>
          )}
          {validation && (
            <details>
              <summary className="cursor-pointer text-white/60">
                发布检查 · {validation.errors.length} 个问题
              </summary>
              <ul className="mt-2 space-y-2 text-amber-300/80">
                {[...validation.errors, ...validation.warnings].map((message, i) => (
                  <li key={i}>{message}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
