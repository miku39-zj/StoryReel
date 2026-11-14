"use client";

import { segmentedGroupClassName, segmentedItemClassName } from "@/components/ui/segmented-styles";
import { ProjectRenameDialog } from "@/components/editor/ProjectRenameDialog";
import { ProjectHistory } from "@/components/editor/ProjectHistory";
import { useState, useEffect } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useProjectPersistence } from "@/components/editor/useProjectPersistence";
import { ReactFlowProvider } from "@xyflow/react";
import { ArrowLeft, Clapperboard, Pencil } from "lucide-react";
import { useCanvasStore } from "@/stores/canvas-store";
import { playbackProject } from "@/lib/story/graph";
import { usePlayerStore } from "@/stores/player-store";
import { AICreationPipeline } from "@/components/creation/AICreationPipeline";
import { CanvasWorkspace } from "@/components/editor/CanvasWorkspace";
import { PreviewWorkspace } from "@/components/editor/PreviewWorkspace";
import { Button, Tooltip } from "@/components/ui";
import { useCreationStore } from "@/stores/creation-store";
import { editorHash, readEditorLocation, type Workspace } from "@/lib/editor/location";

const WORKSPACE_TABS: Array<{ id: Workspace; label: string }> = [
  { id: "creation", label: "创作" },
  { id: "canvas", label: "画布" },
  { id: "preview", label: "预览" },
];

