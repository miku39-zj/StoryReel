import { z } from "zod";

export const storyOutlineSchema = z
  .object({
    title: z.string().min(1),
    visualStyle: z.string().optional(),
    description: z.string(),
    genre: z.string().default(""),
    characters: z.array(z.object({ name: z.string(), role: z.string(), description: z.string() })),
    scenes: z
      .array(
        z.object({
          id: z.string().min(1),
          title: z.string(),
          description: z.string().default(""),
          scenePrompt: z.string().default(""),
          order: z.number().default(0),
          choices: z.array(z.object({ label: z.string(), leadsTo: z.string() })).optional(),
        }),
      )
      .min(1)
      .max(5000),
  })
  .superRefine((outline, ctx) => {
    if (new Set(outline.scenes.map((s) => s.id)).size !== outline.scenes.length)
      ctx.addIssue({ code: "custom", message: "场景 ID 重复" });
  });

export const branchDesignSchema = z.object({
  decisionPoints: z.array(
    z.object({
      sceneId: z.string(),
      question: z.string(),
      choices: z.array(
        z.object({ label: z.string(), targetSceneId: z.string(), consequence: z.string() }),
      ),
    }),
  ),
  endings: z.array(z.object({ sceneId: z.string(), title: z.string(), description: z.string() })),
});
export const generatedAssetSchema = z.object({
  sceneId: z.string(),
  type: z.enum(["image", "audio", "video"]),
  url: z.string(),
  status: z.enum(["pending", "generating", "done", "failed"]),
  prompt: z.string().optional(),
  error: z.string().optional(),
  jobId: z.string().optional(),
});
export const variablesSchema = z.record(
  z
    .string()
    .regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/)
    .refine((key) => !["__proto__", "constructor", "prototype"].includes(key)),
  z.union([z.string(), z.number().finite(), z.boolean()]),
);
