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
        prompt: `Environment reference for ${scene.title}. Use this scene description as context: ${scene.scenePrompt || scene.description}. Show one wide establishing view of the environment. Make entrances, landmarks, spatial layout, lighting direction and palette clear enough to match from other angles. Empty environment, no people, no character action, no text. Visual style: ${project.creation?.storyOutline?.visualStyle ?? "cinematic"}.`,
        generationStatus: "idle",
      },
    });
  }
  return { ...project, nodes };
}
