import { continuityFields, sceneContinuity } from "@/lib/story/continuity";
import { precedingVideos, videoOutpoint } from "./shot-continuity";
import { omit } from "@/lib/omit";
import type { StoryProject, StoryFlowNode } from "@/lib/story/types";
import {
  isContextEdge,
  resolveImageInputs,
  resolvePrompt,
  resolveVideoInputs,
  storyEdges,
} from "@/lib/story/connections";

/** Context is labelled by route: mutually exclusive predecessors are not presented as one history. */
export function storyContext(project: StoryProject, nodeId: string) {
  const flow = storyEdges(project.nodes, project.edges);
  const seen = new Set<string>([nodeId]),
    queue = [nodeId];
  for (let i = 0; i < queue.length; i++)
    for (const e of flow.filter((e) => e.target === queue[i]))
      if (!seen.has(e.source)) {
        seen.add(e.source);
        queue.push(e.source);
      }
  const relevant = project.nodes.filter((n) => seen.has(n.id));
  return {
    title: project.storyContextTitle ?? project.name,
    description: project.description ?? "",
    story: project.creation?.storyOutline ?? null,
    initialVariables: project.initialVariables ?? {},
    ...(typeof nodeId === "string" &&
      (() => {
        const node = project.nodes.find((item) => item.id === nodeId);
        const shotId = node?.data.canvasShotId ?? node?.data.productionShotId;
        const sceneId =
          node?.data.shotSceneId ??
          project.creation?.storyboardShots?.find((item) => item.shotId === shotId)?.sceneId;
        if (typeof sceneId !== "string") return {};
        const { entry } = sceneContinuity(project, sceneId);
        const continuity = Object.fromEntries(
          Object.entries(entry).map(([key, value]) => [
            continuityFields[key as keyof typeof continuityFields],
            value,
          ]),
        );
        return Object.keys(continuity).length ? { continuity } : {};
      })()),
    instructions: "前置节点可能来自互斥路线，不要把不同分支当作同时发生。保持已有角色与世界设定。",
    predecessors: relevant
      .filter((n) => n.id !== nodeId)
      .map((n) => ({
        id: n.id,
        type: n.type,
        title: n.data.title,
        description: n.data.description,
        scenePrompt: n.data.scenePrompt,
        question: n.data.question,
      })),
    referenceAssets: project.edges
      .filter((e) => e.target === nodeId && isContextEdge(e, project.nodes))
      .map((e) => project.nodes.find((n) => n.id === e.source))
      .filter((n) => n?.data.assetKind === "character" || n?.data.assetKind === "scene")
      .map((n) => ({
        id: n!.id,
        kind: n!.data.assetKind,
        name: n!.data.title,
        description: n!.data.assetDescription,
      })),
    routes: flow
      .filter((e) => seen.has(e.source) && seen.has(e.target))
      .map((e) => ({ from: e.source, to: e.target, ...e.data })),
  };
}
export function generationInput(project: StoryProject, nodeId: string) {
  const node = project.nodes.find((n) => n.id === nodeId);
  if (!node || !["image", "video"].includes(node.type!)) throw new Error("请选择图片或视频节点");
  if (node.data.outpointSourceId && isStale(project, node))
    throw new Error("前置视频或出点已变更，请重新截取首帧");
  const context = storyContext(project, nodeId);
  const input =
    node.type === "video" ? resolveVideoInputs(nodeId, project.nodes, project.edges) : null;
  const imageInput =
    node.type === "image" ? resolveImageInputs(nodeId, project.nodes, project.edges) : undefined;
  if (input?.errors.length) throw new Error(input.errors.join("\n"));
  const base =
    (input?.prompt ??
      imageInput?.prompt ??
      resolvePrompt(nodeId, project.nodes, project.edges, String(node.data.prompt || ""))) +
    (node.data.assetDescription ? `\n固定设定：${node.data.assetDescription}` : "");
  if (!base.trim()) throw new Error("请填写提示词或连接文本节点");
  const middle =
    input?.inputs.filter(
      (item) => item.role === "reference-image" && item.source.data.middleKeyImage,
    ) ?? [];
  const ordered = middle.map((item) => {
    const index = input?.referenceImageUrls.indexOf(String(item.source.data.imageUrl)) ?? -1;
    return `参考图 ${index + 1}：${item.source.data.title}`;
  });
  const direction =
    input?.mode === "first-last-frame"
      ? "从提供的首帧出发，按描述完成动作和运镜，落在提供的尾帧。保持角色、服装、道具和场景空间连续。"
      : input?.mode === "image-to-video"
        ? "从提供的首帧延续动作与运镜，保持人物身份、道具位置与场景空间连续。"
        : input?.mode === "reference-to-video"
          ? "按动作和运镜描述生成视频，保持素材中的角色、场景与道具特征。中间画面按给定顺序参考。"
          : "";
  return {
    kind: node.type as "image" | "video",
    ...(imageInput?.referenceImageUrls.length
      ? { referenceImageUrls: imageInput.referenceImageUrls }
      : {}),
    prompt: `${base}${direction ? `\n${direction}` : ""}${ordered.length ? `\n按以下顺序参考中间画面：${ordered.join("；")}` : ""}\n\n故事上下文：${JSON.stringify(context)}`,
    ...(input
      ? {
          mode: input.mode,
          model: input.model,
          firstFrameUrl: input.firstFrameUrl,
          lastFrameUrl: input.lastFrameUrl,
          referenceImageUrls: input.referenceImageUrls,
          referenceVideoUrls: input.referenceVideoUrls,
        }
      : {}),
    duration: node.data.seedanceDuration,
    aspectRatio: node.data.seedanceAspectRatio,
    resolution: node.data.seedanceResolution,
    generateAudio: node.data.generateAudio,
    style: node.data.style,
  };
}
function inputFingerprint(project: StoryProject, nodeId: string, canonical: boolean): string {
  const seen = new Set<string>();
  function source(id: string): unknown {
    if (seen.has(id)) return { id };
    seen.add(id);
    const n = project.nodes.find((n) => n.id === id);
    if (!n) return { id, missing: true };
    const data = omit(n.data, [
      "generationStatus",
      "generationError",
      "generationFingerprint",
      "generationJobId",
      "generationVersions",
      "groupLabel",
    ]);
    // A node's own result is not one of its generation inputs.
    if (id === nodeId) {
      delete data.imageUrl;
      delete data.videoUrl;
      delete data.thumbnailUrl;
      delete data.segments;
      delete data.audioUrl;
      delete data.duration;
    }
    return {
      id,
      data,
      inputs: project.edges
        .filter((e) => e.target === id && isContextEdge(e, project.nodes))
        .map((e) => ({ role: e.data?.inputRole, source: source(e.source) })),
    };
  }
  const input = { source: source(nodeId), context: storyContext(project, nodeId) };
  const value = canonical
    ? JSON.stringify(input, (_key, value) =>
        value && typeof value === "object" && !Array.isArray(value)
          ? Object.fromEntries(
              Object.keys(value)
                .sort()
                .map((key) => [key, value[key]]),
            )
          : value,
      )
    : JSON.stringify(input);
  let a = 2166136261;
  for (let i = 0; i < value.length; i++) a = Math.imul(a ^ value.charCodeAt(i), 16777619);
  return `${value.length}:${a >>> 0}`;
}
/** V2 hashes semantic JSON values, independent of API/schema property insertion order. */
export function fingerprint(project: StoryProject, nodeId: string) {
  return `v2:${inputFingerprint(project, nodeId, true)}`;
}
export function legacyFingerprint(project: StoryProject, nodeId: string) {
  return inputFingerprint(project, nodeId, false);
}
function staleOutpoint(project: StoryProject, node: StoryFlowNode) {
  if (typeof node.data.outpointSourceId !== "string") return false;
  const edge = project.edges.find(
    (item) => item.source === node.id && item.data?.inputRole === "first-frame",
  );
  const target = project.nodes.find((item) => item.id === edge?.target);
  const routeNode = target?.data.canvasShotId
    ? project.nodes.find(
        (item) => item.type === "video" && item.data.productionShotId === target.data.canvasShotId,
      )
    : target;
  const source =
    routeNode &&
    precedingVideos(project, routeNode.id).find((item) => item.id === node.data.outpointSourceId);
  const outpoint = source && videoOutpoint(source.data);
  if (
    !outpoint?.url ||
    outpoint.url !== node.data.outpointVideoUrl ||
    outpoint.end !== node.data.outpointEnd
  )
    return true;
  return false;
}
export function isStale(project: StoryProject, node: StoryFlowNode) {
  if (staleOutpoint(project, node)) return true;
  if (
    node.type === "video" &&
    project.edges.some(
      (edge) =>
        edge.target === node.id &&
        edge.data?.inputRole === "first-frame" &&
        project.nodes.some((source) => source.id === edge.source && staleOutpoint(project, source)),
    )
  )
    return true;
  const saved = node.data.generationFingerprint;
  return (
    typeof saved === "string" &&
    saved !==
      (saved.startsWith("v2:")
        ? fingerprint(project, node.id)
        : legacyFingerprint(project, node.id))
  );
}
export function generationPlan(project: StoryProject, targets: string[]) {
  const result: string[] = [],
    seen = new Set<string>(),
    active = new Set<string>();
  function visit(id: string, force = false) {
    if (active.has(id)) throw new Error("素材依赖存在循环");
    if (seen.has(id)) return;
    const node = project.nodes.find((n) => n.id === id);
    if (!node) throw new Error("依赖节点已删除");
    active.add(id);
    for (const e of project.edges.filter((e) => e.target === id && isContextEdge(e, project.nodes)))
      visit(e.source);
    active.delete(id);
    seen.add(id);
    if (
      ["image", "video"].includes(node.type!) &&
      (force ||
        targets.includes(id) ||
        isStale(project, node) ||
        !(node.data.imageUrl || node.data.videoUrl))
    )
      result.push(id);
  }
  targets.forEach((id) => visit(id, true));
  return result;
}

/** Existing imported media becomes the baseline; later input edits are still detectable. */
export function baselineMedia(project: StoryProject): StoryProject {
  return {
    ...project,
    nodes: project.nodes.map((node) =>
      ["image", "video"].includes(node.type!) &&
      (node.data.imageUrl || node.data.videoUrl) &&
      !node.data.generationFingerprint
        ? { ...node, data: { ...node.data, generationFingerprint: fingerprint(project, node.id) } }
        : node,
    ),
  };
}
