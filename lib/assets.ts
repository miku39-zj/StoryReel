export interface LibraryAsset {
  id: string;
  name: string;
  type: "image" | "video" | "audio";
  url: string;
  createdAt: string;
  size?: number;
  projectId?: string;
  mock?: boolean;
}
