/**
 * Creation Store — AI 创作链路状态
 *
 * 对应截图中的 6-step 创作流程：
 * 01 故事与剧本 Agent → 02 分支剧情 Agent → 03 分镜 Agent
 * → 04 视觉与声音 Agent → 05 视频生成工作流 → 06 剧情校验与发布
 */

import {
  defaultCreationBrief,
  isLinearWork,
  storySource,
  type StorySource,
  type CreationBrief,
} from "@/lib/story/creation-brief";
import { create } from "zustand";
import { normalizeShots, type StoryboardShot, type Keyframe } from "@/lib/production/shots";
export type { StoryboardShot } from "@/lib/production/shots";

// ── 步骤定义 ──────────────────────────────────────────────────────────────────

export type PipelineStep =
  | "story" // 01 故事与剧本
  | "branch" // 02 分支剧情
  | "storyboard" // 03 分镜
  | "visual" // 04 视觉与声音
  | "video" // 05 视频生成
  | "validate"; // 06 校验与发布

export const PIPELINE_STEPS: Array<{
  id: PipelineStep;
  no: string;
  title: string;
  description: string;
}> = [
  {
    id: "story",
    no: "01",
    title: "故事与剧本 Agent",
    description: "生成大纲、角色关系、剧情节点和对白",
  },
  {
    id: "branch",
    no: "02",
    title: "分支剧情 Agent",
    description: "识别决策点、设计选项、生成分支及结局",
  },
  {
    id: "storyboard",
    no: "03",
    title: "分镜 Agent",
    description: "将每个剧情节点拆成镜头，生成画面描述和运镜指令",
  },
  {
    id: "visual",
    no: "04",
    title: "视觉与声音 Agent",
    description: "生成角色参考图、场景图、镜头图片、配音和音效",
  },
  {
    id: "video",
    no: "05",
    title: "视频生成工作流",
    description: "逐镜生成视频片段，检查素材并支持失败重试",
  },
  {
    id: "validate",
    no: "06",
    title: "剧情校验与发布",
    description: "检查分支是否完整、资源是否就绪、所有路线能否正常播放",
  },
];

export type StepStatus = "idle" | "running" | "done" | "error";

// ── 数据类型 ──────────────────────────────────────────────────────────────────

export interface StoryOutline {
  visualStyle?: string;
  title: string;
  description: string;
  genre: string;
  characters: Array<{ name: string; role: string; description: string }>;
  scenes: Array<{
    id: string;
    title: string;
    description: string;
    scenePrompt: string;
    order: number;
    choices?: Array<{ label: string; leadsTo: string }>;
  }>;
}

export interface BranchDesign {
  decisionPoints: Array<{
    sceneId: string;
    question: string;
    choices: Array<{ label: string; targetSceneId: string; consequence: string }>;
  }>;
  endings: Array<{ sceneId: string; title: string; description: string }>;
}

export interface GeneratedAsset {
  sceneId: string;
  type: "image" | "audio" | "video";
  url: string;
  status: "pending" | "generating" | "done" | "failed";
  prompt?: string;
  error?: string;
  jobId?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  allPathsReachEnding: boolean;
  assetsReady: number;
  assetsTotal: number;
}

// ── Store ────────────────────────────────────────────────────────────────────

interface CreationStore {
  // ── 当前所在的步骤 ──────────────────────────
  activeStep: PipelineStep;
  stepStatuses: Record<PipelineStep, StepStatus>;

  // ── 各步骤数据 ──────────────────────────────
  brief: CreationBrief;
  setBrief: (brief: CreationBrief) => void;
  userPrompt: string; // 用户输入的故事创意
  storyOutline: StoryOutline | null;
  pendingStoryOutline: StoryOutline | null;
  pendingStoryBrief: CreationBrief | null;
  pendingStorySource: StorySource | null;
  appliedStorySource: StorySource | null;
  branchDesign: BranchDesign | null;
  storyboardShots: StoryboardShot[];
  /**
   * Keyframes shared between shots (A/B/C nodes).
   * Derived from storyboardShots on load; kept in sync when shots are edited.
   */
  keyframes: Keyframe[];
  assets: GeneratedAsset[];
  validationResult: ValidationResult | null;

