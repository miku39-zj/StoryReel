"use client";

import { usePlayerStore } from "@/stores/player-store";
import { useCanvasStore } from "@/stores/canvas-store";
import { Button, Card, Badge } from "@/components/ui";
import { RotateCcw, History, Clock, GitBranch } from "lucide-react";

export function PlaybackPanel() {
  const variables = usePlayerStore((s) => s.variables);
  const trace = usePlayerStore((s) => s.trace);
  const phase = usePlayerStore((s) => s.phase);
  const history = usePlayerStore((s) => s.history);
  const choices = usePlayerStore((s) => s.choices);
  const currentNodeId = usePlayerStore((s) => s.currentNodeId);
  const interactionAt = usePlayerStore((s) => s.interactionAt);
  const reset = usePlayerStore((s) => s.reset);
  const nodes = useCanvasStore((s) => s.nodes);
  const phaseLabels = {
    idle: "等待播放",
    playing: "播放中",
    awaiting: "等待选择",
    transitioning: "切换片段",
    ended: "已结束",
    error: "播放中断",
  };
  const titleFor = (id: string) => {
    const node = nodes.find((n) => n.id === id);
    return String(node?.data.title || node?.data.question || node?.data.label || "剧情节点");
  };

  return (
    <Card className="min-w-0 p-5">
      <div className="mb-5 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-white/90">播放状态</h2>
        <Badge className="border-brand-accent/20 bg-brand-accent/10 text-brand-accent">
          {phaseLabels[phase]}
        </Badge>
      </div>
      <p className="mb-1.5 text-xs text-white/40">当前场景</p>
      <p className="text-sm font-medium leading-relaxed text-white/85">
        {currentNodeId ? titleFor(currentNodeId) : "等待故事开始"}
      </p>
      {interactionAt !== undefined && phase !== "ended" && (
        <p className="mt-3 flex items-center gap-2 text-xs text-white/45">
          <Clock size={13} />
          {interactionAt} 秒时出现剧情选择
        </p>
      )}
      {choices.length > 0 && (
        <div className="mt-5 border-t border-white/[0.08] pt-5">
          <h3 className="mb-3 flex items-center gap-2 text-xs font-medium text-white/60">
            <GitBranch size={14} />
            当前可选路线
          </h3>
          <ul className="space-y-2">
            {choices.map((c) => (
              <li key={c.edgeId} className="text-xs leading-relaxed text-white/65">
                {c.label}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="mt-5 border-t border-white/[0.08] pt-5">
        <h3 className="mb-4 flex items-center gap-2 text-xs font-medium text-white/60">
          <History size={14} />
          观看路径 <span className="ml-auto text-white/35">{history.length}</span>
        </h3>
        {history.length ? (
          <ol className="max-h-72 space-y-2 overflow-y-auto">
            {history.map((id, i) => (
              <li
                key={`${id}-${i}`}
                className={`flex items-start gap-3 rounded-lg p-2.5 ${i === history.length - 1 ? "bg-brand-accent/10 text-white/90" : "text-white/50"}`}
              >
                <span className="mt-0.5 text-[10px] tabular-nums text-white/35">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="text-xs leading-relaxed">{titleFor(id)}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-xs text-white/40">播放后，这里会记录经过的场景。</p>
        )}
      </div>
      <section className="mt-5 border-t border-white/10 pt-4">
        <h3 className="mb-3 text-xs text-white/60">当前剧情变量</h3>
        {Object.keys(variables).length ? (
          <dl className="space-y-2">
            {Object.entries(variables).map(([key, value]) => (
              <div key={key} className="flex justify-between gap-3 text-xs">
                <dt className="text-white/50">{key}</dt>
                <dd className="text-brand-accent">{String(value)}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-xs text-white/40">未声明变量</p>
        )}
      </section>
      <details className="mt-4 text-xs text-white/60">
        <summary className="cursor-pointer">分支判断记录</summary>
        <ol className="max-h-64 space-y-3 overflow-auto pt-3">
          {trace?.map((entry, i) => (
            <li key={i} className="break-words border-l border-brand-accent/40 pl-2">
              {titleFor(entry.nodeId)} · {entry.message}
              <pre className="whitespace-pre-wrap text-white/40">
                {JSON.stringify(entry.variables)}
              </pre>
            </li>
          ))}
        </ol>
      </details>
      <Button
        variant="secondary"
        className="mt-5 w-full"
        disabled={phase === "idle"}
        onClick={reset}
      >
        <RotateCcw size={14} />
        从头体验
      </Button>
    </Card>
  );
}
