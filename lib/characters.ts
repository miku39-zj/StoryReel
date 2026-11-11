import { z } from "zod";
import type { StoryProject } from "./story/types";

export const characterSchema = z.object({
  id: z.string().regex(/^[\w-]{1,100}$/),
  revision: z.number().int().positive(),
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().min(1).max(10000),
  imageUrl: z
    .string()
    .regex(/^(\/api\/media\/[\w-]+|https?:\/\/[^\s]+)$/)
    .optional(),
  style: z.enum(["cinematic", "anime", "realistic", "illustration"]).optional(),
});
export type CharacterAsset = z.infer<typeof characterSchema>;
export type SavedCharacter = CharacterAsset & { createdAt: string; updatedAt: string };
export const saveCharacterSchema = characterSchema.omit({ id: true, revision: true }).extend({
  id: z
    .string()
    .regex(/^[\w-]{1,100}$/)
    .optional(),
  revision: z.number().int().nonnegative().optional(),
});

/** Import a versioned snapshot; subsequent library edits never silently alter an existing story. */
export function addCharacterToProject(project: StoryProject, asset: CharacterAsset): StoryProject {
  if (project.nodes.some((n) => n.data.characterAssetId === asset.id)) return project;
  const existing = project.nodes.find(
    (n) =>
      n.type === "image" &&
      n.data.assetKind === "character" &&
      !n.data.characterAssetId &&
      (n.data.characterName === asset.name || n.data.title === asset.name),
  );
  let id = existing?.id ?? `cast_${asset.id}`;
  while (!existing && project.nodes.some((n) => n.id === id)) id += "_copy";
  return {
    ...project,
    nodes: [
      ...project.nodes.filter((n) => n.id !== existing?.id),
      {
        id,
        type: "image",
        position: existing?.position ?? {
          x: -800,
          y: project.nodes.filter((n) => n.data.assetKind === "character").length * 340,
        },
        data: {
          nodeType: "image",
          title: asset.name,
          characterName: asset.name,
          assetKind: "character",
          characterAssetId: asset.id,
          characterAssetRevision: asset.revision,
          assetDescription: asset.description,
          prompt: `Character design reference. ${asset.name}. Preserve the fixed appearance and wardrobe. Neutral background.`,
          imageUrl: asset.imageUrl,
          style: asset.style,
          generationStatus: asset.imageUrl ? "done" : "idle",
        },
      },
    ],
  };
}
