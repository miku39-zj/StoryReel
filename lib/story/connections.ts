import type {
  StoryFlowNode,
  StoryFlowEdge,
  StoryEdgeData,
  InputRole,
  VideoNodeData,
} from "./types";

export const INPUT_LABELS: Record<InputRole, string> = {
  prompt: "提示词",
  "first-frame": "首帧",
  "last-frame": "尾帧",
  "reference-image": "参考图",
  "reference-video": "参考视频",
};

/** Use the same port interpretation for validation and committing a drag connection. */
export function connectionPortData(handle: string | null | undefined): StoryEdgeData {
  if (handle === "first-frame" || handle === "last-frame")
    return { kind: "context", inputRole: handle };
  return { kind: handle === "context" ? "context" : "flow" };
}

export function isContextEdge(edge: StoryFlowEdge, nodes: StoryFlowNode[]): boolean {
  if (edge.data?.kind) return edge.data.kind === "context";
  const source = nodes.find((n) => n.id === edge.source)?.type;
  const target = nodes.find((n) => n.id === edge.target)?.type;
  return (
    (source === "text" && (target === "image" || target === "video")) ||
    (source === "image" && (target === "video" || target === "image"))
  );
}

export function inputRole(edge: StoryFlowEdge, nodes: StoryFlowNode[]): InputRole {
  if (edge.data?.inputRole) return edge.data.inputRole;
  const source = nodes.find((n) => n.id === edge.source);
  if (source?.type === "text") return "prompt";
  if (nodes.find((n) => n.id === edge.target)?.type === "image") return "reference-image";
  if (source?.type === "video") return "reference-video";
  const target = nodes.find((n) => n.id === edge.target);
  if (source?.data.imageUrl && source.data.imageUrl === target?.data.firstFrameUrl)
    return "first-frame";
  if (source?.data.imageUrl && source.data.imageUrl === target?.data.lastFrameUrl)
    return "last-frame";
  const role = source?.data.seedanceRole;
  return role === "first_frame"
    ? "first-frame"
    : role === "last_frame"
      ? "last-frame"
      : "reference-image";
}

export function normalizeConnections(nodes: StoryFlowNode[], edges: StoryFlowEdge[]) {
  return edges.map((edge) =>
    isContextEdge(edge, nodes)
      ? {
          ...edge,
          data: { ...edge.data, kind: "context" as const, inputRole: inputRole(edge, nodes) },
        }
      : edge,
  );
}

export function storyEdges(nodes: StoryFlowNode[], edges: StoryFlowEdge[]) {
  return edges.filter((edge) => !isContextEdge(edge, nodes));
}

export function connectionError(
  source: StoryFlowNode | undefined,
  target: StoryFlowNode | undefined,
  edges: StoryFlowEdge[],
  nodes: StoryFlowNode[],
  data: StoryEdgeData,
): string | null {
  if (!source || !target) return "找不到要连接的节点。";
  if (source.id === target.id) return "节点不能连接到自身。";
  const context = data.kind === "context";
  if (context) {
    const role = data.inputRole;
    const valid =
      (source.type === "text" && ["image", "video"].includes(target.type!) && role === "prompt") ||
      (source.type === "image" &&
        ((target.type === "video" &&
          ["first-frame", "last-frame", "reference-image"].includes(role!)) ||
          (target.type === "image" && role === "reference-image"))) ||
      (source.type === "video" && target.type === "video" && role === "reference-video");
    if (!valid) return "这两个节点不支持这种素材输入。";
    if (
      (role === "first-frame" || role === "last-frame") &&
      edges.some(
        (e) => e.target === target.id && isContextEdge(e, nodes) && inputRole(e, nodes) === role,
      )
    )
      return `${INPUT_LABELS[role]}只能连接一张图片。`;
    // Context inputs form a DAG. Storytelling loops remain allowed on flow edges.
    const pending = [target.id];
    const visited = new Set<string>();
    while (pending.length) {
      const id = pending.pop()!;
      if (id === source.id) return "素材输入不能形成循环引用。";
      if (visited.has(id)) continue;
      visited.add(id);
      edges
        .filter((e) => e.source === id && isContextEdge(e, nodes))
        .forEach((e) => pending.push(e.target));
    }
  } else if (
    ["text", "image", "ending"].includes(source.type!) ||
    ["text", "image"].includes(target.type!)
  ) {
    return "图片和文本应连接到素材输入端口。";
  }
  if (
    edges.some(
      (e) =>
        e.source === source.id &&
        e.target === target.id &&
        isContextEdge(e, nodes) === context &&
        (context
          ? inputRole(e, nodes) === data.inputRole
          : e.data?.choiceLabel === data.choiceLabel && e.data?.condition === data.condition),
    )
  )
    return "这条连接已经存在。";
  return null;
}

export function proposeConnection(
  sourceId: string,
  targetId: string,
  nodes: StoryFlowNode[],
  edges: StoryFlowEdge[],
  patch: StoryEdgeData = {},
) {
  const source = nodes.find((n) => n.id === sourceId);
  const target = nodes.find((n) => n.id === targetId);
  const kind =
    patch.kind ?? (source?.type === "text" || source?.type === "image" ? "context" : "flow");
  const data: StoryEdgeData = { ...patch, kind };
  if (kind === "context")
    data.inputRole ??= inputRole({ source: sourceId, target: targetId, id: "" }, nodes);
  return { data, error: connectionError(source, target, edges, nodes, data) };
}

