"use client";
import NextImage from "next/image";

import { TextNodeAssistant } from "./TextNodeAssistant";
import { AssetBindings } from "@/components/canvas/AssetBindings";
import { ConditionRules, VariableOperations } from "@/components/editor/RuleEditors";
import { NodeGenerationStatus } from "@/components/canvas/GenerationTasks";
import { useCanvasJobs } from "@/stores/canvas-jobs-store";
import { useEffect, useState } from "react";
import { useCanvasStore } from "@/stores/canvas-store";
import type {
  VideoNodeData,
  ChoiceNodeData,
  EndingNodeData,
  ConditionNodeData,
  MergeNodeData,
  TextNodeData,
  ImageNodeData,
  StoryFlowEdge,
  InputRole,
} from "@/lib/story/types";
import { NodeInputsPanel } from "./NodeInputsPanel";
import {
  resolveVideoInputs,
  resolvePrompt,
  isContextEdge,
  inputRole,
  INPUT_LABELS,
} from "@/lib/story/connections";
import {
  Trash2,
  Flag,
  Loader2,
  X,
  ArrowUp,
  SlidersHorizontal,
  Volume2,
  VolumeX,
  Film,
} from "lucide-react";
import {
  Button,
  Input,
  Textarea,
  NumberInput,
  Select,
  Switch,
  Tooltip,
  ConfirmDialog,
  Label,
  Badge,
  Alert,
} from "@/components/ui";
import { VariableEditor } from "@/components/editor/VariableEditor";
import { AssetPicker } from "@/components/AssetPicker";

