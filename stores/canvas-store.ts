import {
  shotWorkspaceGraph,
  workspaceVideo,
  mergeShotNodes,
  mergeShotEdges,
  chooseMainVideo,
  type ShotWorkspace,
} from "@/lib/canvas/shot-workspace";
import { withProjectName } from "@/lib/story/project-name";
/**
 * Canvas Store — 管理互动剧情画布的状态
 *
 * 画布状态管理规则：
 * - nodes / edges 直接由 Zustand 管理（不依赖 React Flow 内部 state）
 * - 选中节点同步到右侧面板
 * - 所有修改操作都通过 store action，便于持久化和撤销
 */

import { baselineMedia, fingerprint } from "@/lib/canvas/workflow";
import { create } from "zustand";
import { nanoid } from "nanoid";
import type {
  StoryFlowNode,
  StoryFlowEdge,
  StoryNodeData,
  StoryNodeType,
  StoryProject,
  StoryEdgeData,
  StoryVariables,
} from "@/lib/story/types";

import { proposeConnection, normalizeConnections, connectedInputs } from "@/lib/story/connections";
import { creationSnapshot, restoreCreation } from "./creation-store";
import { cacheProject, cachedProject } from "@/lib/story/project-cache";
import { repairLegacyDemo } from "@/lib/story/demo";

interface CanvasStore {
  // ── 项目 ──────────────────────────────────────
  projectId: string | null;
  projectName: string;
  storyContextTitle?: string;
  projectDescription: string;
  createdAt: string;
  updatedAt: string;
  initialVariables: StoryVariables;
  revision?: number;
  cacheError: string | null;
  dragging: boolean;
  past: StoryProject[];
  future: StoryProject[];
  checkpoint: () => void;
  undo: () => void;
  redo: () => void;
  replaceProject: (project: StoryProject) => void;
  setInitialVariables: (variables: StoryVariables) => void;

  // ── 画布数据 ────────────────────────────────────
  activeShotId: string | null;
  shotWorkspaces: Record<string, ShotWorkspace>;
  setActiveShot: (shotId: string | null) => void;
  setMainVideo: (nodeId: string) => void;
  updateShotNodes: (nodes: StoryFlowNode[]) => void;
  updateShotEdges: (edges: StoryFlowEdge[]) => void;
  saveShotViewport: (viewport: { x: number; y: number; zoom: number }) => void;
  nodes: StoryFlowNode[];
  edges: StoryFlowEdge[];
  startNodeId: string | null;

  // ── UI 状态 ────────────────────────────────────
  selectedNodeId: string | null;
  selectedEdgeId: string | null;

  // ── 项目操作 ───────────────────────────────────
  loadProject: (project: StoryProject) => void;
  setProjectName: (name: string) => void;
  setStartNode: (nodeId: string) => void;

  // ── 节点操作 ───────────────────────────────────
  addNode: (type: StoryNodeType, position: { x: number; y: number }) => string;
  addConnectedNode: (
    anchorId: string,
    direction: "input" | "output",
    type: StoryNodeType,
    data?: StoryEdgeData,
    position?: { x: number; y: number },
  ) => string | null;
  updateNodeData: (nodeId: string, patch: Partial<StoryNodeData>) => void;
  setVideoPrompt: (nodeId: string, prompt: string) => void;
  deleteNode: (nodeId: string) => void;
  selectNode: (nodeId: string | null) => void;

  // ── 边操作 ───────────────────────────────────
  addEdge: (source: string, target: string, data?: StoryEdgeData) => boolean;
  updateEdge: (edgeId: string, patch: StoryEdgeData) => boolean;
  deleteEdge: (edgeId: string) => void;
  selectEdge: (edgeId: string | null) => void;

  applyGraph: (nodes: StoryFlowNode[], edges: StoryFlowEdge[]) => void;
  // ── 批量 ───────────────────────────────────
  onNodesChange: (nodes: StoryFlowNode[]) => void;
  onEdgesChange: (edges: StoryFlowEdge[]) => void;

  // ── 导出 ───────────────────────────────────
  toProject: () => StoryProject | null;

  // ── 持久化 ─────────────────────────────────
  persist: () => void;
  hydrate: (projectId?: string) => void;
}

