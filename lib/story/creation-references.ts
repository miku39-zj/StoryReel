import type { CreationBrief } from "./creation-brief";
import type { StoryProject } from "./types";

/** References belong to the project, not to a newly created project per selection. */
export function attachCreationReferences(
  project: StoryProject,
  brief: CreationBrief,
): StoryProject {
  return {
    ...project,
    nodes: [
      ...project.nodes,
      ...brief.references
        .filter((ref) => !project.nodes.some((n) => n.id === `reference_${ref.id}`))
        .map((ref, index) => ({
          id: `reference_${ref.id}`,
          type: "image" as const,
          position: { x: -360, y: index * 300 },
          data: {
            nodeType: "image" as const,
            title: ref.name,
            imageUrl: ref.url,
            prompt: ref.description,
            generationStatus: "done" as const,
          },
        })),
    ],
  };
}
