import { addCharacterToProject } from "../characters";
import type { StoryProject, StoryFlowNode } from "./types";
import { connectedInputs, proposeConnection } from "./connections";

/** Character reference nodes are the shared source of truth for authoring and generation. */
export function initializeCharacterAssets(project: StoryProject): StoryProject {
  for (const character of project.creation?.brief?.characters ?? [])
    project = addCharacterToProject(project, character);
  const nodes = [...project.nodes];
  for (const [index, character] of (project.creation?.storyOutline?.characters ?? []).entries()) {
    if (
      nodes.some(
        (n) =>
          n.type === "image" &&
          n.data.assetKind === "character" &&
          (n.data.characterName === character.name || n.data.title === character.name),
      )
    )
      continue;
    let id = `character_${index}`;
    while (nodes.some((n) => n.id === id)) id += "_ref";
    nodes.push({
      id,
      type: "image",
      position: { x: -800, y: index * 340 },
      data: {
        nodeType: "image",
        title: character.name,
        characterName: character.name,
        assetKind: "character",
        assetDescription: character.description,
        prompt: `Character design reference sheet. One fictional character: ${character.name}. Use the fixed character description to preserve face, hair, body proportions, wardrobe and signature accessories across views. Show a front and a three-quarter view with matching proportions, clear face and full outfit under even lighting against a neutral background. Visual style: ${project.creation?.storyOutline?.visualStyle ?? "cinematic"}. No scene action, no captions.`,
        generationStatus: "idle",
      },
    });
  }
  return { ...project, nodes };
}
/** Build independent first/last image nodes; never replace existing selected images or video. */
export function createSceneFrameInputs(
  project: StoryProject,
  videoId: string,
  characterIds: string[],
  sceneIds?: string[],
): StoryProject {
  const video = project.nodes.find((n) => n.id === videoId && n.type === "video");
  if (!video) throw new Error("请选择剧情视频节点");
  const retainedScenes =
    sceneIds ??
    connectedInputs(videoId, project.nodes, project.edges)
      .flatMap((input) => connectedInputs(input.source.id, project.nodes, project.edges))
      .filter((input) => input.source.data.assetKind === "scene")
      .map((input) => input.source.id);
  const referenceIds = [...new Set([...characterIds, ...retainedScenes])];
  const characters = referenceIds.map((id) =>
    project.nodes.find(
      (n) =>
        n.id === id &&
        n.type === "image" &&
        ["character", "scene"].includes(String(n.data.assetKind)),
    ),
  );
  if (characters.some((n) => !n)) throw new Error("角色或场景参考不存在");
  if (characters.length > 4) throw new Error("每个画面最多选择 4 张角色和场景参考图");
  const nodes = [...project.nodes];
  let edges = [...project.edges];
  const existing = connectedInputs(videoId, nodes, edges);
  if (
    existing.some((input) => input.role === "reference-image" || input.role === "reference-video")
  )
    throw new Error("此视频使用多素材参考模式。请先把参考图改连到首尾帧图片节点，再切换首尾帧模式");
  for (const [index, role] of (["first-frame", "last-frame"] as const).entries()) {
    const current = existing.find((input) => input.role === role);
    if (current) {
      const old = connectedInputs(current.source.id, nodes, edges).filter((input) =>
        ["character", "scene"].includes(String(input.source.data.assetKind)),
      );
      if (
        old.length === referenceIds.length &&
        old.every((input) => referenceIds.includes(input.source.id))
      )
        continue;
      edges = edges.filter((edge) => !old.some((input) => input.edge.id === edge.id));
      for (const character of characters) {
        const link = proposeConnection(character!.id, current.source.id, nodes, edges, {
          kind: "context",
          inputRole: "reference-image",
        });
        if (link.error) throw new Error(link.error);
        edges.push({
          id: `reference_${character!.id}_${current.source.id}`,
          source: character!.id,
          target: current.source.id,
          data: link.data,
        });
      }
      continue;
    }
    let id = `${videoId}_${role}`;
    while (nodes.some((n) => n.id === id)) id += "_image";
    const title = `${String(video.data.title)} · ${index ? "尾帧" : "首帧"}`;
    const prompt = `${String(video.data.scenePrompt || video.data.description || video.data.title)}\n${index ? "End frame: show the final pose and outcome of this action." : "First frame: show the starting pose immediately before this action."}\nUse attached character references for identity, face, hair and wardrobe, and scene references for environment, architecture, palette and lighting. Preserve reference continuity while composing the specified action. Do not copy reference-sheet layout. Render one cinematic frame.`;
    nodes.push({
      id,
      type: "image",
      position: { x: video.position.x - 400, y: video.position.y + index * 330 },
      data: {
        nodeType: "image",
        title,
        prompt,
        generationStatus: "idle",
        seedanceAspectRatio: video.data.seedanceAspectRatio ?? "16:9",
      },
    } as StoryFlowNode);
    characters.forEach((character) =>
      edges.push({
        id: `reference_${character!.id}_${id}`,
        source: character!.id,
        target: id,
        data: { kind: "context", inputRole: "reference-image" },
      }),
    );
    edges.push({
      id: `input_${id}_${videoId}`,
      source: id,
      target: videoId,
      data: { kind: "context", inputRole: role },
    });
  }
  return { ...project, nodes, edges };
}
