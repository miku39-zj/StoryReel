import type { StoryProject } from "./types";
import { isContextEdge } from "./connections";

export const continuityFields = {
  costume: "服装",
  props: "道具",
  time: "时间",
  knowledge: "角色已知信息",
} as const;

export type ContinuityState = Partial<Record<keyof typeof continuityFields, string>>;

export function sceneContinuity(project: StoryProject, sceneId: string) {
  const scenes = project.creation?.storyOutline?.scenes ?? [];
  const scene = scenes.find((item) => item.id === sceneId);
  if (!scene || !scenes.some((item) => item.entryState || item.exitState))
    return { entry: {}, sources: [], warnings: [] } as {
      entry: ContinuityState;
      sources: typeof scenes;
      warnings: string[];
    };
  const byId = new Map(project.nodes.map((node) => [node.id, node]));
  const incoming = new Map<string, string[]>();
  for (const edge of project.edges) {
    const source = byId.get(edge.source),
      target = byId.get(edge.target);
    if (!source || !target || isContextEdge(edge, [source, target])) continue;
    const sources = incoming.get(edge.target) ?? [];
    sources.push(edge.source);
    incoming.set(edge.target, sources);
  }
  const origin = `video_${sceneId}`;
  const seen = new Set([origin]);
  const queue = [origin];
  const predecessors = new Set<string>();
  for (const id of queue) {
    for (const source of incoming.get(id) ?? []) {
      if (seen.has(source)) continue;
      seen.add(source);
      const node = byId.get(source);
      if (node?.type !== "video") {
        queue.push(source);
        continue;
      }
      const sourceScene = node.data.shotSceneId ?? source.replace(/^video_/, "");
      if (typeof sourceScene === "string" && sourceScene !== sceneId) predecessors.add(sourceScene);
    }
  }
  const sources = scenes.filter((item) => predecessors.has(item.id));
  const entry = { ...scene?.entryState };
  const warnings: string[] = [];
  for (const [key, label] of Object.entries(continuityFields) as [
    keyof ContinuityState,
    string,
  ][]) {
    const values = [
      ...new Set(sources.map((source) => source.exitState?.[key]?.trim()).filter(Boolean)),
    ];
    if (values.length === 1 && sources.every((source) => source.exitState?.[key]?.trim()))
      entry[key] ??= values[0];
    if (values.length > 1 || (entry[key] && values.some((value) => value !== entry[key])))
      warnings.push(
        `${scene?.title ?? sceneId}的${label}存在承接差异（${sources.map((source) => source.title).join("、")}），请核对入场状态或添加过渡镜头。`,
      );
  }
  return { entry, sources, warnings };
}
