import type { StoryboardShot } from "./shots";
export type AssetKind = "image" | "audio" | "video";
export interface ProviderTask {
  provider: "fal" | "mock" | "gateway";
  blockedReason?: string;
  readyAt?: number;
  requestId: string;
  statusUrl: string;
  resultUrl: string;
}
export interface AssetVersion {
  id: string;
  shotId: string;
  sceneId: string;
  kind: AssetKind;
  version: number;
  url: string;
  createdAt: string;
  jobId: string;
  sourceRevision: string;
  provider: string;
  inputImageId?: string;
  providerUrl?: string;
  mock?: boolean;
}
export interface GenerationJob {
  id: string;
  requestKey: string;
  shotId: string;
  kind: AssetKind;
  shot: StoryboardShot;
  sourceRevision: string;
  status: "queued" | "running" | "succeeded" | "failed";
  createdAt: string;
  updatedAt: string;
  attempt: number;
  retryOf?: string;
  imageJobId?: string;
  inputImageId?: string;
  inputImageUrl?: string;
  /** Keyframe ID for the last frame of this video shot (shared-frame continuity). */
  lastFrameId?: string;
  /** Resolved URL for the last frame image (populated at submit time from keyframe store). */
  lastFrameUrl?: string;
  stage?: "submitting" | "polling";
  providerTask?: ProviderTask;
  resultAssetId?: string;
  error?: string;
  owner?: string;
  leaseUntil?: number;
  nextRunAt?: number;
  pollErrors?: number;
  selectionRevision?: number;
}
export interface ProductionState {
  requestKeys?: string[];
  projectId: string;
  revision: number;
  jobs: GenerationJob[];
  assets: AssetVersion[];
  selectionRevisions?: Record<string, Partial<Record<AssetKind, number>>>;
  selected: Record<string, Partial<Record<AssetKind, string>>>;
}
export function emptyProduction(projectId: string): ProductionState {
  return { projectId, revision: 0, jobs: [], assets: [], selected: {} };
}
export function selectedAsset(state: ProductionState, shotId: string, kind: AssetKind) {
  return state.assets.find(
    (a) => a.id === state.selected[shotId]?.[kind] && a.shotId === shotId && a.kind === kind,
  );
}
