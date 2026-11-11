import { z } from "zod";
import { creationBriefSchema } from "./creation-brief";

export const inspirationRequestSchema = z.object({
  prompt: z.string().trim().min(1).max(2000),
  brief: creationBriefSchema,
});
export const inspirationResultSchema = z
  .object({
    directions: z
      .array(
        z.object({
          title: z.string().trim().min(1).max(60),
          summary: z.string().trim().min(1).max(200),
          prompt: z.string().trim().min(1).max(2000),
        }),
      )
      .length(3),
  })
  .superRefine((value, ctx) => {
    if (
      new Set(value.directions.map((d) => d.title)).size !== 3 ||
      new Set(value.directions.map((d) => d.prompt)).size !== 3
    )
      ctx.addIssue({ code: "custom", message: "灵感方向重复，请重新生成" });
  });
export type InspirationDirection = z.infer<typeof inspirationResultSchema>["directions"][number];
