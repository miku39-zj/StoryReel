"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { useCanvasStore } from "@/stores/canvas-store";
import { useCreationStore } from "@/stores/creation-store";
import { cachedProject, saveProject, rememberProjectRevision } from "@/lib/story/project-cache";
import type { StoryProject } from "@/lib/story/types";
import { backupProject } from "@/lib/story/backup";

export function useProjectPersistence(id: string) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("正在加载");
  const [notice, setNotice] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const project = useCanvasStore.getState().toProject();
    if (!project || project.id !== id) return;
    setStatus("保存中…");
    try {
      const saved = await saveProject(project);
      if (useCanvasStore.getState().projectId === id)
        useCanvasStore.setState({ revision: saved.revision });
      setStatus("已保存");
    } catch (error) {
      setStatus((error as Error).message);
      throw error;
    }
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    let loaded = false;
    setReady(false);
    setError(null);
    setNotice(null);
    const local = cachedProject(id);
    (async () => {
      let project = local;
      let serverLoaded = false;
      try {
        const response = await fetch(`/api/projects/${encodeURIComponent(id)}`, {
          cache: "no-store",
        });
        if (response.ok) {
          const remote: StoryProject = await response.json();
          serverLoaded = true;
          rememberProjectRevision(id, remote.revision ?? 0);
          if (project && (project.revision ?? 0) !== (remote.revision ?? 0)) {
            if (project.updatedAt > remote.updatedAt) {
              await backupProject(project);
              if (!cancelled)
                setNotice("服务器已有更新版本，本地修改已另存为备份，可在项目列表找回。");
            }
            project = remote;
          } else if (!project || remote.updatedAt > project.updatedAt) project = remote;
          else project = { ...project, revision: remote.revision };
        } else if (response.status !== 404 && !local) throw new Error("项目加载失败，请重试");
      } catch (error) {
        if (!local || serverLoaded) throw error;
      }
      if (cancelled) return;
      if (!project) throw new Error("项目不存在，请从工作台创建或打开项目");
      useCanvasStore.getState().loadProject(project);
      loaded = true;
      setReady(true);
      setStatus("保存中…");
      const saved = await saveProject(useCanvasStore.getState().toProject()!);
      if (!cancelled) useCanvasStore.setState({ revision: saved.revision });
      if (!cancelled) setStatus("已保存");
    })().catch((error) => {
      if (!cancelled) {
        if (loaded) setStatus((error as Error).message);
        else setError((error as Error).message);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    if (!ready) return;
    const schedule = () => {
      if (useCanvasStore.getState().projectId !== id) return;
      setStatus("有修改，等待保存");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        void flush().catch(() => {});
      }, 500);
    };
    const unsubscribeCanvas = useCanvasStore.subscribe((state, prev) => {
      if (
        state.activeShotId !== prev.activeShotId ||
        state.shotWorkspaces !== prev.shotWorkspaces ||
        state.nodes !== prev.nodes ||
        state.edges !== prev.edges ||
        state.startNodeId !== prev.startNodeId ||
        state.projectName !== prev.projectName ||
        state.initialVariables !== prev.initialVariables
      )
        schedule();
    });
    const unsubscribeCreation = useCreationStore.subscribe((state, prev) => {
      if (
        state.brief !== prev.brief ||
        state.pendingStoryBrief !== prev.pendingStoryBrief ||
        state.storyOutline !== prev.storyOutline ||
        state.pendingStoryOutline !== prev.pendingStoryOutline ||
        state.branchDesign !== prev.branchDesign ||
        state.storyboardShots !== prev.storyboardShots ||
        state.assets !== prev.assets ||
        state.userPrompt !== prev.userPrompt ||
        state.stepStatuses !== prev.stepStatuses ||
        state.activeStep !== prev.activeStep ||
        state.assetLibrary !== prev.assetLibrary
      ) {
        useCanvasStore.getState().persist();
        schedule();
      }
    });
    return () => {
      unsubscribeCanvas();
      unsubscribeCreation();
      if (timer.current) {
        clearTimeout(timer.current);
        void flush().catch(() => {});
      }
    };
  }, [ready, id, flush]);
  const recover = async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const current = useCanvasStore.getState().toProject();
    const local = current?.id === id ? current : cachedProject(id);
    if (!local) {
      setStatus("未找到可备份的本地项目，请先保留当前页面");
      return;
    }
    setStatus("正在备份本地修改…");
    try {
      await backupProject(local);
      window.location.reload();
    } catch (error) {
      setStatus(`备份失败：${(error as Error).message}`);
    }
  };
  return { ready, error, status, notice, flush, recover };
}
