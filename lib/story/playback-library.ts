export interface PlaybackLibraryItem {
  id: string;
  name: string;
  cover?: string;
  updatedAt: string;
  status: "published" | "preview" | "incomplete";
  path?: string;
  publishedAt?: string;
  ready: number;
  total: number;
}
