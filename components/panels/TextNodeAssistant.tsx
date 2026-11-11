"use client";
import { useEffect, useRef, useState } from "react";
import { Sparkles, Loader2 } from "lucide-react";
import { Button, Textarea, Label, Alert } from "@/components/ui";
import { useCanvasStore } from "@/stores/canvas-store";
import { storyContext } from "@/lib/canvas/workflow";
import { isContextEdge } from "@/lib/story/connections";
import type { TextNodeData } from "@/lib/story/types";

export function TextNodeAssistant({ nodeId, data }: { nodeId: string; data: TextNodeData }) {
  const [open, setOpen] = useState(false),
    [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [draft, setDraft] = useState("");
  const [original, setOriginal] = useState("");
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  async function generate() {
    if (request.current) return;
    const project = useCanvasStore.getState().toProject();
    if (!project) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError("");
    setOriginal(data.content);
    try {
      const sources = project.edges
        .filter((edge) => edge.target === nodeId && isContextEdge(edge, project.nodes))
        .map((edge) => project.nodes.find((node) => node.id === edge.source))
        .filter(Boolean)
        .map((node) => ({
          title: node!.data.title,
          content: node!.data.content,
          description: node!.data.description,
        }));
      const response = await fetch("/api/ai/node-text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          title: data.title,
          content: data.content,
          role: data.role ?? "scene",
          instruction,
          context: JSON.stringify({ ...storyContext(project, nodeId), references: sources }),
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "生成失败，请重试");
      if (typeof result.text !== "string" || !result.text.trim()) throw new Error("未生成有效内容");
      if (!controller.signal.aborted) setDraft(result.text);
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "生成失败");
    } finally {
      if (request.current === controller) {
        request.current = null;
        setBusy(false);
      }
    }
  }
  function apply(append: boolean) {
    const store = useCanvasStore.getState(),
      node = store.nodes.find((n) => n.id === nodeId);
    if (!node || node.type !== "text") return;
    store.updateNodeData(nodeId, {
      content: append ? [node.data.content, draft].filter(Boolean).join("\n\n") : draft,
    });
    setDraft("");
    setOpen(false);
  }
  return (
    <div className="space-y-3">
      <Button size="sm" variant="outline" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Sparkles size={14} />
        AI 生成内容
      </Button>
      {open && (
        <div className="space-y-3 border-t border-white/10 pt-3">
          <Label htmlFor={`text-instruction-${nodeId}`}>创作要求</Label>
          <Textarea
            id={`text-instruction-${nodeId}`}
            rows={2}
            maxLength={2000}
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder="例如：写一段主角拆开神秘信件的场景，紧张、克制，约 150 字"
          />
          <p className="text-xs text-white/50">
            结合文字类型、已有内容和剧情上下文生成，确认后再写入。
          </p>
          <div className="flex gap-2">
            <Button size="sm" disabled={busy || !instruction.trim()} onClick={generate}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}{" "}
              {busy ? "正在生成…" : draft ? "重新生成" : "生成草稿"}
            </Button>
            {busy && (
              <Button size="sm" variant="ghost" onClick={() => request.current?.abort()}>
                取消
              </Button>
            )}
          </div>
          {error && <Alert tone="error">{error}</Alert>}
          {draft && (
            <div className="space-y-2">
              <Label htmlFor={`text-draft-${nodeId}`}>生成草稿</Label>
              <Textarea
                id={`text-draft-${nodeId}`}
                rows={5}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
              {data.content !== original && (
                <p className="text-xs text-amber-300">
                  原文已有修改，替换会覆盖当前内容，也可以选择追加。
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button size="sm" disabled={busy || !draft.trim()} onClick={() => apply(false)}>
                  {data.content ? "替换内容" : "采用内容"}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy || !draft.trim()}
                  onClick={() => apply(true)}
                >
                  追加到末尾
                </Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => setDraft("")}>
                  放弃
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