export function NodeDetailPanel() {
  const selectedNodeId = useCanvasStore((s) => s.selectedNodeId);
  const selectedEdgeId = useCanvasStore((s) => s.selectedEdgeId);
  const nodes = useCanvasStore((s) => s.nodes);
  const edges = useCanvasStore((s) => s.edges);
  const shotId = useCanvasStore((s) => s.activeShotId);
  const startNodeId = useCanvasStore((s) => s.startNodeId);
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const deleteNode = useCanvasStore((s) => s.deleteNode);
  const setStartNode = useCanvasStore((s) => s.setStartNode);
  const updateEdge = useCanvasStore((s) => s.updateEdge);
  const deleteEdge = useCanvasStore((s) => s.deleteEdge);

  const node = nodes.find((n) => n.id === selectedNodeId);
  const selectedEdge = edges.find((e) => e.id === selectedEdgeId);

  if (!node) {
    if (selectedEdge) {
      if (isContextEdge(selectedEdge, nodes))
        return <ContextEdgeEditor key={selectedEdge.id} edge={selectedEdge} />;
      return (
        <EdgeDetailPanel
          edgeId={selectedEdge.id}
          isCondition={nodes.find((n) => n.id === selectedEdge.source)?.type === "condition"}
          choiceLabel={(selectedEdge.data?.choiceLabel as string) ?? ""}
          condition={(selectedEdge.data?.condition as string) ?? ""}
          setVariables={selectedEdge.data?.setVariables ?? {}}
          variableOperations={selectedEdge.data?.variableOperations ?? []}
          onUpdate={(patch) => updateEdge(selectedEdge.id, patch)}
          onDelete={() => deleteEdge(selectedEdge.id)}
        />
      );
    }
    return (
      <div className="h-full flex items-center justify-center text-slate-500 text-sm">
        选择一个节点以编辑
      </div>
    );
  }

  const data = node.data;
  const isStart = startNodeId === node.id;

  const nodeTypeLabel: Record<string, string> = {
    video: "视频节点",
    choice: "选择节点",
    condition: "条件节点",
    merge: "汇合节点",
    ending: "结局节点",
    text: "文字节点",
    image: "图片节点",
  };

  return (
    <div
      className="flex flex-col"
      style={{ minHeight: node.type === "video" ? undefined : "100%" }}
    >
      {/* 头部 */}
      <div className="flex items-center justify-between gap-2 px-4 py-3 sticky top-0 z-10 border-b border-white/[0.07] bg-oii-surface">
        <span className="min-w-0 truncate text-sm font-semibold text-white/85">
          {node.type === "video"
            ? `视频生成 · ${String(data.title || "未命名片段")}`
            : (nodeTypeLabel[node.type ?? ""] ?? node.type)}
        </span>
        <div className="flex items-center gap-2">
          {shotId && node.type === "video" && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="设为分镜主视频"
              onClick={() => useCanvasStore.getState().setMainVideo(node.id)}
            >
              <Flag size={14} />
            </Button>
          )}
          {!shotId && !isStart && node.type === "video" && (
            <Tooltip content="设为起始节点">
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setStartNode(node.id)}
                aria-label="设为起始节点"
              >
                <Flag size={14} />
              </Button>
            </Tooltip>
          )}
          <ConfirmDialog
            title="删除这个节点？"
            description="节点及其所有连线都会被删除，可使用画布撤销恢复。"
            confirmText="删除"
            onConfirm={() => deleteNode(node.id)}
          >
            <Button variant="danger" size="icon-sm" aria-label="删除节点">
              <Trash2 size={14} />
            </Button>
          </ConfirmDialog>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={node.type === "video" ? "关闭生成面板" : "关闭节点面板"}
            onClick={() => useCanvasStore.getState().selectNode(null)}
          >
            <X size={15} />
          </Button>
        </div>
      </div>

      {/* 内容 */}
      <div className={node.type === "video" ? "flex-1 p-4 space-y-4" : "flex-1 p-4 space-y-4"}>
        {isStart && node.type !== "video" && (
          <Badge className="border-brand-accent/20 bg-brand-accent/10 text-brand-accent">
            起始节点
          </Badge>
        )}

        {data.nodeType === "image" && (
          <>
            <AssetBindings nodeId={node.id} />
            <NodeGenerationStatus nodeId={node.id} />
          </>
        )}
        {data.nodeType === "video" && (
          <VideoNodeEditor
            key={node.id}
            data={data as VideoNodeData}
            onChange={(patch) => updateNodeData(node.id, patch)}
            nodeId={node.id}
          />
        )}
        {data.nodeType === "choice" && (
          <ChoiceNodeEditor
            nodeId={node.id}
            data={data as ChoiceNodeData}
            onChange={(patch) => updateNodeData(node.id, patch)}
          />
        )}
        {data.nodeType === "ending" && (
          <EndingNodeEditor
            data={data as EndingNodeData}
            onChange={(patch) => updateNodeData(node.id, patch)}
          />
        )}
        {data.nodeType === "merge" && (
          <MergeNodeEditor
            data={data as MergeNodeData}
            onChange={(patch) => updateNodeData(node.id, patch)}
          />
        )}
        {data.nodeType === "condition" && (
          <ConditionNodeEditor
            data={data as ConditionNodeData}
            onChange={(patch) => updateNodeData(node.id, patch)}
          />
        )}
        {data.nodeType === "text" && (
          <TextNodeEditor
            key={node.id}
            data={data as TextNodeData}
            nodeId={node.id}
            onChange={(patch) => updateNodeData(node.id, patch)}
          />
        )}
        {data.nodeType === "image" && (
          <ImageNodeEditor
            data={data as ImageNodeData}
            nodeId={node.id}
            onChange={(patch) => updateNodeData(node.id, patch)}
          />
        )}
      </div>
    </div>
  );
}

// ── 子编辑器 ──────────────────────────────────────────────────────────────────

// ── VideoNodeEditor (with Seedance params) ────────────────────────────────────

