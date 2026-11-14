import { initializeShotWorkspaces } from "@/lib/canvas/shot-workspace";
import type { StoryProject, StoryFlowNode } from "@/lib/story/types";
import { productionShots } from "./shot-inputs";
import { selectedAsset, type ProductionState } from "./types";
import { fingerprint } from "@/lib/canvas/workflow";
import { shotRevision, imageRevision, videoRevision } from "./shots";

/** Materialize shot inputs without flattening choices or merging unrelated scene frames. */
export function syncShotCanvas(project: StoryProject, state: ProductionState): StoryProject {
  if (project.id !== state.projectId) throw new Error("素材属于其他项目");
  const shots = productionShots(project);
  if (!shots.length) return project;
  const nodes = [...project.nodes];
  let edges = [...project.edges];
  const upsert = (node: StoryFlowNode) => {
    const index = nodes.findIndex((n) => n.id === node.id);
    if (index < 0) nodes.push(node);
    else nodes[index] = node;
  };
  const connect = (
    source: string,
    target: string,
    role?: "prompt" | "first-frame" | "last-frame" | "reference-image",
  ) => {
    const id = `shot_input:${source}:${target}`;
    edges = edges.filter((e) => e.id !== id);
    edges.push({
      id,
      source,
      target,
      targetHandle: role ? "context" : undefined,
      data: role ? { kind: "context", inputRole: role } : { kind: "flow" },
    });
  };
  for (const [row, sceneId] of [...new Set(shots.map((s) => s.sceneId))].entries()) {
    const head = nodes.find((n) => n.id === `video_${sceneId}` && n.type === "video");
    if (!head || head.data.nodeType !== "video") continue;
    const layout = head.data.shotLayoutVersion !== 1;
    if (groupInitialized(project, sceneId)) continue;
    const title = String(head.data.title).replace(/ · 镜头 \d+$/, "");
    const group = shots
      .filter((s) => s.sceneId === sceneId)
      .sort((a, b) => a.shotIndex - b.shotIndex);
    const ids = group.map((s, i) => (i === 0 ? head.id : `shot_video:${s.shotId}`));
    // Move the scene's existing route exits to its final shot. Repeated sync is idempotent.
    const oldIds = new Set(
      nodes.filter((n) => n.type === "video" && n.data.shotSceneId === sceneId).map((n) => n.id),
    );
    oldIds.add(head.id);
    const exits = edges.filter(
      (e) => e.data?.kind !== "context" && oldIds.has(e.source) && !oldIds.has(e.target),
    );
    edges = edges.filter((e) => !(e.data?.kind !== "context" && oldIds.has(e.source)));
    edges.push(...exits.map((e) => ({ ...e, source: ids.at(-1)! })));
    if (layout) {
      const reference = nodes.find((n) => n.id === `scene_reference_${sceneId}`);
      if (reference) upsert({ ...reference, position: { x: -440, y: row * 900 } });
      for (const exit of exits) {
        const target = nodes.find((n) => n.id === exit.target);
        if (target && ["choice", "ending"].includes(target.type!))
          upsert({ ...target, position: { x: group.length * 880, y: row * 900 + 130 } });
      }
    }
    for (const [i, shot] of group.entries()) {
      if (project.shotWorkspaces?.[shot.shotId]?.initialized) continue;
      const imageId = `shot_frame:${shot.shotId}`,
        textId = `shot_text:${shot.shotId}`,
        videoId = ids[i];
      const previousImage = nodes.find((n) => n.id === imageId);
      const previousText = nodes.find((n) => n.id === textId);
      const previousVideo = nodes.find((n) => n.id === videoId);
      const image =
        (shot.firstFrameId && selectedAsset(state, shot.firstFrameId, "image")) ||
        selectedAsset(state, shot.shotId, "image");
      const tail = shot.lastFrameId && selectedAsset(state, shot.lastFrameId, "image");
      const video = selectedAsset(state, shot.shotId, "video");
      const revision = shotRevision(shot);
      const x = i * 880,
        y = row * 900;
      // Only the generated input edges are replaced; user-created connections remain intact.
      edges = edges.filter(
        (e) => !(e.id.startsWith("shot_input:") && [imageId, videoId].includes(e.target)),
      );
      upsert({
        id: imageId,
        type: "image",
        position: !layout && previousImage ? previousImage.position : { x, y },
        data: {
          ...(previousImage?.data.nodeType === "image" ? previousImage.data : {}),
          nodeType: "image",
          title: `${title} · 画面 ${i + 1}`,
          productionShotId: shot.shotId,
          prompt: shot.imagePrompt,
          ...(image
            ? {
                imageUrl: image.url,
                generationStatus: "done" as const,
              }
            : {}),
        },
      });
      upsert({
        id: textId,
        type: "text",
        position: !layout && previousText ? previousText.position : { x, y: y + 270 },
        data: {
          ...(previousText?.data.nodeType === "text" ? previousText.data : {}),
          nodeType: "text",
          title: `${title} · 剧情 ${i + 1}`,
          role: "direction",
          productionShotId: shot.shotId,
          content: `${shot.action}\n景别：${shot.frameType}；运镜：${shot.cameraMove}；光线：${shot.lighting}${shot.dialogue ? `\n对白：${shot.dialogue}` : ""}`,
        },
      });
      upsert({
        id: videoId,
        type: "video",
        position: !layout && previousVideo ? previousVideo.position : { x: x + 420, y: y + 130 },
        data: {
          ...previousVideo?.data,
          nodeType: "video",
          title: `${title} · 镜头 ${i + 1}`,
          productionShotId: shot.shotId,
          productionSourceRevision: revision,
          shotSceneId: sceneId,
          shotLayoutVersion: 1,
          scenePrompt: "",
          segments: undefined,
          ...(head.data.segments?.[i]
            ? {
                videoUrl: head.data.segments[i].videoUrl,
                audioUrl: head.data.segments[i].audioUrl,
                clipEnd: head.data.segments[i].duration,
              }
            : {}),
          seedanceDuration: shot.duration <= 5 ? 5 : shot.duration <= 8 ? 8 : 10,
          ...(video && [revision, videoRevision(shot)].includes(video.sourceRevision)
            ? { videoUrl: video.url, generationStatus: "done" as const }
            : {}),
        },
      });
      if (tail) {
        const tailId = `shot_tail:${shot.shotId}`;
        upsert({
          id: tailId,
          type: "image",
          position: { x, y: y + 530 },
          data: {
            nodeType: "image",
            title: `${title} · 尾帧 ${i + 1}`,
            canvasShotId: shot.shotId,
            imageUrl: tail.url,
            prompt: shot.imagePrompt,
            seedanceRole: "last_frame",
            generationStatus: "done",
          },
        });
        connect(tailId, videoId, "last-frame");
      }
      connect(textId, videoId, "prompt");
      connect(imageId, videoId, "first-frame");
      for (const reference of shot.referenceImages ?? [])
        if (nodes.some((n) => n.id === reference.nodeId))
          connect(reference.nodeId, imageId, "reference-image");
      if (i > 0) connect(ids[i - 1], videoId);
    }
  }
  const result = { ...project, nodes, edges };
  for (const shot of shots) {
    if (project.shotWorkspaces?.[shot.shotId]?.initialized) continue;
    const node = nodes.find((n) => n.id === `shot_frame:${shot.shotId}`);
    const keyframe = shot.firstFrameId && selectedAsset(state, shot.firstFrameId, "image");
    const asset = keyframe || selectedAsset(state, shot.shotId, "image");
    if (node && asset)
      node.data.generationFingerprint =
        keyframe || [shotRevision(shot), imageRevision(shot)].includes(asset.sourceRevision)
          ? fingerprint(result, node.id)
          : "outdated-storyboard";
  }
  for (const shot of shots) {
    if (project.shotWorkspaces?.[shot.shotId]?.initialized) continue;
    const node = nodes.find((n) => n.type === "video" && n.data.productionShotId === shot.shotId);
    const asset = selectedAsset(state, shot.shotId, "video");
    if (node && asset && [shotRevision(shot), videoRevision(shot)].includes(asset.sourceRevision))
      node.data.generationFingerprint = fingerprint(result, node.id);
  }
  return syncSelectedKeyframes(initializeShotWorkspaces(result), state);
}

