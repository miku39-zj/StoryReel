export interface CanvasJob {
  waitingForQuery?: boolean;
  externalRequestId?: string;
  resumable?: boolean;
  id: string;
  projectId: string;
  nodeId: string;
  kind: "image" | "video";
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  sourceFingerprint?: string;
  previousUrl?: string;
  previousVersion?: string;
  createdAt: string;
  updatedAt: string;
  fingerprint?: string;
  url?: string;
  error?: string;
  dependencies: string[];
}
