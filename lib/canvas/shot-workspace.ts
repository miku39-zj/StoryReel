import type { StoryProject, StoryFlowNode, StoryFlowEdge } from "@/lib/story/types";
import { productionShots } from "@/lib/production/shot-inputs";
import { shotRevision } from "@/lib/production/shots";
import { isContextEdge } from "@/lib/story/connections";

export interface ShotWorkspace {
  initialized: boolean;
  mainVideoNodeId?: string;
  sourceRevision?: string;
  positions?: Record<string, { x: number; y: number }>;
  viewport?: { x: number; y: number; zoom: number };
}
export function nodeShotId(node: StoryFlowNode): string | undefined {
  const value = node.data.canvasShotId ?? node.data.productionShotId;
  return typeof value === "string" ? value : undefined;
}
export function mainVideoNode(project: StoryProject, shotId: string) {
  const setting = project.shotWorkspaces?.[shotId];
  const id = setting?.mainVideoNodeId;
  return project.nodes.find(
    (n) =>
      n.type === "video" &&
      !n.data.canvasDetached &&
      nodeShotId(n) === shotId &&
      (setting?.initialized ? n.id === id : n.data.productionShotId === shotId),
  );
}
/** A view of one shot; reference assets remain shared, not copied into every workspace. */
export function shotWorkspaceGraph(project: StoryProject, shotId: string) {
  const owned = project.nodes.filter((n) => nodeShotId(n) === shotId && !n.data.canvasDetached);
  const ids = new Set(owned.map((n) => n.id));
  const queue = [...ids];
  for (let i = 0; i < queue.length; i++)
    for (const edge of project.edges) {
      if (edge.target !== queue[i] || !isContextEdge(edge, project.nodes) || ids.has(edge.source))
        continue;
      const source = project.nodes.find((n) => n.id === edge.source);
      if (!source || (nodeShotId(source) && nodeShotId(source) !== shotId)) continue;
      ids.add(source.id);
      queue.push(source.id);
    }
  const settings = project.shotWorkspaces?.[shotId];
  const references = project.nodes.filter((n) => ids.has(n.id) && nodeShotId(n) !== shotId);
  const nodes = project.nodes
    .filter((n) => ids.has(n.id))
    .map((node) => {
      let position = settings?.positions?.[node.id];
      if (!position) {
        const index = references.findIndex((n) => n.id === node.id);
        position =
          index >= 0
            ? { x: 0, y: index * 240 }
            : node.type === "text"
              ? { x: 340, y: 290 }
              : node.type === "image"
                ? { x: 340, y: 0 }
                : node.data.productionShotId
                  ? { x: 700, y: 150 }
                  : node.position;
      }
      return { ...node, position };
    });
  return {
    nodes,
    edges: project.edges.filter(
      (e) =>
        ids.has(e.source) &&
        ids.has(e.target) &&
        (isContextEdge(e, project.nodes) ||
          (nodeShotId(project.nodes.find((n) => n.id === e.source)!) === shotId &&
            nodeShotId(project.nodes.find((n) => n.id === e.target)!) === shotId &&
            !e.id.startsWith("shot_input:"))),
    ),
  };
}
export function initializeShotWorkspaces(project: StoryProject): StoryProject {
  const settings = { ...project.shotWorkspaces };
  for (const shot of project.creation?.storyboardShots ?? []) {
    if (settings[shot.shotId]?.initialized) continue;
    const video = mainVideoNode(project, shot.shotId);
    if (video)
      settings[shot.shotId] = {
        ...settings[shot.shotId],
        initialized: true,
        mainVideoNodeId: video.id,
      };
  }
  return { ...project, shotWorkspaces: settings };
}
export function chooseMainVideo(
  project: StoryProject,
  shotId: string,
  nodeId: string,
): StoryProject {
  const node = project.nodes.find(
    (n) =>
      n.id === nodeId && n.type === "video" && !n.data.canvasDetached && nodeShotId(n) === shotId,
  );
  if (!node) throw new Error("只能选择当前分镜的视频节点");
  const shot = productionShots(project).find((s) => s.shotId === shotId);
  return {
    ...project,
    shotWorkspaces: {
      ...project.shotWorkspaces,
      [shotId]: {
        ...project.shotWorkspaces?.[shotId],
        initialized: true,
        mainVideoNodeId: nodeId,
        sourceRevision: shot ? shotRevision(shot) : undefined,
      },
    },
  };
}
/** Merge visible edits; hidden shots and story routing are never replaced by a filtered view. */
export function mergeShotNodes(
  project: StoryProject,
  shotId: string,
  nodes: StoryFlowNode[],
): StoryProject {
  const visible = shotWorkspaceGraph(project, shotId);
  const visibleIds = new Set(visible.nodes.map((n) => n.id));
  nodes = nodes.filter(
    (n) => visibleIds.has(n.id) || !project.nodes.some((old) => old.id === n.id),
  );
  const changed = new Map(nodes.map((n) => [n.id, n]));
  const removed = new Set(visible.nodes.filter((n) => !changed.has(n.id)).map((n) => n.id));
  const detached = new Set(
    visible.nodes
      .filter((n) => removed.has(n.id) && n.type === "video" && n.data.productionShotId)
      .map((n) => n.id),
  );
  const deleted = new Set(
    visible.nodes.filter((n) => removed.has(n.id) && nodeShotId(n) === shotId).map((n) => n.id),
  );
  const positions = { ...project.shotWorkspaces?.[shotId]?.positions };
  for (const node of nodes) positions[node.id] = node.position;
  const existing = project.shotWorkspaces?.[shotId];
  const workspace = {
    ...existing,
    initialized: existing?.initialized ?? false,
    positions,
    mainVideoNodeId: existing?.initialized
      ? existing.mainVideoNodeId
      : mainVideoNode(project, shotId)?.id,
  };
  if (workspace.mainVideoNodeId && removed.has(workspace.mainVideoNodeId))
    workspace.mainVideoNodeId = undefined;
  return {
    ...project,
    shotWorkspaces: { ...project.shotWorkspaces, [shotId]: workspace },
    nodes: [
      ...project.nodes
        .filter((n) => !deleted.has(n.id) || detached.has(n.id))
        .map((n) => {
          if (detached.has(n.id)) return { ...n, data: { ...n.data, canvasDetached: true } };
          const update = changed.get(n.id);
          return update ? { ...update, position: n.position } : n;
        }),
      ...nodes
        .filter((n) => !project.nodes.some((old) => old.id === n.id))
        .map((n) => ({
          ...n,
          data: { ...n.data, productionShotId: undefined, canvasShotId: shotId },
        })),
    ],
    edges: project.edges.filter(
      (e) =>
        (!deleted.has(e.source) || detached.has(e.source)) &&
        (!deleted.has(e.target) || detached.has(e.target)) &&
        !(
          (removed.has(e.source) || removed.has(e.target)) &&
          visible.edges.some((v) => v.id === e.id)
        ),
    ),
  };
}
export function mergeShotEdges(
  project: StoryProject,
  shotId: string,
  edges: StoryFlowEdge[],
): StoryProject {
  const graph = shotWorkspaceGraph(project, shotId);
  const visible = new Set(graph.edges.map((e) => e.id));
  const ids = new Set(graph.nodes.map((n) => n.id));
  const safe = edges.filter(
    (e) =>
      ids.has(e.source) &&
      ids.has(e.target) &&
      (!project.edges.some((old) => old.id === e.id) || visible.has(e.id)),
  );
  return { ...project, edges: [...project.edges.filter((e) => !visible.has(e.id)), ...safe] };
}
