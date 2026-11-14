"use client";
import { fillShotCanvasResults, applyShotAsset } from "@/lib/production/canvas-results";
import { adoptVisualResults } from "@/lib/production/visual-plan";
import type { StoryProject } from "@/lib/story/types";
import type { CanvasJob } from "@/lib/canvas/jobs";
import type { VisualScope, VisualBatch } from "@/lib/production/visual-plan";
import { useCallback, useEffect, useState } from "react";
import { useCanvasStore } from "@/stores/canvas-store";
import { saveProject, rememberProjectRevision } from "@/lib/story/project-cache";
import { emptyProduction, type ProductionState, type AssetKind } from "@/lib/production/types";
import { syncSelectedKeyframes, syncShotCanvas } from "@/lib/production/canvas-shots";
import { applyProduction } from "@/lib/production/apply";

type VisualProductionState = ProductionState & {
  workerOnline?: boolean;
  visualBatch?: VisualBatch | null;
  visualBatches?: Partial<Record<VisualScope, VisualBatch | null>>;
  visualProject?: StoryProject;
  canvasJobs?: CanvasJob[];
};

export function useShotProduction() {
  const projectId = useCanvasStore((s) => s.projectId);
  const [state, setState] = useState<VisualProductionState>(() => emptyProduction(projectId ?? ""));
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState(false);
  const accept = useCallback((data: VisualProductionState) => {
    if (useCanvasStore.getState().projectId !== data.projectId) return;
    const canvas = useCanvasStore.getState(),
      local = canvas.toProject();
    const updated =
      local && data.visualProject
        ? adoptVisualResults(local, data.visualProject, data.canvasJobs ?? [])
        : null;
    if (updated && (updated.revision ?? 0) >= (local?.revision ?? 0)) {
      rememberProjectRevision(updated.id, updated.revision ?? 0);
      useCanvasStore.setState({ nodes: updated.nodes, revision: updated.revision });
    }
    const base = updated ?? local;
    const filled = base ? syncSelectedKeyframes(fillShotCanvasResults(base, data), data) : null;
    if (filled && filled !== base) {
      useCanvasStore.setState({ nodes: filled.nodes, edges: filled.edges });
      useCanvasStore.getState().persist();
    }
    setState((prev) =>
      prev.projectId !== data.projectId || data.revision >= prev.revision ? data : prev,
    );
  }, []);
  useEffect(() => {
    if (!projectId) return;
    let active = true;
    const controller = new AbortController();
    setLoaded(false);
    setState(emptyProduction(projectId));
    const load = async () => {
      try {
        const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/production`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("任务恢复失败，请稍后重试");
        const data = await response.json();
        if (active) {
          accept(data);
          setLoaded(true);
          setLoadError(null);
        }
      } catch (error) {
        if (active) setLoadError((error as Error).message);
      }
    };
    void load();
    const timer = setInterval(() => {
      void load();
    }, 1500);
    return () => {
      active = false;
      controller.abort();
      clearInterval(timer);
    };
  }, [projectId, accept]);
  const request = async (body: unknown, saveDraft = true) => {
    if (!projectId) return;
    setBusy(true);
    setError(null);
    setApplied(false);
    try {
      // Flush the exact edited storyboard before the server snapshots job inputs.
      if (saveDraft) {
        useCanvasStore.getState().persist();
        const project = useCanvasStore.getState().toProject();
        if (!project) throw new Error("项目不存在");
        await saveProject(project);
      }
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/production`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "提交任务失败");
      accept(data);
      return data as VisualProductionState;
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const generate = (shotIds: string[], kind: AssetKind | "pipeline" | "visual") =>
    request({ action: "generate", shotIds, kind, requestKey: crypto.randomUUID() });
  const generateKeyframes = (keyframeIds: string[]) =>
    request({ action: "generate-keyframes", keyframeIds, requestKey: crypto.randomUUID() });
  const generateVisuals = (scope: VisualScope = "all") =>
    request({ action: "visual-batch", scope });
  const resumeVisuals = (scope: VisualScope) =>
    request({ action: "resume-visual-batch", scope }, false);
  const select = async (assetId: string) => {
    const data = await request({ action: "select", assetId });
    const asset = data?.assets.find((a) => a.id === assetId);
    const canvas = useCanvasStore.getState(),
      project = canvas.toProject();
    if (!asset || !project || project.id !== data?.projectId) return;
    const updated = applyShotAsset(project, asset);
    if (updated !== project) {
      useCanvasStore.setState({ shotWorkspaces: updated.shotWorkspaces });
      canvas.onNodesChange(updated.nodes);
    }
  };
  const syncCanvas = async () => {
    setError(null);
    setBusy(true);
    try {
      const canvas = useCanvasStore.getState(),
        project = canvas.toProject();
      if (!project) throw new Error("项目不存在");
      const updated = syncShotCanvas(project, state);
      useCanvasStore.setState({ shotWorkspaces: updated.shotWorkspaces });
      canvas.applyGraph(updated.nodes, updated.edges);
      const saved = await saveProject(useCanvasStore.getState().toProject()!);
      if (useCanvasStore.getState().projectId === saved.id)
        useCanvasStore.setState({ revision: saved.revision });
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const apply = async () => {
    setError(null);
    setBusy(true);
    try {
      const canvas = useCanvasStore.getState(),
        project = canvas.toProject();
      if (!project) throw new Error("项目不存在");
      const updated = applyProduction(project, state);
      canvas.onNodesChange(updated.nodes);
      const saved = await saveProject(useCanvasStore.getState().toProject()!);
      if (useCanvasStore.getState().projectId === saved.id)
        useCanvasStore.setState({ revision: saved.revision });
      setApplied(true);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return {
    state,
    loaded,
    error: error ?? loadError,
    loadError,
    busy,
    applied,
    generate,
    generateKeyframes,
    generateVisuals,
    resumeVisuals,
    syncCanvas,
    select,
    apply,
  };
}