  // ── 流式输出缓冲（用于显示 AI 正在生成的文字） ──
  streamingText: string;

  // ── 素材库 ──────────────────────────────────
  assetLibrary: GeneratedAsset[];

  // ── Actions ─────────────────────────────────
  setActiveStep: (step: PipelineStep) => void;
  setStepStatus: (step: PipelineStep, status: StepStatus) => void;
  setUserPrompt: (prompt: string) => void;
  setStoryOutline: (outline: StoryOutline | null) => void;
  setBranchDesign: (design: BranchDesign | null) => void;
  appendStoryboardShot: (shot: StoryboardShot) => void;
  setStoryboardShots: (shots: StoryboardShot[]) => void;
  upsertKeyframe: (keyframe: Keyframe) => void;
  upsertAsset: (asset: GeneratedAsset) => void;
  updateAssetStatus: (
    sceneId: string,
    type: GeneratedAsset["type"],
    status: GeneratedAsset["status"],
    url?: string,
    error?: string,
  ) => void;
  setValidationResult: (result: ValidationResult | null) => void;
  appendStreamingText: (chunk: string) => void;
  clearStreamingText: () => void;
  addToLibrary: (asset: GeneratedAsset) => void;
}

const defaultStepStatuses: Record<PipelineStep, StepStatus> = {
  story: "idle",
  branch: "idle",
  storyboard: "idle",
  visual: "idle",
  video: "idle",
  validate: "idle",
};

export type CreationData = Pick<
  CreationStore,
  | "activeStep"
  | "stepStatuses"
  | "userPrompt"
  | "storyOutline"
  | "branchDesign"
  | "storyboardShots"
  | "assets"
  | "assetLibrary"
> & {
  brief?: CreationBrief;
  keyframes?: Keyframe[];
  pendingStoryBrief?: CreationBrief | null;
  pendingStoryOutline?: StoryOutline | null;
  pendingStorySource?: StorySource | null;
  appliedStorySource?: StorySource | null;
};

export function creationSnapshot(): CreationData {
  const {
    brief,
    activeStep,
    stepStatuses,
    userPrompt,
    storyOutline,
    pendingStoryOutline,
    pendingStoryBrief,
    pendingStorySource,
    appliedStorySource,
    branchDesign,
    storyboardShots,
    keyframes,
    assets,
    assetLibrary,
  } = useCreationStore.getState();
  return {
    brief,
    activeStep,
    stepStatuses,
    userPrompt,
    storyOutline,
    pendingStoryOutline,
    pendingStoryBrief,
    pendingStorySource,
    appliedStorySource,
    branchDesign,
    storyboardShots,
    keyframes,
    assets,
    assetLibrary,
  };
}

export function restoreCreation(data?: CreationData) {
  const statuses = { ...defaultStepStatuses, ...data?.stepStatuses };
  for (const key of Object.keys(statuses) as PipelineStep[]) {
    if (statuses[key] === "running") statuses[key] = "error";
  }
  useCreationStore.setState({
    brief: data?.brief ?? defaultCreationBrief(),
    activeStep: data?.activeStep ?? "story",
    stepStatuses: statuses,
    userPrompt: data?.userPrompt ?? "",
    storyOutline: data?.storyOutline ?? null,
    pendingStoryOutline: data?.pendingStoryOutline ?? null,
    pendingStoryBrief: data?.pendingStoryBrief ?? null,
    pendingStorySource: data?.pendingStorySource ?? null,
    appliedStorySource: data?.appliedStorySource ?? null,
    branchDesign: data?.branchDesign ?? null,
    storyboardShots: normalizeShots(data?.storyboardShots ?? []),
    keyframes: data?.keyframes ?? [],
    assets: (data?.assets ?? []).map((a) =>
      a.status === "generating" ? { ...a, status: "failed", error: "生成已中断，请重试" } : a,
    ),
    assetLibrary: data?.assetLibrary ?? [],
    streamingText: "",
    validationResult: null,
  });
}

