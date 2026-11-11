import type { PipelineStep } from "@/stores/creation-store";

export type Workspace = "creation" | "canvas" | "preview";
const steps = ["story", "branch", "storyboard", "visual", "video", "validate"] as const;

export function readEditorLocation(hash: string): { workspace: Workspace; step?: PipelineStep } {
  const [workspace, step] = hash.replace(/^#/, "").split(":");
  return {
    workspace: workspace === "creation" || workspace === "preview" ? workspace : "canvas",
    ...(workspace === "creation" && steps.includes(step as PipelineStep)
      ? { step: step as PipelineStep }
      : {}),
  };
}

export function editorHash(workspace: Workspace, step: PipelineStep): string {
  return `#${workspace}${workspace === "creation" ? `:${step}` : ""}`;
}
