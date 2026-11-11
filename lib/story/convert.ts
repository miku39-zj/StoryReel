/**
 * convert.ts — 将 AI 生成的故事大纲转换为 StoryProject（画布节点 + 边）
 */

import { nanoid } from "nanoid";
import type {
  StoryFlowNode,
  StoryFlowEdge,
  StoryProject,
  VideoNodeData,
  ChoiceNodeData,
  EndingNodeData,
} from "./types";
import type { StoryOutline } from "@/stores/creation-store";

/**
 * AI 脚本生成的场景可能包含 choices 字段（不在 StoryOutline 类型中，但运行时存在）
 */
type SceneWithChoices = StoryOutline["scenes"][number] & {
  choices?: Array<{ label: string; leadsTo: string }>;
};

/**
 * 将故事大纲转换为可直接加载到画布的 StoryProject
 *
 * 节点命名约定（供 BranchAgentPanel / VideoGenPanel 使用）：
 *   - 视频节点：video_{scene.id}
 *   - 选择节点：choice_{scene.id}
 *   - 结局节点：ending_{scene.id}
 */
export function outlineToProject(
  outline: StoryOutline,
  projectId: string,
  projectName: string,
): StoryProject {
  const now = new Date().toISOString();
  const scenes = [...(outline.scenes as SceneWithChoices[])].sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0),
  );

  const nodes: StoryFlowNode[] = [];
  const edges: StoryFlowEdge[] = [];

  scenes.forEach((scene, i) => {
    const hasChoices = (scene.choices?.length ?? 0) > 1;

    // ── 视频节点 ───────────────────────────────────────────────
    const videoId = `video_${scene.id}`;
    const videoData: VideoNodeData = {
      nodeType: "video",
      title: scene.title,
      description: scene.description,
      scenePrompt: scene.scenePrompt,
      generationStatus: "idle",
    };
    nodes.push({
      id: videoId,
      type: "video",
      position: { x: i * 2 * 280, y: 0 },
      data: videoData,
    } as StoryFlowNode);

    if (hasChoices) {
      // ── 选择节点 ───────────────────────────────────────────────
      const choiceId = `choice_${scene.id}`;
      const choiceData: ChoiceNodeData = {
        nodeType: "choice",
        question: "你会怎么做？",
      };
      nodes.push({
        id: choiceId,
        type: "choice",
        position: { x: i * 2 * 280 + 280, y: 0 },
        data: choiceData,
      } as StoryFlowNode);

      // 边：video → choice
      edges.push({
        id: `edge_${nanoid(8)}`,
        source: videoId,
        target: choiceId,
        type: "smoothstep",
        animated: true,
        data: {},
      });

      // 边：choice → 目标 video
      scene.choices!.forEach((choice) => {
        edges.push({
          id: `edge_${nanoid(8)}`,
          source: choiceId,
          target: `video_${choice.leadsTo}`,
          type: "smoothstep",
          animated: true,
          data: { choiceLabel: choice.label },
        });
      });
    } else if (scene.choices?.length === 1) {
      edges.push({
        id: `edge_${nanoid(8)}`,
        source: videoId,
        target: `video_${scene.choices[0].leadsTo}`,
        type: "smoothstep",
        data: { kind: "flow" },
      });
    } else {
      // ── 结局节点 ───────────────────────────────────────────────
      const endingId = `ending_${scene.id}`;
      const endingData: EndingNodeData = {
        nodeType: "ending",
        title: scene.title,
        description: scene.description ?? "",
      };
      nodes.push({
        id: endingId,
        type: "ending",
        position: { x: i * 2 * 280 + 280, y: 160 },
        data: endingData,
      } as StoryFlowNode);

      // 边：video → ending
      edges.push({
        id: `edge_${nanoid(8)}`,
        source: videoId,
        target: endingId,
        type: "smoothstep",
        animated: true,
        data: {},
      });
    }
  });

  return {
    id: projectId,
    name: projectName,
    description: outline.description,
    nodes,
    edges,
    startNodeId: scenes.length > 0 ? `video_${scenes[0].id}` : undefined,
    createdAt: now,
    updatedAt: now,
  };
}
