/**
 * Demo 项目 — 开箱即用的示例互动故事
 * 对应文档中的「发现秘密」示例
 */

import { nanoid } from "nanoid";
import type { StoryProject, StoryFlowNode, StoryFlowEdge } from "./types";

/** Repair only the exact two-exit merge shipped in the original example. */
export function repairLegacyDemo(project: StoryProject): StoryProject {
  const merge = project.nodes.find(
    (n) => n.id === "node_merge" && n.type === "merge" && n.data.label === "命运交汇",
  );
  const exits = project.edges.filter((e) => e.source === "node_merge");
  if (
    !merge ||
    exits.length !== 2 ||
    !exits.some((e) => e.id === "edge_merge_truth" && e.target === "node_ending_truth") ||
    !exits.some((e) => e.id === "edge_merge_unknown" && e.target === "node_ending_unknown")
  )
    return project;
  return {
    ...project,
    nodes: project.nodes.map((n) =>
      n === merge
        ? {
            ...n,
            type: "choice",
            data: { ...n.data, nodeType: "choice", question: "命运交汇，你会继续追查吗？" },
          }
        : n,
    ),
  };
}

export function createDemoProject(): StoryProject {
  const id = `project_${nanoid(10)}`;
  const now = new Date().toISOString();

  const nodes: StoryFlowNode[] = [
    {
      id: "node_discover",
      type: "video",
      position: { x: 80, y: 200 },
      data: {
        nodeType: "video",
        title: "发现秘密",
        description: "你在书架上发现了一封神秘的信件",
        scenePrompt: "黄昏，昏暗的图书馆，主角发现书架后藏着一封蜡封信件，神情震惊",
        interactionAt: 8,
        generationStatus: "idle",
      },
    },
    {
      id: "node_choice_1",
      type: "choice",
      position: { x: 380, y: 200 },
      data: {
        nodeType: "choice",
        question: "你会怎么做？",
      },
    },
    {
      id: "node_open_letter",
      type: "video",
      position: { x: 650, y: 80 },
      data: {
        nodeType: "video",
        title: "打开信件",
        description: "你小心翼翼地拆开信封，发现了一个惊天秘密",
        scenePrompt: "主角用颤抖的手拆开蜡封信件，信中写着令人震惊的话语，特写镜头",
        generationStatus: "idle",
      },
    },
    {
      id: "node_leave",
      type: "video",
      position: { x: 650, y: 340 },
      data: {
        nodeType: "video",
        title: "立即离开",
        description: "你感到不安，决定把信放回原处，悄悄离开",
        scenePrompt: "主角将信放回书架，快步走向门口，回头看了一眼",
        generationStatus: "idle",
      },
    },
    {
      id: "node_merge",
      type: "choice",
      position: { x: 950, y: 200 },
      data: {
        nodeType: "choice",
        question: "命运交汇，你会继续追查吗？",
      },
    },
    {
      id: "node_ending_truth",
      type: "ending",
      position: { x: 1200, y: 80 },
      data: {
        nodeType: "ending",
        title: "真相大白",
        description: "你揭开了深埋多年的秘密，从此改变了命运。",
      },
    },
    {
      id: "node_ending_unknown",
      type: "ending",
      position: { x: 1200, y: 340 },
      data: {
        nodeType: "ending",
        title: "带着疑惑离去",
        description: "你选择了逃避，但那个问题将永远困扰着你。",
      },
    },
  ];

  const edges: StoryFlowEdge[] = [
    {
      id: "edge_discover_choice",
      source: "node_discover",
      target: "node_choice_1",
      type: "smoothstep",
      animated: true,
      data: {},
    },
    {
      id: "edge_choice_open",
      source: "node_choice_1",
      target: "node_open_letter",
      type: "smoothstep",
      animated: true,
      data: { choiceLabel: "打开信件" },
    },
    {
      id: "edge_choice_leave",
      source: "node_choice_1",
      target: "node_leave",
      type: "smoothstep",
      animated: true,
      data: { choiceLabel: "立即离开" },
    },
    {
      id: "edge_open_merge",
      source: "node_open_letter",
      target: "node_merge",
      type: "smoothstep",
      animated: true,
      data: {},
    },
    {
      id: "edge_leave_merge",
      source: "node_leave",
      target: "node_merge",
      type: "smoothstep",
      animated: true,
      data: {},
    },
    {
      id: "edge_merge_truth",
      source: "node_merge",
      target: "node_ending_truth",
      type: "smoothstep",
      animated: true,
      data: { choiceLabel: "深入追查" },
    },
    {
      id: "edge_merge_unknown",
      source: "node_merge",
      target: "node_ending_unknown",
      type: "smoothstep",
      animated: true,
      data: { choiceLabel: "就此放弃" },
    },
  ];

  return {
    id,
    name: "发现秘密",
    description: "一个关于选择与命运的互动故事——一封神秘信件，两条截然不同的路。",
    nodes,
    edges,
    startNodeId: "node_discover",
    createdAt: now,
    updatedAt: now,
  };
}