function VideoNodeEditor({
  data,
  onChange,
  nodeId,
}: {
  data: VideoNodeData;
  onChange: (patch: Partial<VideoNodeData>) => void;
  nodeId: string;
}) {
  const nodes = useCanvasStore((s) => s.nodes);
  const edges = useCanvasStore((s) => s.edges);
  const inputs = resolveVideoInputs(nodeId, nodes, edges);

  const jobs = useCanvasJobs((s) => s.jobs);
  const handleSeedanceGenerate = () => useCanvasJobs.getState().submit([nodeId]);
  const [modelOverride, setModelOverride] = useState<string | null | undefined>(undefined);
  const [modelConfigError, setModelConfigError] = useState(false);
  useEffect(() => {
    let stopped = false;
    fetch("/api/config/check")
      .then(async (response) => {
        if (!response.ok) throw new Error("模型配置读取失败");
        const config = await response.json();
        if (!stopped)
          setModelOverride(
            typeof config.videoModelOverride === "string" ? config.videoModelOverride : null,
          );
      })
      .catch(() => {
        if (!stopped) setModelConfigError(true);
      });
    return () => {
      stopped = true;
    };
  }, []);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const submitting = useCanvasJobs((s) => s.loading);
  const busy =
    jobs.some((j) => j.nodeId === nodeId && ["queued", "running"].includes(j.status)) || submitting;

  return (
    <>
      <div>
        <Label htmlFor={`scene-prompt-${nodeId}`} className="mb-2 text-xs text-white/60">
          画面描述
        </Label>
        <Textarea
          id={`scene-prompt-${nodeId}`}
          value={
            inputs.inputs.some((input) => input.role === "prompt")
              ? resolvePrompt(nodeId, nodes, edges, data.scenePrompt ?? "")
              : (data.scenePrompt ?? "")
          }
          onChange={(event) => useCanvasStore.getState().setVideoPrompt(nodeId, event.target.value)}
          placeholder="描述你想生成的画面、角色动作、镜头运动与声音…"
          rows={4}
          className="min-h-[112px] resize-y rounded-lg border-white/10 bg-white/[0.02] p-3 text-sm leading-6"
        />
      </div>
      <div className="space-y-3 border-y border-white/[0.07] py-3">
        <NodeInputsPanel key={nodeId} nodeId={nodeId} compact promptInEditor />
        <AssetBindings nodeId={nodeId} />
        <AssetPicker
          title="选择视频或配音"
          types={["video", "audio"]}
          onSelect={(asset) =>
            onChange(
              asset.type === "video"
                ? { videoUrl: asset.url, segments: undefined, generationStatus: "done" }
                : { audioUrl: asset.url },
            )
          }
        >
          <Button size="sm">选择视频或配音</Button>
        </AssetPicker>
      </div>
      <NodeGenerationStatus nodeId={nodeId} />
      {inputs.errors.length > 0 && (
        <Alert tone="warning" className="text-xs">
          {inputs.errors.join(" ")}
        </Alert>
      )}
      {data.generationError && (
        <Alert tone="error" className="text-xs">
          {data.generationError}
        </Alert>
      )}
      {settingsOpen && (
        <div
          id="video-generation-settings"
          className="grid grid-cols-2 gap-3 rounded-xl border border-white/[0.08] bg-white/[0.02] p-3 "
        >
          <div>
            <Label htmlFor="video-mode">生成模式</Label>
            <Select
              id="video-mode"
              size="sm"
              value={inputs.mode}
              onChange={(value) => {
                const store = useCanvasStore.getState();
                const roles =
                  value === "reference-to-video"
                    ? ["first-frame", "last-frame"]
                    : value === "text-to-video"
                      ? ["first-frame", "last-frame", "reference-image", "reference-video"]
                      : value === "image-to-video"
                        ? ["last-frame", "reference-image", "reference-video"]
                        : ["reference-image", "reference-video"];
                const remove = new Set(
                  inputs.inputs
                    .filter((input) => roles.includes(input.role))
                    .map((input) => input.edge.id),
                );
                if (remove.size)
                  store.onEdgesChange(store.edges.filter((edge) => !remove.has(edge.id)));
                onChange({
                  seedanceMode: value as VideoNodeData["seedanceMode"],
                  ...(roles.includes("first-frame") ? { firstFrameUrl: undefined } : {}),
                  ...(roles.includes("last-frame") ? { lastFrameUrl: undefined } : {}),
                  ...(roles.includes("reference-image")
                    ? { referenceImageUrls: undefined, referenceVideoUrls: undefined }
                    : {}),
                });
              }}
              options={[
                { value: "text-to-video", label: "文生视频" },
                { value: "image-to-video", label: "图生视频" },
                { value: "first-last-frame", label: "首尾帧" },
                { value: "reference-to-video", label: "多素材参考" },
              ]}
            />
          </div>
          <div>
            <Label htmlFor="video-ratio">宽高比</Label>
            <Select
              id="video-ratio"
              size="sm"
              value={data.seedanceAspectRatio ?? "16:9"}
              onChange={(value) =>
                onChange({ seedanceAspectRatio: value as VideoNodeData["seedanceAspectRatio"] })
              }
              options={["16:9", "9:16", "1:1", "4:3", "3:4"]}
            />
          </div>
          <div>
            <Label htmlFor="video-resolution">分辨率</Label>
            <Select
              id="video-resolution"
              size="sm"
              value={data.seedanceResolution ?? "480p"}
              onChange={(value) =>
                onChange({ seedanceResolution: value as VideoNodeData["seedanceResolution"] })
              }
              options={["480p", "720p", "1080p"]}
            />
          </div>
          <div>
            <Label htmlFor="video-duration">视频时长</Label>
            <Select
              id="video-duration"
              size="sm"
              value={String(data.seedanceDuration ?? 5)}
              onChange={(value) =>
                onChange({ seedanceDuration: Number(value) as VideoNodeData["seedanceDuration"] })
              }
              options={[
                { value: "5", label: "5 秒" },
                { value: "8", label: "8 秒" },
                { value: "10", label: "10 秒" },
              ]}
            />
          </div>
          <div className="flex items-center">
            <Switch
              checked={data.generateAudio ?? false}
              onCheckedChange={(value) => onChange({ generateAudio: value })}
              label="生成音频"
            />
          </div>
        </div>
      )}
      {detailsOpen && (
        <div
          id="video-node-details"
          className="grid gap-3 rounded-xl border border-white/[0.08] p-3 sm:grid-cols-2"
        >
          <div>
            <Label htmlFor="video-title">片段标题</Label>
            <Input
              id="video-title"
              value={data.title}
              onChange={(event) => onChange({ title: event.target.value })}
            />
          </div>
          <div>
            <Label>交互弹出时间（秒，留空为片尾）</Label>
            <NumberInput
              value={data.interactionAt}
              onChange={(value) => onChange({ interactionAt: value })}
              placeholder="视频结束时"
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="video-url">视频 URL</Label>
            <Input
              id="video-url"
              value={data.videoUrl ?? ""}
              onChange={(event) => onChange({ videoUrl: event.target.value })}
              placeholder="粘贴已有视频地址，或通过 AI 生成"
            />
          </div>
          {data.firstFrameUrl && !inputs.inputs.some((i) => i.role === "first-frame") && (
            <div className="flex items-center gap-2 text-xs text-white/50">
              已设置起始帧
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onChange({ firstFrameUrl: undefined })}
              >
                清除
              </Button>
            </div>
          )}
          {data.lastFrameUrl && !inputs.inputs.some((i) => i.role === "last-frame") && (
            <div className="flex items-center gap-2 text-xs text-white/50">
              已设置结束帧
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onChange({ lastFrameUrl: undefined })}
              >
                清除
              </Button>
            </div>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1.5 border-t border-white/[0.08] pt-3">
        <div className="w-[164px]">
          <Label htmlFor="video-model" className="sr-only">
            视频模型
          </Label>
          <Select
            id="video-model"
            size="sm"
            className="border-transparent bg-transparent px-2"
            icon={<Film size={14} />}
            value={modelOverride ?? inputs.model}
            disabled={
              modelOverride !== null ||
              inputs.mode === "reference-to-video" ||
              inputs.mode === "first-last-frame" ||
              busy
            }
            onChange={(value) =>
              onChange({ seedanceModel: value as VideoNodeData["seedanceModel"] })
            }
            options={
              modelOverride === undefined
                ? [
                    {
                      value: inputs.model,
                      label: modelConfigError ? "模型配置读取失败" : "读取模型配置…",
                    },
                  ]
                : modelOverride
                  ? [{ value: modelOverride, label: modelOverride }]
                  : [
                      { value: "seedance-1-0-lite", label: "Seedance 1.0 Lite" },
                      { value: "seedance-1-0-pro", label: "Seedance 1.0 Pro" },
                      { value: "seedance-2-0", label: "Seedance 2.0" },
                    ]
            }
          />
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="gap-2 text-xs text-white/65"
          aria-expanded={settingsOpen}
          aria-controls="video-generation-settings"
          onClick={() => setSettingsOpen((value) => !value)}
        >
          <SlidersHorizontal size={14} />
          {data.seedanceAspectRatio ?? "16:9"} · {data.seedanceResolution ?? "480p"} ·{" "}
          {data.seedanceDuration ?? 5}s
        </Button>
        <Tooltip content={data.generateAudio ? "关闭生成音频" : "开启生成音频"}>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="生成音频"
            aria-pressed={data.generateAudio ?? false}
            onClick={() => onChange({ generateAudio: !data.generateAudio })}
          >
            {data.generateAudio ? <Volume2 size={16} /> : <VolumeX size={16} />}
          </Button>
        </Tooltip>
        <Button
          variant="ghost"
          size="sm"
          className="text-xs text-white/45"
          aria-expanded={detailsOpen}
          aria-controls="video-node-details"
          onClick={() => setDetailsOpen((value) => !value)}
        >
          片段属性
        </Button>
        <Tooltip content={busy ? "视频生成中" : "生成视频"}>
          <Button
            variant="primary"
            className="ml-auto h-9 gap-2 rounded-lg"
            aria-label="生成视频"
            disabled={busy}
            onClick={handleSeedanceGenerate}
          >
            {busy ? <Loader2 size={18} className="animate-spin" /> : <ArrowUp size={16} />}
            <span>{busy ? "生成中…" : "生成视频"}</span>
          </Button>
        </Tooltip>
      </div>
    </>
  );
}

// ── TextNodeEditor ──────────────────────────────────────────────────────────────

function TextNodeEditor({
  data,
  nodeId,
  onChange,
}: {
  data: TextNodeData;
  nodeId: string;
  onChange: (patch: Partial<TextNodeData>) => void;
}) {
  return (
    <>
      <div>
        <Label>标题</Label>
        <Input
          value={data.title}
          onChange={(e) => onChange({ title: e.target.value })}
          placeholder="场景文字标题"
        />
      </div>
      <div>
        <Label>内容（场景描述/提示词）</Label>
        <Textarea
          className="min-h-[100px]"
          value={data.content}
          onChange={(e) => onChange({ content: e.target.value })}
          placeholder="输入场景描述、对白或提示词..."
        />
      </div>
      <div>
        <Label>文字类型</Label>
        <Select
          size="sm"
          value={data.role ?? "scene"}
          onChange={(v) => onChange({ role: v as TextNodeData["role"] })}
          options={[
            { value: "scene", label: "场景" },
            { value: "dialogue", label: "对白" },
            { value: "direction", label: "指导" },
            { value: "prompt", label: "提示词" },
          ]}
        />
      </div>
      <TextNodeAssistant nodeId={nodeId} data={data} />
    </>
  );
}

// ── ImageNodeEditor ──────────────────────────────────────────────────────────────

function ImageNodeEditor({
  data,
  nodeId,
  onChange,
}: {
  data: ImageNodeData;
  nodeId: string;
  onChange: (patch: Partial<ImageNodeData>) => void;
}) {
  const jobs = useCanvasJobs((s) => s.jobs);
  const loading = useCanvasJobs((s) => s.loading);
  const generating =
    loading ||
    jobs.some((job) => job.nodeId === nodeId && ["queued", "running"].includes(job.status));
  const canvasNodes = useCanvasStore((s) => s.nodes);
  const canvasEdges = useCanvasStore((s) => s.edges);
  const prompt = resolvePrompt(nodeId, canvasNodes, canvasEdges, data.prompt || "");

  const handleGenerateImage = () => useCanvasJobs.getState().submit([nodeId]);

  return (
    <>
      <div>
        <Label>标题</Label>
        <Input
          value={data.title}
          onChange={(e) => onChange({ title: e.target.value })}
          placeholder="图片节点标题"
        />
      </div>

      <NodeInputsPanel key={nodeId} nodeId={nodeId} />
      <div>
        <Label htmlFor={`image-url-${nodeId}`}>图片地址</Label>
        <Input
          id={`image-url-${nodeId}`}
          value={data.imageUrl ?? ""}
          onChange={(e) => onChange({ imageUrl: e.target.value })}
          placeholder="粘贴图片 URL，或通过下方按钮生成"
        />
      </div>
      <AssetPicker
        title="选择图片"
        types={["image"]}
        onSelect={(asset) =>
          onChange({ imageUrl: asset.url, generationStatus: "done", generationError: undefined })
        }
      >
        <Button size="sm">选择图片或上传</Button>
      </AssetPicker>
      {data.generationError && <Alert tone="error">{data.generationError}</Alert>}
      {/* Image preview */}
      <div>
        <Label>预览</Label>
        {data.imageUrl ? (
          <div
            style={{
              borderRadius: 10,
              overflow: "hidden",
              border: "1px solid rgba(255,255,255,0.08)",
            }}
          >
            <NextImage
              loading="eager"
              unoptimized
              width={320}
              height={120}
              src={data.imageUrl}
              alt={data.title}
              style={{ width: "100%", height: 120, objectFit: "cover" }}
            />
          </div>
        ) : (
          <div
            style={{
              height: 120,
              borderRadius: 10,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "var(--oii-surface, #222224)",
              border: "1px solid rgba(255,255,255,0.08)",
              color: "rgba(255,255,255,0.45)",
              fontSize: 11,
            }}
          >
            暂无图片
          </div>
        )}
      </div>

      <div>
        <Label>Prompt（生成提示词）</Label>
        <Textarea
          className="min-h-[60px]"
          value={data.prompt ?? ""}
          onChange={(e) => onChange({ prompt: e.target.value })}
          placeholder="描述想要生成的图片..."
        />
      </div>

      <div>
        <Label>风格</Label>
        <Select
          size="sm"
          value={data.style ?? "cinematic"}
          onChange={(v) => onChange({ style: v as ImageNodeData["style"] })}
          options={[
            { value: "cinematic", label: "电影感" },
            { value: "anime", label: "动漫" },
            { value: "realistic", label: "写实" },
            { value: "illustration", label: "插画" },
          ]}
        />
      </div>

      <Button
        className="w-full mt-2.5"
        variant="primary"
        disabled={generating || !prompt.trim()}
        onClick={handleGenerateImage}
      >
        {generating ? (
          <>
            <Loader2 size={12} className="animate-spin" />
            生成中…
          </>
        ) : (
          "✦ AI 生成图片"
        )}
      </Button>

      <div>
        <Label>新连线默认用途</Label>
        <Select
          size="sm"
          value={data.seedanceRole ?? ""}
          onChange={(v) =>
            onChange({
              seedanceRole: v === "" ? undefined : (v as ImageNodeData["seedanceRole"]),
            })
          }
          options={[
            { value: "", label: "无" },
            { value: "first_frame", label: "起始帧" },
            { value: "last_frame", label: "结束帧" },
            { value: "reference", label: "参考图" },
          ]}
        />
      </div>
    </>
  );
}

// ── Existing node editors ──────────────────────────────────────────────────────

function ChoiceNodeEditor({
  nodeId,
  data,
  onChange,
}: {
  nodeId: string;
  data: ChoiceNodeData;
  onChange: (patch: Partial<ChoiceNodeData>) => void;
}) {
  const nodes = useCanvasStore((s) => s.nodes),
    edges = useCanvasStore((s) => s.edges);
  const choices = edges.filter((edge) => edge.source === nodeId && !isContextEdge(edge, nodes));
  return (
    <>
      <div>
        <Label>问题</Label>
        <Input
          value={data.question ?? ""}
          onChange={(e) => onChange({ question: e.target.value })}
          placeholder="你会怎么做？"
        />
      </div>
      <div className="space-y-2">
        <Label>观众选项</Label>
        {choices.length ? (
          choices.map((edge, index) => (
            <div key={edge.id} className="space-y-1">
              <Input
                aria-label={`选项 ${index + 1}`}
                value={edge.data?.choiceLabel ?? ""}
                placeholder={String(
                  nodes.find((n) => n.id === edge.target)?.data.title || "继续故事",
                )}
                onChange={(event) =>
                  useCanvasStore
                    .getState()
                    .updateEdge(edge.id, { choiceLabel: event.target.value || undefined })
                }
              />
              <p className="text-xs text-white/45">
                → {String(nodes.find((n) => n.id === edge.target)?.data.title || "后续节点")}
                {index === 0 ? " · 超时默认选项" : ""}
              </p>
            </div>
          ))
        ) : (
          <p className="text-xs text-white/50">从输出端连接后续剧情后，在这里编辑选项。</p>
        )}
      </div>
      <div>
        <Label>超时自动继续（秒，留空=无限等待）</Label>
        <NumberInput
          min={1}
          value={data.timeoutSecs}
          onChange={(v) => onChange({ timeoutSecs: v })}
        />
        <p className="mt-2 text-xs text-white/50">超时后自动选择上方第一项；留空则等待观众选择。</p>
      </div>
    </>
  );
}

function EndingNodeEditor({
  data,
  onChange,
}: {
  data: EndingNodeData;
  onChange: (patch: Partial<EndingNodeData>) => void;
}) {
  return (
    <>
      <div>
        <Label>结局标题</Label>
        <Input
          value={data.title ?? ""}
          onChange={(e) => onChange({ title: e.target.value })}
          placeholder="结局"
        />
      </div>
      <div>
        <Label>结局描述</Label>
        <Textarea
          value={data.description ?? ""}
          onChange={(e) => onChange({ description: e.target.value })}
        />
      </div>
    </>
  );
}

function MergeNodeEditor({
  data,
  onChange,
}: {
  data: MergeNodeData;
  onChange: (patch: Partial<MergeNodeData>) => void;
}) {
  return (
    <div>
      <Label>标签</Label>
      <Input
        value={data.label ?? ""}
        onChange={(e) => onChange({ label: e.target.value })}
        placeholder="汇合"
      />
    </div>
  );
}

function ConditionNodeEditor({
  data,
  onChange,
}: {
  data: ConditionNodeData;
  onChange: (patch: Partial<ConditionNodeData>) => void;
}) {
  return <ConditionRules data={data} onChange={onChange} />;
}

function EdgeDetailPanel({
  isCondition,
  edgeId,
  choiceLabel,
  condition,
  setVariables,
  variableOperations,
  onUpdate,
  onDelete,
}: {
  isCondition: boolean;
  edgeId: string;
  choiceLabel: string;
  condition: string;
  setVariables: import("@/lib/story/types").StoryVariables;
  variableOperations: import("@/lib/story/types").VariableOperation[];
  onUpdate: (patch: import("@/lib/story/types").StoryEdgeData) => void;
  onDelete: () => void;
}) {
  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between gap-2 px-4 py-3 sticky top-0 z-10 border-b border-white/[0.07] bg-oii-surface">
        <span className="min-w-0 truncate text-sm font-semibold text-white/85">边属性</span>
        <ConfirmDialog title="删除此连线？" onConfirm={onDelete}>
          <Button variant="danger" size="icon-sm">
            <Trash2 size={14} />
          </Button>
        </ConfirmDialog>
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
        <div className="text-xs font-mono truncate" style={{ color: "rgba(255,255,255,0.2)" }}>
          {edgeId}
        </div>
        <div>
          <Label>选择标签（展示给观众）</Label>
          <Input
            value={choiceLabel}
            onChange={(e) => onUpdate({ choiceLabel: e.target.value })}
            placeholder="例如：打开信件"
          />
        </div>
        {isCondition && (
          <div>
            <Label>条件结果</Label>
            <Select
              ariaLabel="条件结果"
              value={condition}
              onChange={(value) => onUpdate({ condition: value })}
              options={[
                { value: "", label: "不使用条件" },
                { value: "true", label: "满足条件" },
                { value: "false", label: "不满足条件" },
              ]}
            />
          </div>
        )}
        <VariableEditor
          label="经过这条路线后设置变量"
          value={setVariables}
          onSave={(value) => onUpdate({ setVariables: value })}
        />
        <VariableOperations
          value={variableOperations}
          onChange={(value) => onUpdate({ variableOperations: value })}
        />
      </div>
    </div>
  );
}

function ContextEdgeEditor({ edge }: { edge: StoryFlowEdge }) {
  const nodes = useCanvasStore((s) => s.nodes);
  const updateEdge = useCanvasStore((s) => s.updateEdge);
  const deleteEdge = useCanvasStore((s) => s.deleteEdge);
  const [error, setError] = useState("");
  const source = nodes.find((n) => n.id === edge.source);
  const target = nodes.find((n) => n.id === edge.target);
  const role = inputRole(edge, nodes);
  return (
    <div className="space-y-5 px-5 py-5">
      <h3 className="text-sm font-semibold text-white/85">素材输入连线</h3>
      <p className="text-xs leading-relaxed text-white/60">
        {String(source?.data.title || source?.type)} → {String(target?.data.title || target?.type)}
      </p>
      <Label htmlFor="connection-role">输入用途</Label>
      {source?.type === "image" ? (
        <Select
          id="connection-role"
          value={role}
          options={["reference-image", "first-frame", "last-frame"].map((value) => ({
            value,
            label: INPUT_LABELS[value as InputRole],
          }))}
          onChange={(value) => {
            if (!updateEdge(edge.id, { inputRole: value as InputRole }))
              setError("该用途已有图片输入。");
            else setError("");
          }}
        />
      ) : (
        <Badge>{INPUT_LABELS[role]}</Badge>
      )}
      <p className="text-xs leading-relaxed text-white/45">
        生成时读取上游素材的最新内容，不作为观众播放路线。
      </p>
      {error && (
        <Alert tone="error" className="text-xs">
          {error}
        </Alert>
      )}
      <Button variant="danger" onClick={() => deleteEdge(edge.id)}>
        <Trash2 size={14} />
        移除输入连线
      </Button>
    </div>
  );
}
