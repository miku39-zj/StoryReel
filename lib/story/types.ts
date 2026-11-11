import type { ShotSegment } from "@/lib/production/apply";
import type { Node, Edge } from "@xyflow/react";
import type { CreationData } from "@/stores/creation-store";

// ─── 节点类型 ───────────────────────────────────────────────────────────────

export type StoryNodeType =
  | "video" // 播放一段视频
  | "choice" // 向观众展示选项
  | "condition" // 根据状态自动分流
  | "merge" // 多条路线汇合
  | "ending" // 终结节点
  | "text" // 场景文字/提示词，可连接图片节点或视频节点
  | "image"; // 生成好的图片，可作为视频首帧/尾帧

// ─── 节点数据 ───────────────────────────────────────────────────────────────

export interface VideoNodeData extends Record<string, unknown> {
  nodeType: "video";
  title: string;
  description?: string;
  videoUrl?: string;
  thumbnailUrl?: string;
  segments?: ShotSegment[];
  audioUrl?: string;
  clipEnd?: number;
  duration?: number;
  /** 秒数：在视频第 N 秒弹出选择（而非等到视频结束） */
  interactionAt?: number;
  generationStatus?: "idle" | "pending" | "generating" | "done" | "failed";
  generationError?: string;
  /** 供 AI 生成用的场景描述 */
  scenePrompt?: string;

  // Seedance generation parameters
  seedanceModel?: "seedance-1-0-lite" | "seedance-1-0-pro" | "seedance-2-0";
  seedanceMode?: "text-to-video" | "image-to-video" | "first-last-frame" | "reference-to-video";
  firstFrameUrl?: string;
  lastFrameUrl?: string;
  referenceImageUrls?: string[];
  referenceVideoUrls?: string[];
  seedanceDuration?: 5 | 8 | 10;
  seedanceAspectRatio?: "16:9" | "9:16" | "1:1" | "4:3" | "3:4";
  seedanceResolution?: "480p" | "720p" | "1080p";
  generateAudio?: boolean;
}

export interface TextNodeData extends Record<string, unknown> {
  nodeType: "text";
  title: string;
  content: string;
  role?: "scene" | "dialogue" | "direction" | "prompt";
  generationStatus?: "idle" | "generating" | "done" | "failed";
}

export interface ImageNodeData extends Record<string, unknown> {
  nodeType: "image";
  title: string;
  imageUrl?: string;
  prompt?: string;
  style?: "cinematic" | "anime" | "realistic" | "illustration";
  width?: number;
  height?: number;
  generationStatus?: "idle" | "generating" | "done" | "failed";
  generationError?: string;
  seedanceRole?: "first_frame" | "last_frame" | "reference";
}

export interface ChoiceNodeData extends Record<string, unknown> {
  nodeType: "choice";
  question?: string;
  /** 超时后自动进入第一条路线（秒），undefined 表示无限等待 */
  timeoutSecs?: number;
}

export interface Predicate {
  variable: string;
  operator: "==" | "!=" | ">" | "<" | ">=" | "<=";
  value: string | number | boolean;
}
export interface VariableOperation {
  variable: string;
  operation: "set" | "add" | "subtract" | "toggle";
  value?: string | number | boolean;
}
export interface RuntimeTrace {
  nodeId: string;
  edgeId?: string;
  message: string;
  variables: Record<string, unknown>;
}

export interface ConditionNodeData extends Record<string, unknown> {
  nodeType: "condition";
  conditions?: Predicate[];
  conditionMode?: "all" | "any";
  variable?: string;
  operator?: "==" | "!=" | ">" | "<" | ">=" | "<=";
  value?: string | number | boolean;
}

export interface MergeNodeData extends Record<string, unknown> {
  nodeType: "merge";
  label?: string;
}

export interface EndingNodeData extends Record<string, unknown> {
  nodeType: "ending";
  title?: string;
  description?: string;
}

export type StoryNodeData =
  | VideoNodeData
  | ChoiceNodeData
  | ConditionNodeData
  | MergeNodeData
  | EndingNodeData
  | TextNodeData
  | ImageNodeData;

// ─── React Flow 节点 / 边 ────────────────────────────────────────────────────

export type StoryFlowNode = Node<StoryNodeData, StoryNodeType>;
export type StoryFlowEdge = Edge<StoryEdgeData>;

export type InputRole =
  "prompt" | "first-frame" | "last-frame" | "reference-image" | "reference-video";

export interface StoryEdgeData extends Record<string, unknown> {
  kind?: "flow" | "context";
  inputRole?: InputRole;
  /** 选择标签（在 choice → video 的边上显示给观众） */
  choiceLabel?: string;
  /** 条件表达式（在 condition 节点的出边上） */
  condition?: string;
  setVariables?: StoryVariables;
  variableOperations?: VariableOperation[];
}

export type StoryVariables = Record<string, string | number | boolean>;

// ─── 项目 ────────────────────────────────────────────────────────────────────

export interface StoryProject {
  /** Stable AI context title, independent of the editable project display name. */
  storyContextTitle?: string;
  id: string;
  name: string;
  description?: string;
  nodes: StoryFlowNode[];
  edges: StoryFlowEdge[];
  /** 起始视频节点 ID */
  startNodeId?: string;
  createdAt: string;
  updatedAt: string;
  creation?: CreationData;
  initialVariables?: StoryVariables;
  revision?: number;
  activeShotId?: string;
  shotWorkspaces?: Record<string, import("@/lib/canvas/shot-workspace").ShotWorkspace>;
}

// ─── 播放器运行时 ─────────────────────────────────────────────────────────────

/** 播放器当前的状态机阶段 */
export type PlayerPhase =
  | "idle" // 尚未开始
  | "playing" // 正在播放视频
  | "awaiting" // 视频结束或到达 interactionAt，等待选择
  | "transitioning" // 正在加载下一段
  | "ended" // 到达结局节点
  | "error";

export interface PlayerChoice {
  edgeId: string;
  label: string;
  targetNodeId: string;
}

export interface PlayerState {
  trace?: RuntimeTrace[];
  phase: PlayerPhase;
  currentNodeId: string | null;
  /** 当前需要播放的视频 URL */
  currentVideoUrl: string | null;
  currentAudioUrl?: string;
  /** 当前视频应从第几秒开始播放 */
  currentVideoStart: number;
  /** 当前视频应在第几秒结束（undefined = 播到自然结束） */
  currentVideoEnd?: number;
  /** 第几秒弹出选择（undefined = 视频结束时弹出） */
  interactionAt?: number;
  /** 当前展示给观众的选项 */
  choices: PlayerChoice[];
  /** 最终到达的结局节点数据（仅 ended 阶段有值） */
  ending: EndingNodeData | null;
  /** 完整的观看路径（节点 ID 列表） */
  history: string[];
  /** 运行时变量，供 condition 节点使用 */
  variables: Record<string, unknown>;
}

// ─── AI 生成 ──────────────────────────────────────────────────────────────────

export interface ScriptGenerationResult {
  title: string;
  description: string;
  scenes: Array<{
    id: string;
    title: string;
    scenePrompt: string;
    /** 该节点之后的选项（空数组表示结局） */
    choices: Array<{ label: string; leadsTo: string }>;
  }>;
}
