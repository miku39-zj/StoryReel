import {
  assetDesignInstructions,
  defaultCreationBrief,
  type CreationBrief,
} from "./creation-brief";
import { attachCreationReferences } from "./creation-references";
import { nanoid } from "nanoid";
import type { StoryProject } from "./types";

export function newProject(
  tool = "canvas-free",
  prompt = "",
  brief: CreationBrief = defaultCreationBrief(),
): StoryProject {
  const now = new Date().toISOString();
  const project: StoryProject = {
    id: `project_${nanoid(10)}`,
    name: prompt.trim().slice(0, 24) || "未命名项目",
    nodes: [],
    edges: [],
    createdAt: now,
    updatedAt: now,
  };
  project.creation = {
    brief,
    activeStep: "story",
    stepStatuses: {
      story: "idle",
      branch: "idle",
      storyboard: "idle",
      visual: "idle",
      video: "idle",
      validate: "idle",
    },
    userPrompt: prompt,
    storyOutline: null,
    branchDesign: null,
    storyboardShots: [],
    assets: [],
    assetLibrary: [],
  };
  const type =
    tool === "canvas-scene" || tool === "canvas-character"
      ? "image"
      : tool === "canvas-branch"
        ? "condition"
        : tool === "canvas-ending"
          ? "ending"
          : null;
  if (type)
    project.nodes = [
      {
        id: `${type}_${nanoid(8)}`,
        type,
        position: { x: 250, y: 180 },
        data:
          type === "image"
            ? {
                nodeType: type,
                title: tool === "canvas-character" ? "角色参考" : "场景参考",
                prompt,
                assetKind: tool === "canvas-character" ? "character" : "scene",
                assetDescription: assetDesignInstructions(
                  tool === "canvas-character" ? "character" : "scene",
                  prompt,
                  brief,
                ),
                generationStatus: "idle",
              }
            : type === "condition"
              ? { nodeType: type, variable: "", operator: "==", value: "" }
              : { nodeType: type, title: "结局", description: prompt },
      },
    ];
  return attachCreationReferences(project, brief);
}
