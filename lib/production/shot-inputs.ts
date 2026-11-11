import type { StoryProject } from "@/lib/story/types";
import { connectedInputs } from "@/lib/story/connections";
import { fingerprint } from "@/lib/canvas/workflow";
import { normalizeShots, type StoryboardShot } from "./shots";

/** Storyboard owns the cast and scene; legacy shots only match explicit names in their action. */
export function storyboardReferenceIds(project: StoryProject, shot: StoryboardShot): string[] {
  const characters = project.creation?.storyOutline?.characters ?? [];
  const names =
    shot.characterNames ??
    characters.filter((c) => shot.action.includes(c.name)).map((c) => c.name);
  const ids = names.map(
    (name) =>
      project.nodes.find(
        (node) =>
          node.type === "image" &&
          node.data.assetKind === "character" &&
          (node.data.characterName === name || node.data.title === name),
      )?.id ?? `missing_character:${name}`,
  );
  const scene = project.creation?.storyOutline?.scenes?.find((scene) => scene.id === shot.sceneId);
  if (scene) {
    const node = project.nodes.find(
      (node) =>
        node.type === "image" &&
        node.data.assetKind === "scene" &&
        (node.id === `scene_reference_${shot.sceneId}` || node.data.sceneId === shot.sceneId),
    );
    ids.push(node?.id ?? `scene_reference_${shot.sceneId}`);
  }
  return [...new Set(ids)];
}

/** Resolve explicit scene/frame bindings for every consumer; never infer a cast from all project roles. */
export function productionShots(project: StoryProject) {
  return normalizeShots(project.creation?.storyboardShots ?? []).map((shot) => {
    const legacyFrames = connectedInputs(
      `video_${shot.sceneId}`,
      project.nodes,
      project.edges,
    ).some((input) => ["first-frame", "last-frame"].includes(input.role));
    const inheritedIds =
      shot.characterNames === undefined && legacyFrames
        ? []
        : storyboardReferenceIds(project, shot);
    const referenceIds = shot.referenceNodeIds ?? (inheritedIds.length ? inheritedIds : undefined);
    // Explicit per-shot bindings override legacy scene bindings, including an empty selection.
    if (referenceIds !== undefined) {
      return {
        ...shot,
        referenceImages: [...new Set(referenceIds)].map((id) => {
          const node = project.nodes.find(
            (node) =>
              node.id === id &&
              node.type === "image" &&
              ["character", "scene"].includes(String(node.data.assetKind)),
          );
          return {
            nodeId: id,
            url: String(node?.data.imageUrl ?? ""),
            description: node
              ? `${node.data.assetKind === "scene" ? "场景" : "角色"}：${node.data.title}。${node.data.assetDescription ?? node.data.prompt ?? ""}`
              : "参考图已删除",
            revision: node ? fingerprint(project, node.id) : "missing",
          };
        }),
      };
    }
    const sceneId = `video_${shot.sceneId}`;
    const frames = connectedInputs(sceneId, project.nodes, project.edges).filter((input) =>
      ["first-frame", "last-frame"].includes(input.role),
    );
    const references = new Map(
      frames
        .flatMap((frame) => connectedInputs(frame.source.id, project.nodes, project.edges))
        .filter(
          (input) =>
            input.source.type === "image" &&
            ["character", "scene"].includes(String(input.source.data.assetKind)),
        )
        .map((input) => [input.source.id, input.source]),
    );
    if (!references.size) return shot;
    return {
      ...shot,
      referenceImages: [...references.values()].map((node) => ({
        nodeId: node.id,
        url: String(node.data.imageUrl ?? ""),
        description: String(node.data.assetDescription ?? ""),
        revision: fingerprint(project, node.id),
      })),
    };
  });
}