export function connectedInputs(nodeId: string, nodes: StoryFlowNode[], edges: StoryFlowEdge[]) {
  return edges
    .filter((e) => e.target === nodeId && isContextEdge(e, nodes))
    .flatMap((edge) => {
      const source = nodes.find((n) => n.id === edge.source);
      return source ? [{ edge, source, role: inputRole(edge, nodes) }] : [];
    });
}

export function resolvePrompt(
  nodeId: string,
  nodes: StoryFlowNode[],
  edges: StoryFlowEdge[],
  extra = "",
) {
  const texts = connectedInputs(nodeId, nodes, edges)
    .filter((i) => i.role === "prompt")
    .map((i) => String(i.source.data.content || "").trim())
    .filter(Boolean);
  return [...texts, extra.trim()].filter(Boolean).join("\n\n");
}

export function resolveVideoInputs(nodeId: string, nodes: StoryFlowNode[], edges: StoryFlowEdge[]) {
  const node = nodes.find((n) => n.id === nodeId);
  const data = node?.data as VideoNodeData | undefined;
  const inputs = connectedInputs(nodeId, nodes, edges);
  const errors: string[] = [];
  const urls = (role: InputRole) =>
    inputs
      .filter((i) => i.role === role)
      .flatMap((i) => {
        const value = role === "reference-video" ? i.source.data.videoUrl : i.source.data.imageUrl;
        if (!value)
          errors.push(
            `「${String(i.source.data.title || "输入素材")}」还没有${role === "reference-video" ? "视频" : "图片"}。`,
          );
        return typeof value === "string" && value ? [value] : [];
      });
  const firstFrames = urls("first-frame");
  const lastFrames = urls("last-frame");
  const referenceImageUrls = [
    ...new Set([...urls("reference-image"), ...(data?.referenceImageUrls ?? [])]),
  ];
  const referenceVideoUrls = [
    ...new Set([...urls("reference-video"), ...(data?.referenceVideoUrls ?? [])]),
  ];
  const firstFrameUrl = inputs.some((i) => i.role === "first-frame")
    ? firstFrames[0]
    : data?.firstFrameUrl;
  const lastFrameUrl = inputs.some((i) => i.role === "last-frame")
    ? lastFrames[0]
    : data?.lastFrameUrl;
  const hasReferences =
    inputs.some((i) => i.role === "reference-image" || i.role === "reference-video") ||
    referenceImageUrls.length > 0 ||
    referenceVideoUrls.length > 0;
  const hasFirstFrame = inputs.some((i) => i.role === "first-frame") || !!firstFrameUrl;
  const hasLastFrame = inputs.some((i) => i.role === "last-frame") || !!lastFrameUrl;
  const mode = hasReferences
    ? "reference-to-video"
    : hasLastFrame
      ? "first-last-frame"
      : hasFirstFrame
        ? "image-to-video"
        : (data?.seedanceMode ?? "text-to-video");
  const prompt = resolvePrompt(nodeId, nodes, edges, data?.scenePrompt || "") || data?.title || "";
  inputs
    .filter((i) => i.role === "prompt" && !String(i.source.data.content || "").trim())
    .forEach((i) => errors.push(`「${String(i.source.data.title)}」还没有文本内容。`));
  if (hasReferences && (hasFirstFrame || hasLastFrame))
    errors.push("首尾帧与参考素材不能混用，请调整图片的输入用途。");
  if ((mode === "image-to-video" || mode === "first-last-frame") && !firstFrameUrl)
    errors.push("请连接一张首帧图片。");
  if (mode === "first-last-frame" && !lastFrameUrl) errors.push("请连接一张尾帧图片。");
  if (mode === "reference-to-video" && !referenceImageUrls.length && !referenceVideoUrls.length)
    errors.push("请连接参考图片或视频。");
  if (referenceImageUrls.length > 9 || referenceVideoUrls.length > 3)
    errors.push("最多使用 9 张参考图和 3 段参考视频。");
  return {
    prompt,
    mode,
    firstFrameUrl,
    lastFrameUrl,
    referenceImageUrls,
    referenceVideoUrls,
    model:
      hasReferences || lastFrameUrl
        ? ("seedance-2-0" as const)
        : (data?.seedanceModel ?? ("seedance-2-0" as const)),
    inputs,
    errors,
  };
}

/** Images accept text instructions and reference pictures; video-only roles stay on video nodes. */
export function resolveImageInputs(nodeId: string, nodes: StoryFlowNode[], edges: StoryFlowEdge[]) {
  const node = nodes.find((n) => n.id === nodeId);
  if (node?.type !== "image") throw new Error("请选择图片节点");
  const inputs = connectedInputs(nodeId, nodes, edges);
  if (
    inputs.some(
      (input) => input.role === "prompt" && !String(input.source.data.content || "").trim(),
    )
  )
    throw new Error("上游文本节点尚未填写内容");
  const images = inputs.filter((input) => input.role === "reference-image");
  if (images.length > 4) throw new Error("图片生成最多使用 4 张参考图");
  if (images.some((input) => !input.source.data.imageUrl))
    throw new Error("参考图片尚未就绪，请先生成或上传参考图");
  return {
    prompt: resolvePrompt(nodeId, nodes, edges, String(node.data.prompt || "")),
    referenceImageUrls: images.map((input) => String(input.source.data.imageUrl)),
  };
}
