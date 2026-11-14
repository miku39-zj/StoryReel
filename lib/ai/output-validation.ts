import { assertCreationContent } from "@/lib/story/content-policy";
import { isLinearWork, type CreationBrief } from "@/lib/story/creation-brief";
import { resolveBranchRoutes } from "@/lib/story/branch-routes";
import { storyOutlineSchema, branchDesignSchema } from "@/lib/story/creation-schema";
import { normalizeShots } from "@/lib/production/shots";

export function parseModelJSON(text: string): unknown {
  return JSON.parse(
    text
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, ""),
  );
}
function assertAcyclic(routes: Map<string, string[]>) {
  const visiting = new Set<string>(),
    visited = new Set<string>();
  const check = (id: string) => {
    if (visiting.has(id)) throw new Error("故事存在循环路线，请移除循环后重试");
    if (visited.has(id)) return;
    visiting.add(id);
    (routes.get(id) ?? []).forEach(check);
    visiting.delete(id);
    visited.add(id);
  };
  routes.forEach((_targets, id) => check(id));
}
export function validateStory(value: unknown, brief?: CreationBrief) {
  const story = storyOutlineSchema.parse(value);
  assertCreationContent(story);
  if (brief?.workType === "single-episode") {
    story.scenes.forEach((scene) => {
      scene.episode = 1;
    });
  } else if (brief?.workType === "multi-episode" || brief?.workType === "interactive") {
    const episodes = new Set(story.scenes.map((scene) => scene.episode));
    if (episodes.has(undefined) || !episodes.has(1) || episodes.size < 2)
      throw new Error("请从第 1 集起规划至少两集，并为每个场景标记集号");
  }

  if (story.scenes.some((scene) => scene.choices === undefined))
    throw new Error("生成故事的每个场景必须包含 choices");
  const ids = new Set(story.scenes.map((scene) => scene.id));
  if (story.scenes.some((scene) => scene.choices?.some((choice) => !ids.has(choice.leadsTo))))
    throw new Error("故事引用了不存在的场景");
  if (
    story.scenes.some((scene) => scene.choices) &&
    !story.scenes.some((scene) => scene.choices?.length === 0)
  )
    throw new Error("故事缺少结局");
  if (story.scenes.every((scene) => scene.choices !== undefined)) {
    const reachable = new Set<string>();
    const visit = (id: string) => {
      if (reachable.has(id)) return;
      reachable.add(id);
      story.scenes
        .find((scene) => scene.id === id)!
        .choices!.forEach((choice) => visit(choice.leadsTo));
    };
    visit([...story.scenes].sort((a, b) => a.order - b.order)[0].id);
    if (reachable.size !== ids.size) throw new Error("故事存在无法到达的场景");
    const canEnd = new Set(
      story.scenes.filter((scene) => !scene.choices!.length).map((scene) => scene.id),
    );
    for (let i = 0; i < story.scenes.length; i++)
      for (const scene of story.scenes)
        if (scene.choices!.some((choice) => canEnd.has(choice.leadsTo))) canEnd.add(scene.id);
    if (canEnd.size !== ids.size) throw new Error("故事存在无法通往结局的路线");
  }
  if (!brief?.allowCycles)
    assertAcyclic(new Map(story.scenes.map((s) => [s.id, s.choices!.map((c) => c.leadsTo)])));
  if (
    brief &&
    isLinearWork(brief) &&
    (story.scenes.some((s) => s.choices!.length > 1) ||
      story.scenes.filter((s) => !s.choices!.length).length !== 1)
  )
    throw new Error("线性故事只能有自动后继和一个结局");
  if (
    brief?.decisionPoints &&
    !isLinearWork(brief) &&
    story.scenes.filter((s) => s.choices!.length > 1).length !== brief.decisionPoints
  )
    throw new Error("故事决策点数量不符合创作配置");
  return story;
}
export function validateBranches(
  value: unknown,
  scenes: Array<{
    id: string;
    order?: number;
    choices?: Array<{ label: string; leadsTo: string }>;
  }>,
  brief?: CreationBrief,
) {
  const design = branchDesignSchema.parse(value);
  assertCreationContent(design);
  const routes = resolveBranchRoutes(scenes, design);
  if (!brief?.allowCycles)
    assertAcyclic(new Map([...routes].map(([id, choices]) => [id, choices.map((c) => c.leadsTo)])));
  if (brief && isLinearWork(brief) && design.decisionPoints.length)
    throw new Error("线性故事不允许增加决策点");
  if (brief?.decisionPoints && design.decisionPoints.length !== brief.decisionPoints)
    throw new Error("分支决策点数量不符合创作配置");
  return design;
}
export function validateStoryboard(
  value: unknown,
  scenes: Array<{ id: string }>,
  characters: Array<{ name: string }> = [],
) {
  const shots = normalizeShots(value);
  assertCreationContent(shots);
  const ids = new Set(scenes.map((scene) => scene.id));
  for (const shot of shots) {
    if (shot.characterNames?.some((name) => !characters.some((c) => c.name === name)))
      throw new Error("分镜出镜人物引用了未知角色");
    if (!ids.has(shot.sceneId)) throw new Error("分镜引用了不存在的场景");
    if (
      shot.speaker &&
      !characters.some((character) => character.name === shot.speaker) &&
      shot.speaker !== "旁白"
    )
      throw new Error("分镜对白引用了未知角色");
    if (shot.dialogue?.trim() && !shot.speaker) throw new Error("有对白的镜头必须指定 speaker");
  }
  for (const scene of scenes) {
    const group = shots
      .filter((shot) => shot.sceneId === scene.id)
      .sort((a, b) => a.shotIndex - b.shotIndex);
    if (!group.length || group.length > 30 || group.some((shot, index) => shot.shotIndex !== index))
      throw new Error("每个场景必须有 1-30 个连续编号镜头");
  }
  return shots;
}
