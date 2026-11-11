import { resolveShotOutputs } from "@/lib/production/shot-outputs";
import { omit } from "@/lib/omit";
import type { StoryProject, StoryFlowEdge } from "./types";
import type { ShotSegment } from "@/lib/production/apply";
import { evaluateCondition, applyVariables } from "./variables";
import { isStale } from "@/lib/canvas/workflow";
import { productionShots } from "@/lib/production/shot-inputs";
import { shotRevision } from "@/lib/production/shots";
import { storyEdges } from "./connections";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  allPathsReachEnding: boolean;
  assetsReady: number;
  assetsTotal: number;
}

export function shareableVideoUrl(value: unknown): boolean {
  if (typeof value !== "string" || !value.trim()) return false;
  if (/^\/(?!\/)/.test(value)) return true;
  try {
    return ["https:", "http:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

export function reachableNodeIds(project: StoryProject): Set<string> {
  const outgoing = new Map<string, string[]>();
  for (const edge of storyEdges(project.nodes, project.edges)) {
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
  }
  const visited = new Set<string>();
  const queue = project.startNodeId ? [project.startNodeId] : [];
  for (let index = 0; index < queue.length; index++) {
    const id = queue[index];
    if (visited.has(id)) continue;
    visited.add(id);
    queue.push(...(outgoing.get(id) ?? []));
  }
  return visited;
}

export function validateProject(project: StoryProject): ValidationResult {
  project = resolveShotOutputs(project);
  const errors: string[] = [],
    warnings: string[] = [];
  const nodes = new Map(project.nodes.map((n) => [n.id, n]));
  if (nodes.size !== project.nodes.length) errors.push("存在重复的节点 ID");
  if (new Set(project.edges.map((e) => e.id)).size !== project.edges.length)
    errors.push("存在重复的连接 ID");
  if (!project.startNodeId || !nodes.has(project.startNodeId)) errors.push("请设置有效的视频起点");
  else if (nodes.get(project.startNodeId)?.data.nodeType !== "video")
    errors.push("请将视频节点设为播放起点");
  for (const n of project.nodes)
    if (n.type !== n.data.nodeType) errors.push(`节点「${n.id}」类型不一致`);
  for (const edge of project.edges) {
    if (!nodes.has(edge.source) || !nodes.has(edge.target))
      errors.push(`连接「${edge.id}」引用了不存在的节点`);
  }
  const reachable = reachableNodeIds(project);
  const edges = storyEdges(project.nodes, project.edges);
  const outgoing = new Map<string, StoryFlowEdge[]>();
  const incoming = new Map<string, string[]>();
  for (const edge of edges) {
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge]);
    incoming.set(edge.target, [...(incoming.get(edge.target) ?? []), edge.source]);
  }
  let assetsReady = 0,
    assetsTotal = 0;
  for (const node of project.nodes) {
    const data = node.data,
      next = outgoing.get(node.id) ?? [];
    if (!reachable.has(node.id)) {
      if (!["image", "text"].includes(data.nodeType))
        warnings.push(`节点「${node.id}」不在播放路线中`);
      continue;
    }
    if (data.nodeType === "video") {
      assetsTotal++;
      if (isStale(project, node))
        errors.push(`视频「${data.title || node.id}」输入已修改，请重新生成素材`);
      if (data.segments !== undefined) {
        if (!Array.isArray(data.segments) || !data.segments.length)
          errors.push(`视频「${node.id}」的镜头序列为空`);
        else {
          const ids = new Set<string>();
          for (const segment of data.segments) {
            if (
              !segment ||
              typeof segment.shotId !== "string" ||
              ids.has(segment.shotId) ||
              !shareableVideoUrl(segment.videoUrl) ||
              (segment.audioUrl !== undefined && !shareableVideoUrl(segment.audioUrl)) ||
              typeof segment.duration !== "number" ||
              !Number.isFinite(segment.duration) ||
              segment.duration <= 0
            )
              errors.push(`视频「${node.id}」包含无效镜头或素材地址`);
            if (segment) ids.add(segment.shotId);
          }
          if (project.creation) {
            const expected = productionShots(project)
              .filter((s) => `video_${s.sceneId}` === node.id)
              .sort((a, b) => a.shotIndex - b.shotIndex);
            if (
              expected.length !== data.segments.length ||
              expected.some(
                (shot, i) =>
                  shot.shotId !== data.segments![i]?.shotId ||
                  shotRevision(shot) !== data.segments![i]?.sourceRevision ||
                  (!!shot.dialogue?.trim() && !data.segments![i]?.audioUrl),
              )
            )
              errors.push(`视频「${node.id}」的镜头已修改，请重新应用镜头素材`);
          }
        }
      }
      if (shareableVideoUrl(data.videoUrl)) assetsReady++;
      else
        errors.push(
          `视频「${data.title || node.id}」缺少可分享的视频地址（不支持本机 blob/file 地址）`,
        );
      if (next.length === 0) errors.push(`视频「${data.title || node.id}」未连接后续剧情或结局`);
      if (data.audioUrl !== undefined && !shareableVideoUrl(data.audioUrl))
        errors.push(`视频「${node.id}」的配音地址不可分享`);
      if (
        data.clipEnd !== undefined &&
        (typeof data.clipEnd !== "number" || !Number.isFinite(data.clipEnd) || data.clipEnd <= 0)
      )
        errors.push(`视频「${node.id}」的片段结束时间无效`);
      if (
        data.interactionAt !== undefined &&
        (typeof data.interactionAt !== "number" ||
          !Number.isFinite(data.interactionAt) ||
          data.interactionAt < 0 ||
          (typeof data.duration === "number" && data.interactionAt >= data.duration))
      )
        errors.push(`视频「${node.id}」的交互时间无效`);
    } else if (data.nodeType === "ending") {
      if (next.length) errors.push(`结局「${node.id}」不能有后续剧情`);
    } else if (data.nodeType === "merge") {
      if (next.length !== 1) errors.push(`汇合节点「${node.id}」必须有且只有一条后续路线`);
    } else if (data.nodeType === "choice") {
      if (next.length < 2) errors.push(`选择节点「${node.id}」至少需要两个选项`);
      if (
        data.timeoutSecs !== undefined &&
        (typeof data.timeoutSecs !== "number" ||
          !Number.isFinite(data.timeoutSecs) ||
          data.timeoutSecs <= 0)
      )
        errors.push(`选择节点「${node.id}」的超时时间无效`);
    } else if (data.nodeType === "condition") {
      try {
        evaluateCondition(data, project.initialVariables ?? {});
      } catch (error) {
        errors.push(`条件节点「${node.id}」：${(error as Error).message}`);
      }
      if (
        next.length !== 2 ||
        !next.some((e) => e.data?.condition === "true") ||
        !next.some((e) => e.data?.condition === "false")
      )
        errors.push(`条件节点「${node.id}」必须配置 true / false 两条路线`);
    } else errors.push(`素材节点「${node.id}」不能位于播放路线中`);
    if (data.nodeType === "choice" || (data.nodeType === "video" && next.length > 1)) {
      if (next.some((e) => typeof e.data?.choiceLabel !== "string" || !e.data.choiceLabel.trim()))
        errors.push(`节点「${node.id}」有未命名的选项`);
    }
  }
  for (const edge of edges)
    try {
      applyVariables(project.initialVariables ?? {}, edge.data);
    } catch (error) {
      errors.push(`连接「${edge.id}」：${(error as Error).message}`);
    }
  // Reverse topological reduction proves *every* route terminates at an explicit ending.
  // This is linear in graph size and never enumerates exponentially many paths.
  const pending = new Map<string, number>();
  for (const id of reachable) pending.set(id, (outgoing.get(id) ?? []).length);
  const finished = project.nodes
    .filter(
      (n) => reachable.has(n.id) && n.data.nodeType === "ending" && !outgoing.get(n.id)?.length,
    )
    .map((n) => n.id);
  const safe = new Set<string>();
  for (let index = 0; index < finished.length; index++) {
    const id = finished[index];
    if (safe.has(id)) continue;
    safe.add(id);
    for (const parent of incoming.get(id) ?? []) {
      if (!reachable.has(parent)) continue;
      const remaining = (pending.get(parent) ?? 0) - 1;
      pending.set(parent, remaining);
      if (remaining === 0) finished.push(parent);
    }
  }
  const allPathsReachEnding =
    !!project.startNodeId &&
    reachable.size > 0 &&
    [...reachable].every((id) => nodes.has(id) && safe.has(id));
  if (!allPathsReachEnding)
    errors.push("存在循环、断路或未到达结局的播放路线，请连接到明确的结局节点");
  return { valid: !errors.length, errors, warnings, allPathsReachEnding, assetsReady, assetsTotal };
}

/** The immutable public snapshot contains only reachable playback data. */
export function playbackProject(project: StoryProject): StoryProject {
  project = resolveShotOutputs(project);
  const reachable = reachableNodeIds(project);
  const nodes = project.nodes
    .filter((n) => reachable.has(n.id))
    .map((n) => {
      const {
        nodeType,
        title,
        description,
        videoUrl,
        audioUrl,
        clipEnd,
        duration,
        interactionAt,
        question,
        timeoutSecs,
        variable,
        operator,
        value,
        conditions,
        conditionMode,
        label,
        segments,
      } = n.data;
      return {
        id: n.id,
        type: n.type,
        position: n.position,
        data: {
          nodeType,
          title,
          description,
          videoUrl,
          audioUrl,
          clipEnd,
          duration,
          interactionAt,
          question,
          timeoutSecs,
          variable,
          operator,
          value,
          conditions,
          conditionMode,
          label,
          segments: Array.isArray(segments)
            ? (segments as ShotSegment[]).map((segment) => omit(segment, ["sourceRevision"]))
            : undefined,
        },
      };
    });
  const edges = storyEdges(project.nodes, project.edges)
    .filter((e) => reachable.has(e.source) && reachable.has(e.target))
    .map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      data: {
        kind: "flow" as const,
        choiceLabel: e.data?.choiceLabel,
        condition: e.data?.condition,
        setVariables: e.data?.setVariables,
        variableOperations: e.data?.variableOperations,
      },
    }));
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    startNodeId: project.startNodeId,
    initialVariables: project.initialVariables,
    nodes: nodes as StoryProject["nodes"],
    edges,
  };
}

/** Bounded diagnostic path listing; publication validation uses graph reduction above. */
export function allPaths(project: StoryProject): Array<{ path: string[]; ending: string | null }> {
  const nodes = new Map(project.nodes.map((n) => [n.id, n]));
  const edges = storyEdges(project.nodes, project.edges);
  const result: Array<{ path: string[]; ending: string | null }> = [];
  const stack = project.startNodeId ? [{ id: project.startNodeId, path: [] as string[] }] : [];
  while (stack.length && result.length < 1000) {
    const { id, path } = stack.pop()!;
    const nextPath = [...path, id];
    if (path.includes(id) || !nodes.has(id)) {
      result.push({ path: nextPath, ending: null });
      continue;
    }
    if (nodes.get(id)!.data.nodeType === "ending") {
      result.push({ path: nextPath, ending: id });
      continue;
    }
    const next = edges.filter((e) => e.source === id);
    if (!next.length) result.push({ path: nextPath, ending: null });
    for (const edge of next) stack.push({ id: edge.target, path: nextPath });
  }
  if (stack.length) result.push({ path: [], ending: null });
  return result;
}