export default function EditorPage() {
  const params = useParams<{ projectId: string }>();
  const { ready, error, status, notice, flush, recover } = useProjectPersistence(params.projectId);
  const shotWorkspaces = useCanvasStore((s) => s.shotWorkspaces);
  const [workspace, setWorkspace] = useState<Workspace>("canvas");
  const [locationProjectId, setLocationProjectId] = useState<string | null>(null);
  const activeStep = useCreationStore((s) => s.activeStep);
  const projectName = useCanvasStore((s) => s.projectName);
  const cacheError = useCanvasStore((s) => s.cacheError);

  useEffect(() => {
    if (!ready) return;
    const restoreLocation = () => {
      const location = readEditorLocation(window.location.hash);
      if (location.step) useCreationStore.getState().setActiveStep(location.step);
      setWorkspace(location.workspace);
      setLocationProjectId(params.projectId);
    };
    restoreLocation();
    window.addEventListener("hashchange", restoreLocation);
    return () => window.removeEventListener("hashchange", restoreLocation);
  }, [ready, params.projectId]);

  useEffect(() => {
    if (!ready || locationProjectId !== params.projectId) return;
    const hash = editorHash(workspace, activeStep);
    if (window.location.hash !== hash) {
      window.history.replaceState(
        window.history.state,
        "",
        `${window.location.pathname}${window.location.search}${hash}`,
      );
    }
  }, [ready, locationProjectId, params.projectId, workspace, activeStep]);

  useEffect(() => {
    if (workspace !== "preview" || !ready) return;
    const { nodes, edges, startNodeId, initialVariables } = useCanvasStore.getState();
    if (startNodeId && nodes.some((n) => n.id === startNodeId)) {
      const draft = useCanvasStore.getState().toProject();
      const playable = draft ? playbackProject(draft) : { nodes, edges };
      usePlayerStore.getState().init(playable.nodes, playable.edges, startNodeId, initialVariables);
    }
    return () => usePlayerStore.getState().destroy();
  }, [workspace, ready, shotWorkspaces]);

  const openPublish = () => {
    useCreationStore.getState().setActiveStep("validate");
    setWorkspace("creation");
  };

  if (!ready || locationProjectId !== params.projectId || error)
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-4 bg-[#101012] text-white">
        <p role={error ? "alert" : "status"}>{error || "正在加载项目…"}</p>
        {error && (
          <Button asChild>
            <Link href="/">返回工作台</Link>
          </Button>
        )}
      </div>
    );

  return (
    <div className="relative flex h-dvh min-w-0 flex-col overflow-hidden bg-[#101012] text-white">
      <header
        className={`z-30 grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3 py-1.5 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:px-4 ${workspace === "canvas" ? "pointer-events-none absolute inset-x-0 top-0" : "border-b border-white/[0.08] bg-[#141416]"}`}
      >
        <div
          className={`pointer-events-auto flex w-fit max-w-full min-w-0 items-center gap-2 ${workspace === "canvas" ? "rounded-xl border border-white/[0.08] bg-oii-surface py-1 pl-1 pr-4 shadow-lg" : ""}`}
        >
          <Tooltip content="返回工作台">
            <Button asChild variant="ghost" size="icon" aria-label="返回工作台">
              <Link href="/">
                <ArrowLeft size={17} />
              </Link>
            </Button>
          </Tooltip>
          <span className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-accent/15 text-brand-accent sm:flex">
            <Clapperboard size={17} />
          </span>
          <ProjectRenameDialog
            name={projectName}
            onRename={async (name) => {
              useCanvasStore.getState().setProjectName(name);
              await flush();
            }}
          >
            <button
              className="group flex min-w-0 items-center gap-2 rounded px-1 py-1 text-sm font-semibold text-white/85 hover:text-white focus-visible:outline focus-visible:outline-brand-accent"
              aria-label={`重命名 ${projectName}`}
              title="点击重命名项目"
            >
              <span className="truncate">{projectName || "未命名项目"}</span>
              <Pencil size={13} className="shrink-0 text-white/40 group-hover:text-brand-accent" />
            </button>
          </ProjectRenameDialog>
        </div>
        <nav
          aria-label="工作空间"
          className={`${segmentedGroupClassName} pointer-events-auto col-span-2 row-start-2 justify-self-center sm:col-span-1 sm:row-start-1 sm:col-start-2`}
        >
          {WORKSPACE_TABS.map(({ id, label }) => (
            <Button
              key={id}
              variant="ghost"
              onClick={() => setWorkspace(id)}
              aria-pressed={workspace === id}
              className={segmentedItemClassName(workspace === id, "brand")}
            >
              {label}
            </Button>
          ))}
        </nav>
        <div className="pointer-events-auto col-start-2 row-start-1 flex items-center justify-end gap-2 sm:col-start-3">
          <span
            role="status"
            className="max-w-28 truncate text-xs text-white/60 sm:max-w-40"
            title={status}
          >
            {status}
          </span>
          {status.includes("其他窗口更新") && (
            <Button variant="secondary" onClick={() => void recover()}>
              备份并重新加载
            </Button>
          )}
          <ProjectHistory flush={flush} />
          <Button
            variant="secondary"
            onClick={() => {
              void flush().catch(() => {});
            }}
          >
            保存
          </Button>
          <Button variant="primary" onClick={openPublish}>
            发布
          </Button>
        </div>
      </header>
      {cacheError && (
        <p
          role="alert"
          className="absolute inset-x-3 top-32 z-50 rounded-lg bg-red-950 px-4 py-2 text-xs text-red-100"
        >
          {cacheError}
        </p>
      )}
      {notice && (
        <p
          role="status"
          className="absolute inset-x-3 top-40 z-50 rounded-lg bg-oii-surface px-4 py-2 text-xs text-white/80"
        >
          {notice}
        </p>
      )}
      <main
        className={`min-h-0 min-w-0 flex-1 ${workspace === "canvas" ? "absolute inset-0" : ""}`}
      >
        {workspace === "creation" && (
          <AICreationPipeline
            onOpenShot={(shotId) => {
              useCanvasStore.getState().setActiveShot(shotId);
              setWorkspace("canvas");
            }}
          />
        )}
        {workspace === "canvas" && (
          <ReactFlowProvider>
            <CanvasWorkspace />
          </ReactFlowProvider>
        )}
        {workspace === "preview" && <PreviewWorkspace onEdit={() => setWorkspace("canvas")} />}
      </main>
    </div>
  );
}
