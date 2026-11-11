"use client";
import NextImage from "next/image";

import { useState } from "react";
import { FileText, Film, ImageIcon, X, Link2, Plus } from "lucide-react";
import { Button, Select, Badge, Label, Alert, DropdownMenu } from "@/components/ui";
import { useCanvasStore } from "@/stores/canvas-store";
import {
  connectedInputs,
  proposeConnection,
  INPUT_LABELS,
  resolvePrompt,
} from "@/lib/story/connections";
import type { InputRole } from "@/lib/story/types";

export function NodeInputsPanel({
  nodeId,
  compact = false,
  promptInEditor = false,
}: {
  nodeId: string;
  compact?: boolean;
  promptInEditor?: boolean;
}) {
  const nodes = useCanvasStore((s) => s.nodes);
  const edges = useCanvasStore((s) => s.edges);
  const addEdge = useCanvasStore((s) => s.addEdge);
  const updateEdge = useCanvasStore((s) => s.updateEdge);
  const deleteEdge = useCanvasStore((s) => s.deleteEdge);
  const [error, setError] = useState("");
  const target = nodes.find((n) => n.id === nodeId);
  const inputs = connectedInputs(nodeId, nodes, edges).filter(
    (input) => !promptInEditor || input.role !== "prompt",
  );
  const candidates = nodes.filter(
    (source) => !proposeConnection(source.id, nodeId, nodes, edges, { kind: "context" }).error,
  );
  const prompt = resolvePrompt(nodeId, nodes, edges);
  if (compact)
    return (
      <section aria-label="生成输入" className="space-y-3">
        <div className="flex items-center gap-2">
          <DropdownMenu
            label="添加参考素材"
            trigger={
              <Button variant="secondary" size="sm" className="gap-1.5 text-xs">
                <Plus size={14} />
                添加参考
              </Button>
            }
            items={[
              ...candidates.map((n) => ({
                key: n.id,
                label: String(n.data.title || n.type),
                onSelect: () => {
                  if (!addEdge(n.id, nodeId, { kind: "context" })) setError("无法连接此素材。");
                },
              })),
              {
                key: "new-text",
                label: "新建文本提示词",
                icon: <FileText size={14} />,
                onSelect: () => {
                  useCanvasStore.getState().addConnectedNode(nodeId, "input", "text", {
                    kind: "context",
                    inputRole: "prompt",
                  });
                  useCanvasStore.getState().selectNode(nodeId);
                },
              },
              {
                key: "new-image",
                label: "新建参考图片",
                icon: <ImageIcon size={14} />,
                onSelect: () => {
                  useCanvasStore.getState().addConnectedNode(nodeId, "input", "image", {
                    kind: "context",
                    inputRole: "reference-image",
                  });
                  useCanvasStore.getState().selectNode(nodeId);
                },
              },
              {
                key: "new-video",
                label: "新建参考视频",
                icon: <Film size={14} />,
                onSelect: () => {
                  useCanvasStore.getState().addConnectedNode(nodeId, "input", "video", {
                    kind: "context",
                    inputRole: "reference-video",
                  });
                  useCanvasStore.getState().selectNode(nodeId);
                },
              },
            ].filter((item) => target?.type !== "image" || item.key !== "new-video")}
          />
          <span className="text-[11px] text-white/35">
            {inputs.length
              ? `${inputs.length} 个参考 · 生成时同步读取`
              : target?.type === "image"
                ? "连接文本要求与角色、场景参考图"
                : "连接图片、视频或文本作为生成参考"}
          </span>
        </div>
        {inputs.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {inputs.map(({ edge, source, role }, index) => {
              const Icon =
                source.type === "text" ? FileText : source.type === "image" ? ImageIcon : Film;
              const url =
                source.type === "image"
                  ? String(source.data.imageUrl || "")
                  : String(source.data.thumbnailUrl || "");
              return (
                <div
                  key={edge.id}
                  className="group relative w-28 shrink-0 rounded-xl border border-white/10 bg-white/[0.03] p-1.5"
                >
                  <div className="relative flex h-16 items-center justify-center overflow-hidden rounded-lg bg-white/[0.03]">
                    {url ? (
                      <NextImage
                        loading="eager"
                        unoptimized
                        width={100}
                        height={64}
                        src={url}
                        alt={String(source.data.title || "参考素材")}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <Icon size={22} className="text-white/35" />
                    )}
                    <span className="absolute bottom-1 left-1 rounded bg-black/65 px-1.5 text-[10px] text-white/75">
                      {index + 1} · {INPUT_LABELS[role]}
                    </span>
                  </div>
                  <Button
                    variant="secondary"
                    size="icon-sm"
                    className="absolute right-0 top-0 h-5 w-5 rounded-full"
                    aria-label={`移除输入：${String(source.data.title)}`}
                    onClick={() => {
                      deleteEdge(edge.id);
                      setError("");
                    }}
                  >
                    <X size={11} />
                  </Button>
                  <p
                    className="truncate px-0.5 py-1 text-[11px] text-white/65"
                    title={String(source.data.title)}
                  >
                    {String(source.data.title || "输入素材")}
                  </p>
                  {source.type === "image" && (
                    <>
                      <Label htmlFor={`input-role-${edge.id}`} className="sr-only">
                        {String(source.data.title)}的输入用途
                      </Label>
                      <Select
                        id={`input-role-${edge.id}`}
                        size="sm"
                        className="h-7 px-1.5 text-[10px]"
                        value={role}
                        options={(target?.type === "image"
                          ? ["reference-image"]
                          : ["reference-image", "first-frame", "last-frame"]
                        ).map((value) => ({
                          value,
                          label: INPUT_LABELS[value as InputRole],
                        }))}
                        onChange={(value) => {
                          if (!updateEdge(edge.id, { inputRole: value as InputRole }))
                            setError("该用途已有输入，或会形成循环引用。");
                          else setError("");
                        }}
                      />
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {!promptInEditor && prompt && (
          <p className="max-h-20 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-white/[0.025] px-3 py-2 text-xs leading-relaxed text-white/50">
            <span className="mr-2 text-brand-accent">上游文本</span>
            {prompt}
          </p>
        )}
        {error && (
          <Alert tone="error" className="text-xs">
            {error}
          </Alert>
        )}
      </section>
    );
  return (
    <section className="space-y-3 border-y border-white/[0.08] py-4" aria-label="生成输入">
      <div className="flex items-center gap-2">
        <Link2 size={14} className="text-brand-accent" />
        <h3 className="text-xs font-semibold text-white/80">输入素材</h3>
        <Badge className="ml-auto">{inputs.length}</Badge>
      </div>
      <p className="text-xs leading-relaxed text-white/45">
        连接的文本与素材会在生成时自动读取最新内容。
      </p>
      {inputs.map(({ edge, source, role }) => {
        const Icon = source.type === "text" ? FileText : source.type === "image" ? ImageIcon : Film;
        const ready =
          source.type === "text"
            ? !!source.data.content
            : source.type === "image"
              ? !!source.data.imageUrl
              : !!source.data.videoUrl;
        return (
          <div
            key={edge.id}
            className="space-y-2 rounded-lg border border-white/[0.08] bg-white/[0.02] p-3"
          >
            <div className="flex items-center gap-2">
              <Icon size={14} className="shrink-0 text-white/40" />
              <span className="min-w-0 flex-1 truncate text-xs text-white/80">
                {String(source.data.title || "输入素材")}
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`移除输入：${String(source.data.title)}`}
                onClick={() => {
                  deleteEdge(edge.id);
                  setError("");
                }}
              >
                <X size={13} />
              </Button>
            </div>
            {source.type === "image" && target?.type === "video" ? (
              <>
                <Label htmlFor={`input-role-${edge.id}`} className="sr-only">
                  {String(source.data.title)}的输入用途
                </Label>
                <Select
                  id={`input-role-${edge.id}`}
                  size="sm"
                  value={role}
                  options={["reference-image", "first-frame", "last-frame"].map((value) => ({
                    value,
                    label: INPUT_LABELS[value as InputRole],
                  }))}
                  onChange={(value) => {
                    if (!updateEdge(edge.id, { inputRole: value as InputRole }))
                      setError("该用途已有输入，或会形成循环引用。");
                    else setError("");
                  }}
                />
              </>
            ) : (
              <Badge>{INPUT_LABELS[role]}</Badge>
            )}
            <p className={`text-[11px] ${ready ? "text-white/40" : "text-amber-300/80"}`}>
              {ready ? "已就绪，生成时自动使用" : "等待填写内容或添加素材"}
            </p>
          </div>
        );
      })}
      <Label htmlFor={`input-picker-${nodeId}`} className="mb-0 text-xs">
        连接画布中的素材
      </Label>
      <Select
        id={`input-picker-${nodeId}`}
        size="sm"
        value=""
        placeholder="选择文本、图片或视频"
        disabled={!candidates.length}
        options={[
          { value: "", label: candidates.length ? "选择素材节点" : "暂无可连接素材" },
          ...candidates.map((n) => ({ value: n.id, label: String(n.data.title || n.type) })),
        ]}
        onChange={(value) => {
          if (value && !addEdge(value, nodeId, { kind: "context" }))
            setError("无法连接此素材，请检查输入关系。");
          else setError("");
        }}
      />
      {!inputs.length && (
        <p className="text-[11px] text-white/35">也可以从节点左侧的圆点拖出，新建输入素材。</p>
      )}
      {prompt && (
        <div>
          <p className="mb-1 text-[11px] text-white/40">上游文本预览</p>
          <p className="max-h-28 overflow-auto whitespace-pre-wrap break-words text-xs leading-relaxed text-white/70">
            {prompt}
          </p>
        </div>
      )}
      {error && (
        <Alert tone="error" className="text-xs">
          {error}
        </Alert>
      )}
    </section>
  );
}
