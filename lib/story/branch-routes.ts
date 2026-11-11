import type { BranchDesign } from "@/stores/creation-store";
interface SceneRoute {
  id: string;
  order?: number;
  choices?: Array<{
    label: string;
    leadsTo: string;
  }>;
}
/** One route model for validation and canvas application. Preserve authored single-path continuations. */
export function resolveBranchRoutes(scenes: SceneRoute[], design: BranchDesign) {
  const ordered = [...scenes].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const ids = new Set(ordered.map((scene) => scene.id));
  const decisions = new Map(design.decisionPoints.map((point) => [point.sceneId, point]));
  const endings = new Set(design.endings.map((ending) => ending.sceneId));
  if (
    !ordered.length ||
    ids.size !== ordered.length ||
    !endings.size ||
    decisions.size !== design.decisionPoints.length ||
    endings.size !== design.endings.length
  )
    throw new Error("分支决策点或结局重复、缺失");
  if (design.endings.some((ending) => !ids.has(ending.sceneId) || !ending.title.trim()))
    throw new Error("分支引用了不存在的场景或结局无效");
  for (const point of decisions.values()) {
    if (
      !ids.has(point.sceneId) ||
      endings.has(point.sceneId) ||
      !point.question.trim() ||
      point.choices.length < 2 ||
      new Set(point.choices.map((choice) => choice.targetSceneId)).size !== point.choices.length ||
      point.choices.some(
        (choice) =>
          !ids.has(choice.targetSceneId) ||
          choice.targetSceneId === point.sceneId ||
          !choice.label.trim(),
      )
    )
      throw new Error("分支引用了不存在的场景或选项无效");
  }
  const routes = new Map<
    string,
    Array<{
      label: string;
      leadsTo: string;
    }>
  >();
  ordered.forEach((scene, index) => {
    const decision = decisions.get(scene.id);
    const continuation =
      scene.choices?.length === 1
        ? scene.choices[0]
        : ordered[index + 1]
          ? { label: "继续", leadsTo: ordered[index + 1].id }
          : undefined;
    const choices = endings.has(scene.id)
      ? []
      : decision
        ? decision.choices.map((choice) => ({ label: choice.label, leadsTo: choice.targetSceneId }))
        : continuation
          ? [continuation]
          : undefined;
    if (!choices) throw new Error("最后一个场景必须配置结局或决策点");
    if (choices.some((choice) => !ids.has(choice.leadsTo)))
      throw new Error("分支引用了不存在的场景");
    routes.set(scene.id, choices);
  });
  const reachable = new Set<string>(),
    pending = [ordered[0].id];
  for (let i = 0; i < pending.length; i++)
    if (!reachable.has(pending[i])) {
      reachable.add(pending[i]);
      pending.push(...routes.get(pending[i])!.map((choice) => choice.leadsTo));
    }
  if (reachable.size !== ids.size) throw new Error("分支存在无法到达的场景");
  const predecessors = new Map<string, string[]>();
  for (const [source, choices] of routes)
    for (const choice of choices)
      predecessors.set(choice.leadsTo, [...(predecessors.get(choice.leadsTo) ?? []), source]);
  const canEnd = new Set<string>(),
    queue = [...endings];
  for (let i = 0; i < queue.length; i++)
    if (!canEnd.has(queue[i])) {
      canEnd.add(queue[i]);
      queue.push(...(predecessors.get(queue[i]) ?? []));
    }
  if (canEnd.size !== ids.size) throw new Error("分支存在无法通往结局的路线");
  return routes;
}
