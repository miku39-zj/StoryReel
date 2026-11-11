import { creationBriefSchema, storySourceSchema } from "./creation-brief";
import { z } from "zod";
import { normalizeShots } from "@/lib/production/shots";
import type { StoryProject } from "./types";
import {
  storyOutlineSchema,
  branchDesignSchema,
  generatedAssetSchema,
  variablesSchema,
} from "./creation-schema";
import { repairLegacyDemo } from "./demo";

const predicate = z.object({
  variable: z.string().min(1),
  operator: z.enum(["==", "!=", ">", "<", ">=", "<="]),
  value: z.union([z.string(), z.number().finite(), z.boolean()]),
});
const operation = z.object({
  variable: z.string().min(1),
  operation: z.enum(["set", "add", "subtract", "toggle"]),
  value: z.union([z.string(), z.number().finite(), z.boolean()]).optional(),
});
const nodeType = z.enum(["video", "choice", "condition", "merge", "ending", "text", "image"]);
export const projectSchema = z
  .object({
    storyContextTitle: z.string().optional(),
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
    name: z.string().min(1).max(500),
    description: z.string().optional(),
    nodes: z
      .array(
        z
          .object({
            id: z.string().min(1),
            type: nodeType,
            data: z
              .object({
                nodeType,
                title: z.string().optional(),
                description: z.string().optional(),
                videoUrl: z.string().optional(),
                audioUrl: z.string().optional(),
                clipEnd: z.number().positive().optional(),
                duration: z.number().positive().optional(),
                imageUrl: z.string().optional(),
                content: z.string().optional(),
                question: z.string().optional(),
                label: z.string().optional(),
                conditions: z.array(predicate).min(1).max(50).optional(),
                conditionMode: z.enum(["all", "any"]).optional(),
                variable: z.string().optional(),
                operator: z.enum(["==", "!=", ">", "<", ">=", "<="]).optional(),
                value: z.union([z.string(), z.number().finite(), z.boolean()]).optional(),
                interactionAt: z.number().nonnegative().optional(),
                timeoutSecs: z.number().positive().optional(),
                segments: z
                  .array(
                    z.object({
                      shotId: z.string(),
                      videoVersionId: z.string(),
                      audioVersionId: z.string().optional(),
                      videoUrl: z.string(),
                      audioUrl: z.string().optional(),
                      duration: z.number().positive(),
                      sourceRevision: z.string().optional(),
                    }),
                  )
                  .optional(),
              })
              .passthrough(),
            position: z.object({ x: z.number(), y: z.number() }),
          })
          .passthrough(),
      )
      .max(5000),
    edges: z
      .array(
        z
          .object({
            id: z.string().min(1),
            source: z.string(),
            target: z.string(),
            data: z
              .object({
                kind: z.enum(["flow", "context"]).optional(),
                inputRole: z
                  .enum([
                    "prompt",
                    "first-frame",
                    "last-frame",
                    "reference-image",
                    "reference-video",
                  ])
                  .optional(),
                choiceLabel: z.string().optional(),
                condition: z.string().optional(),
                setVariables: variablesSchema.optional(),
                variableOperations: z.array(operation).max(100).optional(),
              })
              .passthrough()
              .optional(),
          })
          .passthrough(),
      )
      .max(20000),
    startNodeId: z.string().optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    initialVariables: variablesSchema.optional(),
    activeShotId: z.string().optional(),
    shotWorkspaces: z
      .record(
        z.object({
          initialized: z.boolean(),
          mainVideoNodeId: z.string().optional(),
          sourceRevision: z.string().optional(),
          positions: z
            .record(z.object({ x: z.number().finite(), y: z.number().finite() }))
            .optional(),
          viewport: z
            .object({
              x: z.number().finite(),
              y: z.number().finite(),
              zoom: z.number().positive().max(2),
            })
            .optional(),
        }),
      )
      .optional(),
    revision: z.number().int().nonnegative().optional(),
    creation: z
      .object({
        brief: creationBriefSchema.optional(),
        activeStep: z.enum(["story", "branch", "storyboard", "visual", "video", "validate"]),
        stepStatuses: z.record(z.enum(["idle", "running", "done", "error"])),
        userPrompt: z.string(),
        storyOutline: storyOutlineSchema.nullable(),
        branchDesign: branchDesignSchema.nullable(),
        pendingStoryBrief: creationBriefSchema.nullable().optional(),
        pendingStorySource: storySourceSchema.nullable().optional(),
        appliedStorySource: storySourceSchema.nullable().optional(),
        pendingStoryOutline: storyOutlineSchema.nullable().optional(),
        storyboardShots: z.array(z.unknown()).transform((shots) => normalizeShots(shots)),
        keyframes: z
          .array(
            z.object({
              id: z.string().min(1).max(160),
              description: z.string().min(1),
              imageVersionId: z.string().optional(),
              imageUrl: z.string().optional(),
            }),
          )
          .optional(),
        assets: z.array(generatedAssetSchema),
        assetLibrary: z.array(generatedAssetSchema),
      })
      .optional(),
  })
  .superRefine((project, ctx) => {
    if (project.nodes.some((node) => node.type !== node.data.nodeType))
      ctx.addIssue({ code: "custom", message: "节点类型与内容不一致" });
    if (
      new Set(project.nodes.map((node) => node.id)).size !== project.nodes.length ||
      new Set(project.edges.map((edge) => edge.id)).size !== project.edges.length
    )
      ctx.addIssue({ code: "custom", message: "节点或连接 ID 重复" });
  });
export function parseProject(input: unknown): StoryProject {
  const project = projectSchema.parse(input) as unknown as StoryProject;
  if (project.creation)
    project.creation.storyboardShots = normalizeShots(project.creation.storyboardShots);
  return repairLegacyDemo(project);
}
