"use client";
import { useState } from "react";
import { Sparkles } from "lucide-react";
import { Alert, Button, CardAction } from "@/components/ui";
import { useCreationRequest } from "./useCreationRequest";
import { useCanvasStore } from "@/stores/canvas-store";
import { useCreationStore } from "@/stores/creation-store";
import { sameStorySource, storySource, type StorySource } from "@/lib/story/creation-brief";
import { inspirationResultSchema, type InspirationDirection } from "@/lib/story/inspirations";

export function StoryInspirations({
  disabled,
  onBusyChange,
}: {
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
}) {
  const prompt = useCreationStore((s) => s.userPrompt),
    brief = useCreationStore((s) => s.brief);
  const projectId = useCanvasStore((s) => s.projectId);
  const { request, cancel } = useCreationRequest();
  const [running, setRunning] = useState(false),
    [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    source: StorySource;
    directions: InspirationDirection[];
  } | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [undo, setUndo] = useState<{ before: StorySource; after: StorySource } | null>(null);
  const current = storySource(prompt, brief);
  const stale = !!result && !sameStorySource(current, result.source);
  const preview = selected === null ? null : result?.directions[selected];
  const generate = async () => {
    if (disabled || running || !prompt.trim()) return;
    setRunning(true);
    onBusyChange(true);
    setError(null);
    const source = storySource(prompt, brief);
    try {
      const value = inspirationResultSchema.parse(await request("/api/ai/inspirations", source));
      if (useCanvasStore.getState().projectId !== projectId) return;
      setResult({ source, directions: value.directions });
      setSelected(null);
    } catch (e) {
      if (useCanvasStore.getState().projectId === projectId)
        setError((e as Error).name === "AbortError" ? "已取消生成" : (e as Error).message);
    } finally {
      setRunning(false);
      onBusyChange(false);
    }
  };
  const adopt = () => {
    if (!preview || !result || stale || disabled || running) return;
    const next = storySource(preview.prompt, brief);
    setUndo({ before: current, after: next });
    useCreationStore.getState().setUserPrompt(preview.prompt);
    setResult(null);
    setSelected(null);
  };
  return (
    <section className="mt-7 border-t border-white/[0.08] pt-5" aria-label="AI 灵感">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <h2 className="text-sm font-semibold">灵感方向</h2>
        <div className="flex gap-2">
          {running && (
            <Button size="sm" variant="ghost" onClick={cancel}>
              取消
            </Button>
          )}
          <Button
            size="sm"
            variant="secondary"
            disabled={disabled || running || !prompt.trim()}
            onClick={generate}
          >
            <Sparkles size={14} />
            {running ? "生成方向中…" : result ? "换一组方向" : "生成三个方向"}
          </Button>
        </div>
      </div>
      {!result && !running && !undo && (
        <p className="text-xs text-white/45">
          {prompt.trim()
            ? "围绕当前创意和题材探索不同走向，预览后采用。"
            : "先写下一个人物或设定。"}
        </p>
      )}
      {error && <Alert tone="error">{error}</Alert>}
      {stale && (
        <p role="status" className="mb-3 text-xs text-amber-300">
          创意或设置已变化，请重新生成方向。
        </p>
      )}
      {result && !running && (
        <div className="divide-y divide-white/[0.08]">
          {result.directions.map((d, i) => (
            <CardAction
              key={i}
              disabled={disabled}
              aria-pressed={selected === i}
              onClick={() => setSelected(i)}
              className={`gap-3 rounded-lg px-3 py-3 ${selected === i ? "bg-brand-accent/10" : ""}`}
            >
              <span className="text-xs text-brand-accent">0{i + 1}</span>
              <div>
                <h3 className="text-sm font-medium">{d.title}</h3>
                <p className="mt-1 text-xs text-white/50">{d.summary}</p>
              </div>
            </CardAction>
          ))}
        </div>
      )}
      {preview && !running && (
        <div className="mt-4 rounded-xl border border-white/10 p-4" aria-label="灵感预览">
          <h3 className="text-sm font-semibold">{preview.title}</h3>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-white/70">
            {preview.prompt}
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setSelected(null)}>
              收起
            </Button>
            <Button size="sm" variant="primary" disabled={disabled || stale} onClick={adopt}>
              采用此方向
            </Button>
          </div>
        </div>
      )}
      {undo && (
        <div role="status" className="mt-3 flex items-center gap-3 text-xs text-white/60">
          已采用灵感方向
          <Button
            size="sm"
            variant="ghost"
            disabled={disabled || running || !sameStorySource(current, undo.after)}
            onClick={() => {
              useCreationStore.getState().setUserPrompt(undo.before.prompt);
              setUndo(null);
            }}
          >
            撤销采用
          </Button>
        </div>
      )}
    </section>
  );
}