function groupInitialized(project: StoryProject, sceneId: string) {
  return project.creation?.storyboardShots
    .filter((s) => s.sceneId === sceneId)
    .every((s) => project.shotWorkspaces?.[s.shotId]?.initialized);
}

/** Update generated frame links while leaving manually rewired or captured inputs in place. */
export function syncSelectedKeyframes(project: StoryProject, state: ProductionState): StoryProject {
  if (!project.shotWorkspaces || project.id !== state.projectId) return project;
  const nodes = [...project.nodes];
  const edges = [...project.edges];
  let changed = false;
  for (const shot of project.creation?.storyboardShots ?? []) {
    const videoId = project.shotWorkspaces[shot.shotId]?.mainVideoNodeId;
    if (!videoId) continue;
    for (const [role, keyframeId, id] of [
      ["first-frame", shot.firstFrameId, `shot_frame:${shot.shotId}`],
      ["last-frame", shot.lastFrameId, `shot_tail:${shot.shotId}`],
    ] as const) {
      if (!keyframeId) continue;
      const asset = selectedAsset(state, keyframeId, "image");
      if (!asset) continue;
      const input = edges.find((edge) => edge.target === videoId && edge.data?.inputRole === role);
      if (input && input.source !== id) continue;
      if (!input && role === "first-frame") continue;
      if (
        edges.some(
          (edge) =>
            edge.target === videoId &&
            ["reference-image", "reference-video"].includes(edge.data?.inputRole ?? ""),
        )
      )
        continue;
      const video = nodes.find((node) => node.id === videoId);
      if (
        !video ||
        video.data.seedanceMode === "reference-to-video" ||
        (Array.isArray(video.data.referenceImageUrls) && video.data.referenceImageUrls.length) ||
        (Array.isArray(video.data.referenceVideoUrls) && video.data.referenceVideoUrls.length)
      )
        continue;
      const index = nodes.findIndex((node) => node.id === id);
      const previous = nodes[index];
      if (previous?.data.imageUrl === asset.url && input) continue;
      if (previous?.data.generationJobId) continue;
      const node: StoryFlowNode = {
        id,
        type: "image",
        position: previous?.position ?? { x: video.position.x - 420, y: video.position.y + 400 },
        data: {
          ...previous?.data,
          nodeType: "image",
          title: role === "last-frame" ? "尾帧" : "首帧",
          canvasShotId: shot.shotId,
          imageUrl: asset.url,
          generationStatus: "done",
          generationFingerprint: undefined,
        },
      };
      if (index < 0) nodes.push(node);
      else nodes[index] = node;
      if (!input)
        edges.push({
          id: `shot_input:${id}:${videoId}`,
          source: id,
          target: videoId,
          data: { kind: "context", inputRole: role },
        });
      changed = true;
    }
  }
  return changed ? { ...project, nodes, edges } : project;
}