export const useCreationStore = create<CreationStore>((set, get) => ({
  brief: defaultCreationBrief(),
  setBrief: (brief) =>
    set((s) => ({
      appliedStorySource:
        s.appliedStorySource ?? (s.storyOutline ? storySource(s.userPrompt, s.brief) : null),
      brief: isLinearWork(brief) ? { ...brief, decisionPoints: undefined } : brief,
    })),
  activeStep: "story",
  stepStatuses: { ...defaultStepStatuses },

  userPrompt: "",
  storyOutline: null,
  pendingStoryOutline: null,
  pendingStoryBrief: null,
  pendingStorySource: null,
  appliedStorySource: null,
  branchDesign: null,
  storyboardShots: [],
  keyframes: [],
  assets: [],
  validationResult: null,
  streamingText: "",
  assetLibrary: [],

  setActiveStep: (step) => set({ activeStep: step }),

  setStepStatus: (step, status) =>
    set((s) => ({
      stepStatuses: { ...s.stepStatuses, [step]: status },
    })),

  setUserPrompt: (prompt) =>
    set((s) => ({
      userPrompt: prompt,
      appliedStorySource:
        s.appliedStorySource ?? (s.storyOutline ? storySource(s.userPrompt, s.brief) : null),
    })),

  setStoryOutline: (outline) => set({ storyOutline: outline }),

  setBranchDesign: (design) => set({ branchDesign: design }),

  appendStoryboardShot: (shot) => set((s) => ({ storyboardShots: [...s.storyboardShots, shot] })),

  setStoryboardShots: (shots) => {
    const normalized = normalizeShots(shots, get().storyboardShots);
    // Derive keyframes from shots: collect all unique firstFrameId/lastFrameId
    const kfMap = new Map<string, Keyframe>();
    for (const shot of normalized) {
      if (shot.firstFrameId && !kfMap.has(shot.firstFrameId))
        kfMap.set(shot.firstFrameId, { id: shot.firstFrameId, description: shot.imagePrompt });
      if (shot.lastFrameId && !kfMap.has(shot.lastFrameId))
        kfMap.set(shot.lastFrameId, { id: shot.lastFrameId, description: shot.imagePrompt });
    }
    // Preserve existing imageVersionId/imageUrl on unchanged keyframes
    const existing = get().keyframes;
    const keyframes = [...kfMap.values()].map((kf) => {
      const prev = existing.find((e) => e.id === kf.id);
      return prev ? { ...kf, imageVersionId: prev.imageVersionId, imageUrl: prev.imageUrl } : kf;
    });
    set({ storyboardShots: normalized, keyframes });
  },

  upsertKeyframe: (keyframe) =>
    set((s) => {
      const idx = s.keyframes.findIndex((k) => k.id === keyframe.id);
      if (idx === -1) return { keyframes: [...s.keyframes, keyframe] };
      const next = [...s.keyframes];
      next[idx] = { ...next[idx], ...keyframe };
      return { keyframes: next };
    }),

  upsertAsset: (asset) =>
    set((s) => {
      const idx = s.assets.findIndex((a) => a.sceneId === asset.sceneId && a.type === asset.type);
      if (idx === -1) return { assets: [...s.assets, asset] };
      const next = [...s.assets];
      next[idx] = asset;
      return { assets: next };
    }),

  updateAssetStatus: (sceneId, type, status, url, error) =>
    set((s) => ({
      assets: s.assets.map((a) =>
        a.sceneId === sceneId && a.type === type
          ? { ...a, status, ...(url ? { url } : {}), ...(error ? { error } : {}) }
          : a,
      ),
    })),

  setValidationResult: (result) => set({ validationResult: result }),

  appendStreamingText: (chunk) => set((s) => ({ streamingText: s.streamingText + chunk })),

  clearStreamingText: () => set({ streamingText: "" }),

  addToLibrary: (asset) => set((s) => ({ assetLibrary: [...s.assetLibrary, asset] })),
}));
