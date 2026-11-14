import type { StoryProject } from "@/lib/story/types";
import { isContextEdge } from "@/lib/story/connections";
import { mainVideoNode } from "@/lib/canvas/shot-workspace";

export function splitShotAtImage(
  project: StoryProject,
  shotId: string,
  imageId: string,
  nextId: string,
): StoryProject {
  const creation = project.creation;
  const shot = creation?.storyboardShots.find((item) => item.shotId === shotId);
  const main = mainVideoNode(project, shotId);
  const route = project.nodes.find(
    (node) => node.type === "video" && node.data.productionShotId === shotId,
  );
  const image = project.nodes.find((node) => node.id === imageId && node.type === "image");
  if (!creation || !shot || !main || !route || !image?.data.imageUrl)
    throw new Error("请先准备镜头和中间关键画面");
  const inputs = project.edges.filter(
    (edge) => edge.target === main.id && isContextEdge(edge, project.nodes),
  );
  const references = inputs.filter((edge) => edge.data?.inputRole === "reference-image");
  const middleIndex = references.findIndex((edge) => edge.source === imageId);
  const first = references[0];
  const last = references.at(-1);
  const opening = project.nodes.find((node) => node.id === first?.source);
  if (middleIndex <= 0 || !first || first.source === imageId || !opening?.data.imageUrl)
    throw new Error("请先连接起始画面，并把分割画面排在它之后");
  const nextVideoId = `shot_video:${nextId}`;
  const boundaryId = `split_frame:${nextId}`;
  if (route.data.interactionAt !== undefined || main.data.interactionAt !== undefined)
    throw new Error("请先将镜内选择移到片段出点，再拆分镜头");
  const firstDuration = shot.duration / 2;
  const nextShot = {
    ...shot,
    shotId: nextId,
    shotIndex: shot.shotIndex + 1,
    duration: shot.duration - firstDuration,
    dialogue: undefined,
    firstFrameId: undefined,
  };
  const frameLink = (source: string, target: string, role: "first-frame" | "last-frame") => ({
    id: `shot_input:${source}:${target}:${role}`,
    source,
    target,
    data: { kind: "context" as const, inputRole: role },
  });
  const splitFrame = {
    ...image,
    id: boundaryId,
    data: {
      ...image.data,
      title: "分割点首帧",
      canvasShotId: nextId,
      generationFingerprint: undefined,
    },
  };
  return {
    ...project,
    creation: {
      ...creation,
      storyboardShots: creation.storyboardShots.flatMap((item) => {
        if (item.shotId === shotId)
          return [{ ...item, duration: firstDuration, lastFrameId: undefined }, nextShot];
        return [
          {
            ...item,
            shotIndex:
              item.sceneId === shot.sceneId && item.shotIndex > shot.shotIndex
                ? item.shotIndex + 1
                : item.shotIndex,
          },
        ];
      }),
    },
    nodes: [
      ...project.nodes.map((node) =>
        node.id === main.id
          ? {
              ...node,
              data: {
                ...node.data,
                seedanceMode: "first-last-frame" as const,
                firstFrameUrl: undefined,
                lastFrameUrl: undefined,
                referenceImageUrls: undefined,
                referenceVideoUrls: undefined,
              },
            }
          : node,
      ),
      splitFrame,
      {
        id: nextVideoId,
        type: "video",
        position: { x: route.position.x + 420, y: route.position.y },
        data: {
          nodeType: "video",
          productionShotId: nextId,
          shotSceneId: shot.sceneId,
          title: `${String(main.data.title)} · 后半段`,
          scenePrompt: shot.action,
          seedanceMode: last?.source !== imageId ? "first-last-frame" : "image-to-video",
          seedanceDuration: 5,
        },
      },
      ...(last && last.source !== imageId
        ? project.nodes
            .filter((node) => node.id === last.source)
            .map((node) => ({
              ...node,
              id: `split_tail:${nextId}`,
              data: {
                ...node.data,
                productionShotId: undefined,
                canvasShotId: nextId,
                generationFingerprint: undefined,
              },
            }))
        : []),
    ],
    edges: [
      ...project.edges
        .filter((edge) => !inputs.includes(edge) || edge.data?.inputRole === "prompt")
        .map((edge) =>
          edge.source === route.id && !isContextEdge(edge, project.nodes)
            ? { ...edge, source: nextVideoId }
            : edge,
        ),
      frameLink(first.source, main.id, "first-frame"),
      frameLink(imageId, main.id, "last-frame"),
      frameLink(boundaryId, nextVideoId, "first-frame"),
      ...(last && last.source !== imageId
        ? [frameLink(`split_tail:${nextId}`, nextVideoId, "last-frame")]
        : []),
      {
        id: `shot_input:${route.id}:${nextVideoId}`,
        source: route.id,
        target: nextVideoId,
        data: { kind: "flow" },
      },
    ],
    shotWorkspaces: {
      ...project.shotWorkspaces,
      [nextId]: { initialized: true, mainVideoNodeId: nextVideoId },
    },
  };
}