function createNodeData(type: StoryNodeType): StoryNodeData {
  switch (type) {
    case "video":
      return {
        nodeType: "video",
        title: "新视频节点",
        generationStatus: "idle",
        seedanceModel: "seedance-2-0",
      };
    case "choice":
      return {
        nodeType: "choice",
        question: "你会怎么做？",
      };
    case "condition":
      return {
        nodeType: "condition",
        variable: "",
        operator: "==",
        value: "",
      };
    case "merge":
      return {
        nodeType: "merge",
        label: "汇合",
      };
    case "ending":
      return {
        nodeType: "ending",
        title: "结局",
        description: "",
      };
    case "text":
      return {
        nodeType: "text",
        title: "场景文字",
        content: "",
        role: "scene",
        generationStatus: "idle",
      };
    case "image":
      return { nodeType: "image", title: "图片节点", generationStatus: "idle" };
  }
}

export const useCanvasStore = create<CanvasStore>((set, get) => ({
  projectId: null,
  projectName: "未命名项目",
  storyContextTitle: undefined,
  projectDescription: "",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  initialVariables: {},
  revision: undefined,
  cacheError: null,
  dragging: false,
  past: [],
  future: [],
  checkpoint: () => {
    const project = get().toProject();
    if (project)
      set((s) => ({
        past: [
          ...s.past,
          { ...project, nodes: project.nodes.map((n) => ({ ...n, dragging: false })) },
        ].slice(-50),
        future: [],
      }));
  },
  undo: () => {
    const { past, future, revision } = get(),
      current = get().toProject(),
      previous = past.at(-1);
    if (!current || !previous) return;
    get().loadProject({ ...previous, revision });
    set({ past: past.slice(0, -1), future: [current, ...future] });
  },
  redo: () => {
    const { past, future, revision } = get(),
      current = get().toProject(),
      next = future[0];
    if (!current || !next) return;
    get().loadProject({ ...next, revision });
    set({ past: [...past, current], future: future.slice(1) });
  },
  replaceProject: (project) => {
    get().checkpoint();
    const past = get().past;
    get().loadProject(project);
    set({ past });
  },
  setInitialVariables: (initialVariables) => {
    get().checkpoint();
    set({ initialVariables });
    get().persist();
  },
  activeShotId: null,
  shotWorkspaces: {},
  setActiveShot: (shotId) => {
    const project = get().toProject();
    const video = shotId && project ? workspaceVideo(project, shotId) : undefined;
    if (shotId && !video && !creationSnapshot().storyboardShots.some((s) => s.shotId === shotId))
      return;
    if (shotId && video && !get().shotWorkspaces[shotId]) {
      set({
        shotWorkspaces: {
          ...get().shotWorkspaces,
          [shotId]: { initialized: true, mainVideoNodeId: video.id },
        },
      });
    }
    set({ activeShotId: shotId, selectedNodeId: null, selectedEdgeId: null });
    get().persist();
  },
  setMainVideo: (nodeId) => {
    const project = get().toProject(),
      shotId = get().activeShotId;
    if (!project || !shotId) return;
    const updated = chooseMainVideo(project, shotId, nodeId);
    get().checkpoint();
    set({ shotWorkspaces: updated.shotWorkspaces });
    get().persist();
  },
  saveShotViewport: (viewport) => {
    const id = get().activeShotId;
    if (!id) return;
    const current = get().shotWorkspaces[id];
    if (!current) return;
    if (JSON.stringify(current?.viewport) === JSON.stringify(viewport)) return;
    set({
      shotWorkspaces: {
        ...get().shotWorkspaces,
        [id]: { ...current, initialized: true, viewport },
      },
    });
    get().persist();
  },
  updateShotNodes: (nodes) => {
    const project = get().toProject(),
      id = get().activeShotId;
    if (!project || !id) return get().onNodesChange(nodes);
    const previous = shotWorkspaceGraph(project, id).nodes;
    const dragging = nodes.some((n) => n.dragging);
    const edited =
      previous.length !== nodes.length ||
      nodes.some(
        (n, i) =>
          n.position.x !== previous[i]?.position.x ||
          n.position.y !== previous[i]?.position.y ||
          n.data !== previous[i]?.data,
      );
    if (edited && !get().dragging) get().checkpoint();
    const updated = mergeShotNodes(project, id, nodes);
    set({
      nodes: updated.nodes,
      edges: updated.edges,
      shotWorkspaces: updated.shotWorkspaces,
      dragging,
      selectedNodeId: updated.nodes.some((n) => n.id === get().selectedNodeId)
        ? get().selectedNodeId
        : null,
    });
    if (edited) get().persist();
  },
  updateShotEdges: (edges) => {
    const project = get().toProject(),
      id = get().activeShotId;
    if (!project || !id) return get().onEdgesChange(edges);
    const updated = mergeShotEdges(project, id, edges);
    get().onEdgesChange(updated.edges);
  },
  nodes: [],
  edges: [],
  startNodeId: null,
  selectedNodeId: null,
  selectedEdgeId: null,

  loadProject: (project) => {
    project = baselineMedia(repairLegacyDemo(project));
    restoreCreation(project.creation);
    set({
      activeShotId:
        project.activeShotId &&
        (workspaceVideo(project, project.activeShotId) ||
          project.creation?.storyboardShots.some((s) => s.shotId === project.activeShotId))
          ? project.activeShotId!
          : (project.creation?.storyboardShots[0]?.shotId ?? null),
      shotWorkspaces: project.shotWorkspaces ?? {},
      projectId: project.id,
      projectName: project.name,
      storyContextTitle: project.storyContextTitle,
      projectDescription: project.description ?? "",
      createdAt: project.createdAt ?? new Date().toISOString(),
      updatedAt: project.updatedAt ?? new Date().toISOString(),
      initialVariables: project.initialVariables ?? {},
      revision: project.revision,
      dragging: false,
      past: [],
      future: [],
      nodes: project.nodes,
      edges: normalizeConnections(project.nodes, project.edges),
      startNodeId: project.nodes.some((n) => n.id === project.startNodeId && n.type === "video")
        ? project.startNodeId!
        : (project.nodes.find((n) => n.type === "video")?.id ?? null),
      selectedNodeId: null,
      selectedEdgeId: null,
    });
    get().persist();
  },

  setProjectName: (name) => {
    const project = get().toProject();
    if (!project) return;
    const renamed = withProjectName(project, name);
    if (get().projectName === renamed.name) return;
    get().checkpoint();
    set({ projectName: renamed.name, storyContextTitle: renamed.storyContextTitle });
    get().persist();
  },

  setStartNode: (nodeId) => {
    if (!get().nodes.some((n) => n.id === nodeId && n.type === "video")) return;
    get().checkpoint();
    set({ startNodeId: nodeId });
    get().persist();
  },

  addNode: (type, position) => {
    get().checkpoint();
    const id = `${type}_${nanoid(8)}`;
    const data = {
      ...createNodeData(type),
      ...(get().activeShotId ? { canvasShotId: get().activeShotId } : {}),
    };
    const node: StoryFlowNode = {
      id,
      type,
      position,
      data,
      // 不设 style —— 节点外观完全由各自组件控制，避免 React Flow 渲染第二层卡片
    };
    set((state) => ({
      nodes: [...state.nodes, node],
      selectedNodeId: id,
      selectedEdgeId: null,
      startNodeId: state.startNodeId ?? (!state.activeShotId && type === "video" ? id : null),
    }));
    get().persist();
    return id;
  },

  addConnectedNode: (anchorId, direction, type, data, position) => {
    const state = get();
    const anchor = state.nodes.find((n) => n.id === anchorId);
    if (!anchor) return null;
    const siblings = state.edges.filter((e) =>
      direction === "input" ? e.target === anchorId : e.source === anchorId,
    ).length;
    const id = `${type}_${nanoid(8)}`;
    const node: StoryFlowNode = {
      id,
      type,
      data: {
        ...createNodeData(type),
        ...(state.activeShotId ? { canvasShotId: state.activeShotId } : {}),
      },
      position: position ?? {
        x: anchor.position.x + (direction === "input" ? -360 : 360),
        y: anchor.position.y + siblings * 160,
      },
    };
    const source = direction === "input" ? id : anchorId;
    const target = direction === "input" ? anchorId : id;
    const nodes = [...state.nodes, node];
    const proposal = proposeConnection(source, target, nodes, state.edges, data);
    if (proposal.error) return null;
    get().checkpoint();
    const edge: StoryFlowEdge = {
      id: `edge_${nanoid(8)}`,
      source,
      target,
      data: proposal.data,
      type: proposal.data.kind === "context" ? "default" : "smoothstep",
    };
    set({
      nodes,
      edges: [...state.edges, edge],
      selectedNodeId: id,
      selectedEdgeId: null,
      startNodeId:
        state.startNodeId ??
        (direction === "input" && anchor.type === "video"
          ? anchor.id
          : type === "video"
            ? id
            : null),
    });
    get().persist();
    return id;
  },

  updateNodeData: (nodeId, patch) => {
    get().checkpoint();
    set((state) => ({
      nodes: state.nodes.map((n) =>
        n.id === nodeId ? ({ ...n, data: { ...n.data, ...patch } } as StoryFlowNode) : n,
      ),
    }));
    if ((patch.imageUrl || patch.videoUrl) && !patch.generationFingerprint) {
      const project = get().toProject();
      if (project)
        set((state) => ({
          nodes: state.nodes.map((n) =>
            n.id === nodeId
              ? { ...n, data: { ...n.data, generationFingerprint: fingerprint(project, nodeId) } }
              : n,
          ),
        }));
    }
    get().persist();
  },

  setVideoPrompt: (nodeId, prompt) => {
    const { nodes, edges } = get();
    if (!nodes.some((node) => node.id === nodeId && node.type === "video")) return;
    const promptEdges = new Set(
      connectedInputs(nodeId, nodes, edges)
        .filter((input) => input.role === "prompt")
        .map((input) => input.edge.id),
    );
    get().checkpoint();
    set((state) => ({
      nodes: state.nodes.map((node) =>
        node.id === nodeId ? { ...node, data: { ...node.data, scenePrompt: prompt } } : node,
      ),
      // The editor contains the complete prompt, so do not append its old text inputs again.
      edges: state.edges.filter((edge) => !promptEdges.has(edge.id)),
      selectedEdgeId: promptEdges.has(state.selectedEdgeId ?? "") ? null : state.selectedEdgeId,
    }));
    get().persist();
  },

  deleteNode: (nodeId) => {
    const project = get().toProject(),
      id = get().activeShotId;
    if (project && id) {
      const visible = shotWorkspaceGraph(project, id).nodes;
      if (visible.some((n) => n.id === nodeId)) {
        get().updateShotNodes(visible.filter((n) => n.id !== nodeId));
        return;
      }
    }
    get().checkpoint();
    set((state) => ({
      nodes: state.nodes.filter((n) => n.id !== nodeId),
      edges: state.edges.filter((e) => e.source !== nodeId && e.target !== nodeId),
      selectedNodeId: state.selectedNodeId === nodeId ? null : state.selectedNodeId,
      selectedEdgeId: state.edges.some(
        (e) => e.id === state.selectedEdgeId && e.source !== nodeId && e.target !== nodeId,
      )
        ? state.selectedEdgeId
        : null,
      startNodeId: state.startNodeId === nodeId ? null : state.startNodeId,
    }));
    get().persist();
  },

  selectNode: (nodeId) => set({ selectedNodeId: nodeId, selectedEdgeId: null }),

  addEdge: (source, target, data) => {
    const { nodes, edges } = get();
    const proposal = proposeConnection(source, target, nodes, edges, data);
    if (proposal.error) return false;
    get().checkpoint();
    const edge: StoryFlowEdge = {
      id: `edge_${nanoid(8)}`,
      source,
      target,
      data: proposal.data,
      type: proposal.data.kind === "context" ? "default" : "smoothstep",
    };
    set({ edges: [...edges, edge] });
    get().persist();
    return true;
  },

  updateEdge: (edgeId, patch) => {
    const { nodes, edges } = get();
    const edge = edges.find((e) => e.id === edgeId);
    if (!edge) return false;
    const proposal = proposeConnection(
      edge.source,
      edge.target,
      nodes,
      edges.filter((e) => e.id !== edgeId),
      { ...edge.data, ...patch },
    );
    if (proposal.error) return false;
    get().checkpoint();
    set({ edges: edges.map((e) => (e.id === edgeId ? { ...e, data: proposal.data } : e)) });
    get().persist();
    return true;
  },

  deleteEdge: (edgeId) => {
    get().checkpoint();
    set((state) => ({
      edges: state.edges.filter((e) => e.id !== edgeId),
      selectedEdgeId: state.selectedEdgeId === edgeId ? null : state.selectedEdgeId,
    }));
    get().persist();
  },

  selectEdge: (edgeId) => set({ selectedEdgeId: edgeId, selectedNodeId: null }),

  applyGraph: (nodes, edges) => {
    get().checkpoint();
    const project = get().toProject();
    const normalized = project ? baselineMedia({ ...project, nodes, edges }).nodes : nodes;
    set({ nodes: normalized, edges, selectedNodeId: null, selectedEdgeId: null });
    get().persist();
  },
  onNodesChange: (nodes) => {
    const previous = get().nodes;
    const dragging = nodes.some((n) => n.dragging);
    const changed =
      previous.length !== nodes.length ||
      nodes.some(
        (n, i) =>
          n.id !== previous[i]?.id ||
          n.data !== previous[i]?.data ||
          n.position.x !== previous[i]?.position.x ||
          n.position.y !== previous[i]?.position.y,
      );
    // A drag is one undoable gesture, not one history entry per pointer frame.
    if ((!get().dragging && dragging) || (!get().dragging && changed)) get().checkpoint();
    const ids = new Set(nodes.map((n) => n.id));
    set((state) => ({
      nodes,
      dragging,
      edges: state.edges.filter((e) => ids.has(e.source) && ids.has(e.target)),
      selectedEdgeId: state.edges.some(
        (e) => e.id === state.selectedEdgeId && ids.has(e.source) && ids.has(e.target),
      )
        ? state.selectedEdgeId
        : null,
      selectedNodeId:
        state.selectedNodeId && ids.has(state.selectedNodeId) ? state.selectedNodeId : null,
      startNodeId: state.startNodeId && ids.has(state.startNodeId) ? state.startNodeId : null,
    }));
    get().persist();
  },
  onEdgesChange: (edges) => {
    const previous = get().edges;
    if (
      previous.length !== edges.length ||
      edges.some((e, i) => e.id !== previous[i]?.id || e.data !== previous[i]?.data)
    )
      get().checkpoint();
    const ids = new Set(get().nodes.map((n) => n.id));
    const valid = edges.filter((e) => ids.has(e.source) && ids.has(e.target));
    set((state) => ({
      edges: valid,
      selectedEdgeId: valid.some((e) => e.id === state.selectedEdgeId)
        ? state.selectedEdgeId
        : null,
    }));
    get().persist();
  },

  toProject: () => {
    const state = get();
    if (!state.projectId) return null;
    return {
      activeShotId: state.activeShotId ?? undefined,
      shotWorkspaces: state.shotWorkspaces,
      id: state.projectId,
      name: state.projectName,
      storyContextTitle: state.storyContextTitle,
      description: state.projectDescription,
      nodes: state.nodes,
      edges: state.edges,
      startNodeId: state.startNodeId ?? undefined,
      createdAt: state.createdAt,
      updatedAt: state.updatedAt,
      initialVariables: state.initialVariables,
      revision: state.revision,
      creation: creationSnapshot(),
    };
  },

  persist: () => {
    if (typeof window === "undefined") return;
    // Mutations update the dashboard snapshot and per-project creation data together.
    set({ updatedAt: new Date().toISOString() });
    try {
      const project = get().toProject();
      if (project) cacheProject(project);
      else localStorage.setItem("storyreel:canvas", JSON.stringify(get()));
      set({ cacheError: null });
    } catch {
      set({ cacheError: "浏览器缓存写入失败，请确认服务器保存成功后再关闭页面。" });
    }
  },

  hydrate: (projectId) => {
    if (typeof window === "undefined") return;
    if (projectId) {
      const project = cachedProject(projectId);
      if (project) get().loadProject(project);
      return;
    }
    const stored = localStorage.getItem("storyreel:canvas");
    if (!stored) return;
    try {
      const data = JSON.parse(stored);
      set({
        projectId: data.projectId ?? null,
        projectName: data.projectName ?? "未命名项目",
        storyContextTitle: data.storyContextTitle,
        projectDescription: data.projectDescription ?? "",
        initialVariables: data.initialVariables ?? {},
        revision: data.revision,
        nodes: data.nodes ?? [],
        edges: normalizeConnections(data.nodes ?? [], data.edges ?? []),
        startNodeId: (data.nodes as StoryFlowNode[] | undefined)?.some(
          (n) => n.id === data.startNodeId && n.type === "video",
        )
          ? data.startNodeId
          : ((data.nodes as StoryFlowNode[] | undefined)?.find((n) => n.type === "video")?.id ??
            null),
      });
      restoreCreation(data.creation);
    } catch {}
  },
}));
