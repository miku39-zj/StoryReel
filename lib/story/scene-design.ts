import type { StoryProject } from "./types";

/** Scene references are environment assets; shot frames continue to live in the production ledger. */
export function initializeSceneAssets(project: StoryProject): StoryProject {
  const nodes = [...project.nodes];
  for (const [index, scene] of (project.creation?.storyOutline?.scenes ?? []).entries()) {
    const id = `scene_reference_${scene.id}`;
    if (nodes.some((node) => node.id === id)) continue;
    nodes.push({
      id,
      type: "image",
      position: { x: -1200, y: index * 340 },
      data: {
        nodeType: "image",
        assetKind: "scene",
        title: scene.title,
        assetDescription: "",
        prompt: `Environment reference for ${scene.title}. Establish architecture, landscape, spatial layout, lighting and color palette. Empty environment, no people, no character action, no text. Visual style: ${project.creation?.storyOutline?.visualStyle ?? "cinematic"}.`,
        generationStatus: "idle",
      },
    });
  }
  return { ...project, nodes };
}
