"use client";
import { shotWorkspaceGraph } from "@/lib/canvas/shot-workspace";
import { GenerationErrorNotice } from "./GenerationErrorNotice";
import * as Dialog from "@radix-ui/react-alert-dialog";
import { useEffect, useState } from "react";
import { useCanvasStore } from "@/stores/canvas-store";
import { useCanvasJobs, type CanvasVersion } from "@/stores/canvas-jobs-store";
import { isStale } from "@/lib/canvas/workflow";
import { Button, Alert, Badge, Select } from "@/components/ui";
const labels = {
  queued: "等待上游",
  running: "生成中",
  succeeded: "已完成",
  failed: "失败",
  cancelled: "已取消",
};
export function GenerationTasks({ inline = false }: { inline?: boolean } = {}) {
  // Recompute staleness when connections change; toProject() reads the current edges.
  useCanvasStore((s) => s.edges);
  const projectId = useCanvasStore((s) => s.projectId),
    nodes = useCanvasStore((s) => s.nodes);
  const {
    jobs: allJobs,
    error,
    refresh,
    submit,
    cancel,
    resume,
    loading,
    workerOnline,
    pending,
    confirm,
  } = useCanvasJobs();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let stopped = false;
    useCanvasJobs.setState({ jobs: [], error: "", pending: null });
    const tick = async () => {
      await refresh(false);
      if (
        !stopped &&
        !useCanvasJobs.getState().workerOnline &&
        useCanvasJobs
          .getState()
          .jobs.some((j) => ["running", "queued"].includes(j.status) && !j.waitingForQuery)
      )
        await refresh(true);
      if (!stopped) timer = setTimeout(tick, 3000);
    };
    let timer: ReturnType<typeof setTimeout>;
    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [projectId, refresh]);
  const shotId = useCanvasStore((s) => s.activeShotId);
  useCanvasStore((s) => s.shotWorkspaces);
  const project = useCanvasStore.getState().toProject();
  const visible =
    project && shotId && !inline
      ? new Set(shotWorkspaceGraph(project, shotId).nodes.map((n) => n.id))
      : null;
  const jobs = allJobs.filter((j) => !visible || visible.has(j.nodeId));
  const stale = project
    ? nodes.filter(
        (n) =>
          (!visible || visible.has(n.id)) &&
          ["image", "video"].includes(n.type!) &&
          isStale(project, n),
      )
    : [];
  const active = jobs.filter((j) => ["queued", "running"].includes(j.status));
  return (
    <>
      <div
        className={
          inline
            ? "relative w-fit max-w-full shrink-0 text-xs"
            : "absolute left-3 top-40 sm:left-auto sm:right-4 sm:top-20 z-40 max-w-[320px] rounded-lg border border-white/[0.08] bg-oii-surface p-1 text-xs shadow-lg"
        }
        onPointerDown={(e) => e.stopPropagation()}
      >
        <Button variant="ghost" size="sm" aria-expanded={open} onClick={() => setOpen(!open)}>
          生成任务 {active.length > 0 ? `· ${active.length} 进行中` : ""}
          {stale.length > 0 ? ` · ${stale.length} 已过期` : ""}
        </Button>
        {error && <GenerationErrorNotice message={error} />}
        {open && (
          <div
            className={
              inline
                ? "absolute right-0 top-full z-50 mt-2 max-h-[50vh] w-80 max-w-[calc(100vw-32px)] space-y-3 overflow-y-auto rounded-xl border border-white/10 bg-oii-surface p-3 shadow-xl"
                : "max-h-[50vh] space-y-3 overflow-y-auto p-2"
            }
          >
            <p className={workerOnline ? "text-green-300/80" : "text-amber-300/80"}>
              {workerOnline
                ? "后台任务服务在线"
                : "后台离线 · 当前由此页面推进队列，关闭页面后暂停"}
            </p>
            <p className="text-white/45">
              按依赖顺序生成；使用配置的模型服务，会产生费用。取消后不再应用结果，外部已执行任务可能仍计费。
            </p>
            <Button
              size="sm"
              disabled={loading || !stale.length || !!active.length}
              onClick={() => submit(stale.map((n) => n.id))}
            >
              重新生成过期素材（{stale.length}）
            </Button>
            {!jobs.length && <p className="text-white/45">选择图片或视频节点开始生成。</p>}
            {[...jobs].reverse().map((j) => (
              <div key={j.id} className="space-y-1 border-t border-white/10 pt-2">
                <div className="flex items-center gap-2">
                  <button
                    className="truncate text-left text-white/80"
                    onClick={() => useCanvasStore.getState().selectNode(j.nodeId)}
                  >
                    {String(nodes.find((n) => n.id === j.nodeId)?.data.title || j.nodeId)}
                  </button>
                  <Badge>{j.waitingForQuery ? "已提交 · 待查询" : labels[j.status]}</Badge>
                </div>
                {j.externalRequestId && (
                  <p className="break-all text-white/50">外部任务：{j.externalRequestId}</p>
                )}
                {j.error && <GenerationErrorNotice message={j.error} />}
                {["queued", "running"].includes(j.status) ? (
                  <Button size="sm" variant="ghost" onClick={() => cancel(j.id)}>
                    取消
                  </Button>
                ) : j.status === "failed" || j.status === "cancelled" ? (
                  <>
                    {j.resumable && (
                      <Button size="sm" variant="ghost" onClick={() => resume(j.id)}>
                        恢复查询（不重提）
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={loading}
                      onClick={() => submit([j.nodeId])}
                    >
                      重新提交
                    </Button>
                  </>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
      {pending && (
        <Dialog.Root
          open
          onOpenChange={(value) => {
            if (!value && !loading) useCanvasJobs.setState({ pending: null });
          }}
        >
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-[400] bg-black/60" />
            <Dialog.Content
              className="fixed left-1/2 top-1/2 z-[401] max-h-[80vh] w-[420px] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 space-y-4 overflow-auto rounded-xl border border-white/10 bg-[#222224] p-5 shadow-xl"
              aria-describedby={undefined}
            >
              <Dialog.Title className="font-semibold">确认生成任务</Dialog.Title>
              <p className="text-sm text-white/65">
                本次新增生成任务（含需生成的上游素材）：{pending.quote.images} 张图片、
                {pending.quote.videos} 段视频，共 {pending.quote.total}{" "}
                项。已有图片会作为输入复用，不计入新增图片任务。
              </p>
              <p className="text-xs text-white/45">
                单批上限 {pending.quote.maxBatch} 项。
                {pending.quote.estimatedCny === null
                  ? "尚未配置估算单价，费用以服务商实际结算为准。"
                  : `按配置单价估算 ¥${pending.quote.estimatedCny.toFixed(2)}，实际费用以服务商为准。`}
              </p>
              <ul className="space-y-1 text-xs text-white/60">
                {pending.quote.nodeIds.map((id) => (
                  <li key={id}>
                    {String(pending.project.nodes.find((n) => n.id === id)?.data.title || id)}
                  </li>
                ))}
              </ul>
              {error && <GenerationErrorNotice message={error} />}
              <div className="flex justify-end gap-2">
                <Button
                  variant="secondary"
                  disabled={loading}
                  onClick={() => useCanvasJobs.setState({ pending: null })}
                >
                  取消
                </Button>
                <Button disabled={loading} onClick={() => confirm()}>
                  {loading ? "提交中…" : "确认生成"}
                </Button>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      )}
    </>
  );
}
export function NodeGenerationStatus({ nodeId }: { nodeId: string }) {
  // Recompute staleness when connections change; toProject() reads the current edges.
  useCanvasStore((s) => s.edges);
  const nodes = useCanvasStore((s) => s.nodes),
    { jobs, submit, loading } = useCanvasJobs();
  const node = nodes.find((n) => n.id === nodeId),
    project = useCanvasStore.getState().toProject();
  if (!node || !project) return null;
  const stale = isStale(project, node),
    versions = (node.data.generationVersions ?? []) as CanvasVersion[];
  const nodeJobs = jobs.filter((j) => j.nodeId === nodeId),
    latest = nodeJobs.at(-1);
  const running = nodeJobs.some((j) => ["queued", "running"].includes(j.status));
  return (
    <div className="space-y-2">
      {stale && (
        <Alert tone="warning">
          输入或剧情上下文已修改，当前素材已过期。
          <Button
            size="sm"
            variant="ghost"
            disabled={loading || running}
            onClick={() => submit([nodeId])}
          >
            重新生成
          </Button>
        </Alert>
      )}
      {latest?.status === "failed" && !running && (
        <>
          <GenerationErrorNotice message={latest.error || "生成失败"} />
          <Button size="sm" variant="ghost" disabled={loading} onClick={() => submit([nodeId])}>
            重新提交
          </Button>
        </>
      )}
      {latest?.status === "succeeded" && node.data.generationJobId !== latest.id && (
        <p className="text-xs text-amber-300/80">
          新结果已存入历史版本。当前输入或素材选择有变化，因此没有自动替换。
        </p>
      )}
      {running && <p className="text-xs text-brand-accent">任务已保存，刷新后可继续查看。</p>}
      {versions.length > 0 && (
        <Select
          ariaLabel="素材历史版本"
          size="sm"
          value={String(node.data.generationJobId ?? "")}
          options={[
            { value: "", label: "选择历史版本" },
            ...versions.map((v, i) => ({
              value: v.id,
              label: `版本 ${i + 1} · ${new Date(v.createdAt).toLocaleString()}`,
            })),
          ]}
          onChange={(id) => {
            const v = versions.find((v) => v.id === id);
            if (v)
              useCanvasStore.getState().updateNodeData(nodeId, {
                ...(node.type === "video"
                  ? { segments: undefined, audioUrl: undefined, clipEnd: undefined }
                  : {}),
                [node.type === "image" ? "imageUrl" : "videoUrl"]: v.url,
                generationFingerprint: v.fingerprint,
                generationJobId: v.id,
                generationStatus: "done",
              });
          }}
        />
      )}
    </div>
  );
}
