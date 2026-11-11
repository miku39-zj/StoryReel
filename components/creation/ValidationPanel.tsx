/**
 * 06 剧情校验与发布 — 检查分支是否完整、资源是否就绪、所有路线能否正常播放
 */
"use client";

import { useCreationStore } from "@/stores/creation-store";
import { useCanvasStore } from "@/stores/canvas-store";
import { validateProject } from "@/lib/story/graph";
import { isLinearWork } from "@/lib/story/creation-brief";
import { ShieldCheck, CheckCircle, AlertTriangle, XCircle, Share2, Download, Loader2 } from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { Button, Card, Badge, Alert, EmptyState, Input, Label, Progress } from "@/components/ui";
import { StorySummary, CreationStepLayout } from "./CreationStepLayout";
import { saveProject } from "@/lib/story/project-cache";
import { PublicationHistory } from "./PublicationHistory";

export function ValidationPanel() {
  const storyOutline = useCreationStore((s) => s.storyOutline);
  const brief = useCreationStore((s) => s.brief);
  const validationResult = useCreationStore((s) => s.validationResult);
  const setValidationResult = useCreationStore((s) => s.setValidationResult);
  const setStepStatus = useCreationStore((s) => s.setStepStatus);
  const shotWorkspaces = useCanvasStore((s) => s.shotWorkspaces);
  const nodes = useCanvasStore((s) => s.nodes);
  const edges = useCanvasStore((s) => s.edges);
  const startNodeId = useCanvasStore((s) => s.startNodeId);
  const projectName = useCanvasStore((s) => s.projectName);
  const projectId = useCanvasStore((s) => s.projectId);

  const isLinear = isLinearWork(brief);

  const [running, setRunning] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [shareLink, setShareLink] = useState<string | null>(null);

  // Export MP4 state
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportReady, setExportReady] = useState<{ ready: number; total: number } | null>(null);

  useEffect(() => {
    setValidationResult(null);
    setShareLink(null);
    setPublishError(null);
    setExportError(null);
    setExportReady(null);
  }, [nodes, edges, startNodeId, projectName, projectId, setValidationResult, shotWorkspaces]);

  // Check export readiness whenever projectId changes or after validation.
  const checkExportReady = useCallback(async () => {
    if (!projectId) return;
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/export`);
      if (!res.ok) return;
      const data = await res.json() as { ready: number; total: number; canExport: boolean };
      setExportReady({ ready: data.ready, total: data.total });
    } catch {
      // Ignore — not critical
    }
  }, [projectId]);

  useEffect(() => { void checkExportReady(); }, [checkExportReady]);

  const handleValidate = () => {
    const project = useCanvasStore.getState().toProject();
    if (!project) return;
    setRunning(true);
    const result = validateProject(project);
    setValidationResult(result);
    setStepStatus("validate", result.valid ? "done" : "error");
    setRunning(false);
    void checkExportReady();
  };

  const handlePublish = async () => {
    const project = useCanvasStore.getState().toProject();
    if (!project) return;
    const result = validateProject(project);
    setValidationResult(result);
    if (!result.valid) return;
    setPublishing(true);
    setPublishError(null);
    try {
      const saved = await saveProject(project);
      const response = await fetch(`/api/projects/${encodeURIComponent(project.id)}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(saved),
      });
      const data = await response.json();
      if (!response.ok) {
        if (data.validation) setValidationResult(data.validation);
        throw new Error(data.error || "发布失败，请重试");
      }
      setShareLink(new URL(data.path, window.location.origin).href);
    } catch (error) {
      setPublishError((error as Error).message);
    } finally {
      setPublishing(false);
    }
  };

  const handleExportMp4 = async () => {
    if (!projectId) return;
    setExporting(true);
    setExportError(null);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/export`, {
        method: "POST",
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || "导出失败，请重试");
      }
      // Stream file download
      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") ?? "";
      const nameMatch = disposition.match(/filename\*=UTF-8''(.+)/i);
      const filename = nameMatch ? decodeURIComponent(nameMatch[1]) : `${projectName || projectId}.mp4`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (error) {
      setExportError((error as Error).message);
    } finally {
      setExporting(false);
    }
  };

  const page = { title: "校验与发布" };

  return (
    <CreationStepLayout
      {...page}
      action={
        <Button variant="primary" onClick={handleValidate} disabled={running}>
          <ShieldCheck size={16} className={running ? "animate-pulse" : undefined} />
          {running ? "校验中…" : validationResult ? "重新校验" : "开始校验"}
        </Button>
      }
    >
      <StorySummary title={projectName || storyOutline?.title || "未命名项目"}>
        <Badge>{nodes.length} 个节点</Badge>
        <Badge>{edges.length} 条连接</Badge>
      </StorySummary>
      {!validationResult && (
        <Card>
          <EmptyState icon={<ShieldCheck size={24} />} title="尚未校验" />
        </Card>
      )}
      {publishError && <Alert tone="error">{publishError}</Alert>}
      {running && <Alert>正在检查剧情结构、分支路线与素材状态…</Alert>}
      {projectId && (
        <PublicationHistory
          projectId={projectId}
          refreshKey={shareLink}
          onRevoke={(id) => {
            if (shareLink?.endsWith(`/player/${id}`)) setShareLink(null);
          }}
        />
      )}
      {validationResult && (
        <>
          <Alert
            tone={validationResult.valid ? "success" : "error"}
            className="flex items-start gap-3"
          >
            {validationResult.valid ? (
              <CheckCircle size={20} className="mt-0.5 shrink-0" />
            ) : (
              <XCircle size={20} className="mt-0.5 shrink-0" />
            )}
            <div>
              <h2 className="font-semibold">
                {validationResult.valid ? "校验通过，可以发布" : "校验未通过"}
              </h2>
            </div>
          </Alert>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Metric
              label="视频素材就绪"
              value={`${validationResult.assetsReady} / ${validationResult.assetsTotal}`}
              ok={validationResult.assetsReady === validationResult.assetsTotal}
            />
            <Metric
              label="所有路线到达结局"
              value={validationResult.allPathsReachEnding ? "全部可达" : "存在未完成路线"}
              ok={validationResult.allPathsReachEnding}
            />
          </div>
          {validationResult.errors.length > 0 && (
            <Alert tone="error">
              <h2 className="mb-3 flex items-center gap-2 font-semibold">
                <XCircle size={16} />
                需要修复 · {validationResult.errors.length}
              </h2>
              <ul className="space-y-2 pl-5 text-xs list-disc">
                {validationResult.errors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </Alert>
          )}
          {validationResult.warnings.length > 0 && (
            <Alert tone="warning">
              <h2 className="mb-3 flex items-center gap-2 font-semibold">
                <AlertTriangle size={16} />
                建议检查 · {validationResult.warnings.length}
              </h2>
              <ul className="space-y-2 pl-5 text-xs list-disc">
                {validationResult.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </Alert>
          )}
          <Card className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-white/90">
                  {isLinear ? "导出作品" : "发布作品"}
                </h2>
              </div>
              <div className="flex flex-wrap gap-2">
                {/* Linear works: export MP4 */}
                {isLinear && (
                  <Button
                    variant="primary"
                    onClick={() => void handleExportMp4()}
                    disabled={exporting || (exportReady !== null && exportReady.ready < exportReady.total)}
                  >
                    {exporting ? (
                      <Loader2 size={15} className="animate-spin" />
                    ) : (
                      <Download size={15} />
                    )}
                    {exporting ? "导出中…" : "下载 MP4"}
                  </Button>
                )}
                {/* Interactive works: publish link */}
                {!isLinear && !shareLink && (
                  <Button
                    variant="primary"
                    onClick={handlePublish}
                    disabled={!validationResult.valid || running || publishing}
                  >
                    <Share2 size={15} />
                    {publishing ? "发布中…" : "发布互动视频"}
                  </Button>
                )}
              </div>
            </div>
            {/* Export readiness bar for linear projects */}
            {isLinear && exportReady !== null && exportReady.total > 0 && (
              <div className="mt-4 space-y-1.5">
                <div className="flex justify-between text-xs text-white/50">
                  <span>视频就绪</span>
                  <span>{exportReady.ready} / {exportReady.total}</span>
                </div>
                <Progress value={exportReady.ready} max={exportReady.total} label="视频就绪进度" />
                {exportReady.ready < exportReady.total && (
                  <p className="text-xs text-amber-300/80">请先在「视频生成」步骤完成所有镜头，再导出。</p>
                )}
              </div>
            )}
            {exportError && <Alert tone="error" className="mt-3">{exportError}</Alert>}
            {shareLink && (
              <div className="mt-5 border-t border-white/[0.08] pt-5">
                <Label htmlFor="story-share-link">分享链接</Label>
                <a
                  href={shareLink}
                  target="_blank"
                  rel="noreferrer"
                  className="mb-3 inline-block text-sm text-brand-accent underline"
                >
                  打开已发布作品 ↗
                </a>
                <div className="flex flex-col gap-3 sm:flex-row">
                  <Input
                    id="story-share-link"
                    readOnly
                    value={shareLink}
                    className="min-w-0 flex-1"
                    onFocus={(e) => e.currentTarget.select()}
                  />
                  <Button
                    variant="outline"
                    onClick={() => navigator.clipboard?.writeText(shareLink)}
                  >
                    复制链接
                  </Button>
                </div>
              </div>
            )}
          </Card>
        </>
      )}
    </CreationStepLayout>
  );
}

function Metric({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <Card className="flex flex-wrap items-center justify-between gap-3 p-5">
      <div>
        <p className="text-xs text-white/50">{label}</p>
        <p className="mt-2 text-lg font-semibold text-white/90">{value}</p>
      </div>
      <Badge
        className={
          ok ? "border-emerald-400/20 text-emerald-300" : "border-amber-400/20 text-amber-200"
        }
      >
        {ok ? (
          <CheckCircle size={13} className="mr-1.5" />
        ) : (
          <AlertTriangle size={13} className="mr-1.5" />
        )}
        {ok ? "已就绪" : "待完善"}
      </Badge>
    </Card>
  );
}
