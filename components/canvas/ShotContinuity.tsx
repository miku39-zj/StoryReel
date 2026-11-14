"use client";

import { useReactFlow } from "@xyflow/react";
import { useState } from "react";
import { Button, Select } from "@/components/ui";
import { useCanvasStore } from "@/stores/canvas-store";
import { mainVideoNode } from "@/lib/canvas/shot-workspace";
import { precedingVideos, videoOutpoint } from "@/lib/canvas/shot-continuity";
import { inputRole, isContextEdge, resolveVideoInputs } from "@/lib/story/connections";

async function uploadOutpoint(url: string, end?: number): Promise<string> {
  const video = document.createElement("video");
  video.crossOrigin = "anonymous";
  video.muted = true;
  const waitFor = (event: "loadeddata" | "seeked") =>
    new Promise<void>((resolve, reject) => {
      const signal = AbortSignal.timeout(20000);
      video.addEventListener(event, () => resolve(), { once: true, signal });
      video.addEventListener("error", () => reject(new Error("无法读取前置视频")), {
        once: true,
        signal,
      });
      signal.addEventListener("abort", () => reject(new Error("读取前置视频超时")), { once: true });
    });
  try {
    const loaded = waitFor("loadeddata");
    video.src = url;
    await loaded;
    const out = Math.min(end ?? video.duration, video.duration);
    if (!Number.isFinite(out) || !video.videoWidth) throw new Error("无法读取视频时长或画面");
    const time = Math.max(0, out - 0.001);
    if (video.currentTime !== time) {
      const seeked = waitFor("seeked");
      video.currentTime = time;
      await seeked;
    }
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法截取出点帧");
    context.drawImage(video, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("无法导出出点帧");
    const form = new FormData();
    form.append("file", blob, "前置镜头出点.png");
    const response = await fetch("/api/assets", { method: "POST", body: form });
    const result = await response.json();
    if (!response.ok || typeof result.url !== "string")
      throw new Error(result.error || "无法保存出点帧");
    return result.url;
  } finally {
    video.removeAttribute("src");
    video.load();
  }
}

export function ShotContinuity({ shotId }: { shotId: string }) {
  const [sourceId, setSourceId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const flow = useReactFlow();
  const store = useCanvasStore.getState();
  const project = store.toProject();
  const video = project && mainVideoNode(project, shotId);
  if (!project || !video) return null;
  const routeNode = project.nodes.find(
    (node) => node.data.productionShotId === shotId && node.type === "video",
  );
  const candidates = precedingVideos(project, routeNode?.id ?? video.id);
  const source = candidates.find((item) => item.id === sourceId) ?? candidates[0];
  const outpoint = source ? videoOutpoint(source.data) : { url: undefined, end: undefined };
  const currentFrame = project.nodes.find((node) => node.id === `shot_outpoint:${shotId}`);
  const currentSource = candidates.find((item) => item.id === currentFrame?.data.outpointSourceId);
  const currentOutpoint = currentSource && videoOutpoint(currentSource.data);
  if (!source && !currentFrame) return null;
  const changed =
    !!currentFrame &&
    (currentOutpoint?.url !== currentFrame.data.outpointVideoUrl ||
      currentOutpoint?.end !== currentFrame.data.outpointEnd);
  const restoreFrame = () => {
    if (!currentFrame) return;
    const original = project.nodes.find((node) => node.id === `shot_frame:${shotId}`);
    store.applyGraph(
      project.nodes.filter((node) => node.id !== currentFrame.id),
      [
        ...project.edges.filter(
          (edge) => edge.source !== currentFrame.id && edge.target !== currentFrame.id,
        ),
        ...(original
          ? [
              {
                id: `shot_input:${original.id}:${video.id}`,
                source: original.id,
                target: video.id,
                data: { kind: "context" as const, inputRole: "first-frame" as const },
              },
            ]
          : []),
      ],
    );
  };
  const inputMode = resolveVideoInputs(video.id, project.nodes, project.edges).mode;
  const attach = async () => {
    if (!source || !outpoint.url) return;
    setError("");
    setBusy(true);
    try {
      const url = await uploadOutpoint(outpoint.url, outpoint.end);
      const latest = useCanvasStore.getState();
      const draft = latest.toProject();
      if (!draft || draft.id !== project.id || mainVideoNode(draft, shotId)?.id !== video.id)
        throw new Error("镜头已变更，请重新选择");
      const origin = precedingVideos(draft, routeNode?.id ?? video.id).find(
        (item) => item.id === source.id,
      );
      const activeOutpoint = origin && videoOutpoint(origin.data);
      if (activeOutpoint?.url !== outpoint.url || activeOutpoint?.end !== outpoint.end)
        throw new Error("前置视频已变更，请重新截取");
      const id = `shot_outpoint:${shotId}`;
      const edges = draft.edges.filter(
        (edge) =>
          !(
            edge.target === video.id &&
            isContextEdge(edge, draft.nodes) &&
            inputRole(edge, draft.nodes) === "first-frame"
          ),
      );
      latest.applyGraph(
        [
          ...draft.nodes.filter((node) => node.id !== id),
          {
            id,
            type: "image",
            position: currentFrame?.position ?? { x: 340, y: -220 },
            data: {
              nodeType: "image",
              title: "前置视频出点帧",
              imageUrl: url,
              canvasShotId: shotId,
              outpointSourceId: source.id,
              outpointVideoUrl: outpoint.url,
              outpointEnd: outpoint.end,
            },
          },
        ],
        [
          ...edges,
          {
            id: `outpoint:${shotId}`,
            source: id,
            target: video.id,
            data: { kind: "context", inputRole: "first-frame" },
          },
        ],
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "无法使用前置出点帧");
    } finally {
      setBusy(false);
    }
  };
  return (
    <details className="relative text-xs text-white/70">
      <summary className="cursor-pointer whitespace-nowrap px-2 py-1.5">
        镜头承接{changed && " · 待复核"}
      </summary>
      <div className="absolute right-0 top-full mt-2 w-60 space-y-2 rounded-lg border border-white/10 bg-oii-surface p-3">
        <Select
          ariaLabel="前置播放镜头"
          value={source?.id ?? ""}
          onChange={setSourceId}
          options={candidates.map((item) => ({
            value: item.id,
            label: item.choiceLabel ? `${item.data.title} · ${item.choiceLabel}` : item.data.title,
          }))}
        />
        <Button
          size="sm"
          disabled={busy || !outpoint.url || inputMode === "reference-to-video"}
          onClick={() => void attach()}
        >
          {busy ? "正在截取…" : "取出点作为首帧"}
        </Button>
        {source && (
          <Button
            size="sm"
            onClick={() => {
              store.saveShotViewport(flow.getViewport());
              store.setActiveShot(null);
              if (source.choiceEdgeId) store.selectEdge(source.choiceEdgeId);
              else store.selectNode(source.id);
            }}
          >
            返回前置路线
          </Button>
        )}
        {currentFrame ? (
          <Button
            size="sm"
            disabled={busy || inputMode === "reference-to-video"}
            onClick={restoreFrame}
          >
            切景，恢复独立首帧
          </Button>
        ) : (
          <p>切景时可保留本镜头的独立首帧。</p>
        )}
        {changed && <p className="text-amber-300">前置视频或剪辑出点已变更。</p>}
        {error && (
          <p role="alert" className="text-red-300">
            {error}
          </p>
        )}
      </div>
    </details>
  );
}
