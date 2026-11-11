"use client";
import type { StoryProject } from "@/lib/story/types";
import { create } from "zustand";
import type { CanvasJob } from "@/lib/canvas/jobs";
import { useCanvasStore } from "./canvas-store";
import { fingerprint } from "@/lib/canvas/workflow";
import { canvasResultPatch } from "@/lib/generation/results";
export type { CanvasVersion } from "@/lib/generation/results";
async function api(body?: unknown, projectId?: string) {
  const res = await fetch(
    body ? "/api/canvas/jobs" : `/api/canvas/jobs?projectId=${encodeURIComponent(projectId!)}`,
    body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : undefined,
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "任务请求失败");
  return data;
}
export interface GenerationQuote {
  nodeIds: string[];
  images: number;
  videos: number;
  total: number;
  estimatedCny: number | null;
  maxBatch: number;
  maxActive: number;
}
export const useCanvasJobs = create<{
  jobs: CanvasJob[];
  workerOnline: boolean;
  pending: {
    project: StoryProject;
    targets: string[];
    requestKey: string;
    quote: GenerationQuote;
  } | null;
  confirm: () => Promise<void>;
  resume: (id: string) => Promise<void>;
  error: string;
  loading: boolean;
  refresh: (poll?: boolean) => Promise<void>;
  submit: (ids: string[]) => Promise<void>;
  cancel: (id: string) => Promise<void>;
}>((set, get) => ({
  jobs: [],
  workerOnline: false,
  pending: null,
  error: "",
  loading: false,
  refresh: async (poll = false) => {
    const id = useCanvasStore.getState().projectId;
    if (!id) return;
    try {
      const data = await api(poll ? { action: "poll", projectId: id } : undefined, id);
      if (useCanvasStore.getState().projectId !== id) return;
      set({ jobs: data.jobs, workerOnline: !!data.workerOnline });
      for (const job of data.jobs as CanvasJob[]) {
        const store = useCanvasStore.getState(),
          project = store.toProject(),
          node = store.nodes.find((n) => n.id === job.nodeId);
        if (!node || !project) continue;
        const patch = canvasResultPatch(project, job);
        if (patch) store.updateNodeData(node.id, patch);
      }
    } catch (e) {
      if (useCanvasStore.getState().projectId === id) set({ error: (e as Error).message });
    }
  },
  submit: async (ids) => {
    const project = useCanvasStore.getState().toProject();
    if (!project) {
      set({ error: "请先创建项目" });
      return;
    }
    set({ loading: true, error: "" });
    try {
      const requestKey = crypto.randomUUID();
      const data = await api({ action: "plan", project, targets: ids, requestKey });
      set({ pending: { project, targets: ids, requestKey, quote: data.quote } });
    } catch (e) {
      set({ error: (e as Error).message });
    } finally {
      set({ loading: false });
    }
  },
  confirm: async () => {
    const pending = get().pending;
    if (!pending) return;
    if (useCanvasStore.getState().projectId !== pending.project.id) {
      set({ pending: null });
      return;
    }
    const current = useCanvasStore.getState().toProject();
    if (
      !current ||
      pending.quote.nodeIds.some(
        (id) => fingerprint(current, id) !== fingerprint(pending.project, id),
      )
    ) {
      set({ pending: null, error: "生成输入已改变，请重新检查任务清单" });
      return;
    }
    set({ loading: true, error: "" });
    try {
      await api(pending);
      set({ pending: null });
      await get().refresh();
    } catch (e) {
      set({ error: (e as Error).message });
    } finally {
      set({ loading: false });
    }
  },
  resume: async (id) => {
    try {
      await api({ action: "resume", projectId: useCanvasStore.getState().projectId, jobId: id });
      await get().refresh();
    } catch (e) {
      set({ error: (e as Error).message });
    }
  },
  cancel: async (id) => {
    try {
      await api({ action: "cancel", projectId: useCanvasStore.getState().projectId, jobId: id });
      await get().refresh();
    } catch (e) {
      set({ error: (e as Error).message });
    }
  },
}));
