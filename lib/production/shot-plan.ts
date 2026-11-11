import type { CreationBrief } from "@/lib/story/creation-brief";
import type { StoryboardShot } from "./shots";

/** Check route durations, never the sum of mutually exclusive footage. */
export function validateShotDuration(
  shots: StoryboardShot[],
  scenes: Array<{ id: string; order: number; choices?: Array<{ leadsTo: string }> }>,
  brief?: CreationBrief,
) {
  if (!brief?.targetDurationSeconds) return;
  const ordered = [...scenes].sort((a, b) => a.order - b.order);
  const durations = new Map(
    ordered.map((s) => [
      s.id,
      shots.filter((shot) => shot.sceneId === s.id).reduce((sum, shot) => sum + shot.duration, 0),
    ]),
  );
  const routes = new Map(
    ordered.map((s, i) => [
      s.id,
      s.choices?.map((c) => c.leadsTo) ?? (ordered[i + 1] ? [ordered[i + 1].id] : []),
    ]),
  );
  const memo = new Map<string, [number, number]>(),
    active = new Set<string>();
  function range(id: string): [number, number] {
    if (active.has(id)) throw new Error("循环剧情不能校验固定观看时长");
    if (memo.has(id)) return memo.get(id)!;
    if (!routes.has(id)) throw new Error("时长规划引用了不存在的场景");
    active.add(id);
    const children = routes.get(id)!.map(range),
      own = durations.get(id)!;
    const result: [number, number] = children.length
      ? [own + Math.min(...children.map((r) => r[0])), own + Math.max(...children.map((r) => r[1]))]
      : [own, own];
    active.delete(id);
    memo.set(id, result);
    return result;
  }
  const [min, max] = range(ordered[0].id),
    target = brief.targetDurationSeconds;
  if (min < target * 0.75 || max > target * 1.25)
    throw new Error(
      `分镜观看路线为 ${min}–${max} 秒，未达到目标约 ${target} 秒（允许 ±25%），请调整镜头数量或时长`,
    );
}
