"use client";
import { continuityFields, sceneContinuity, type ContinuityState } from "@/lib/story/continuity";
import { useCanvasStore } from "@/stores/canvas-store";
import { Badge } from "@/components/ui";
import { isLinearWork, type StorySource } from "@/lib/story/creation-brief";
import { resolveBranchRoutes } from "@/lib/story/branch-routes";
import { useCreationStore, type StoryOutline } from "@/stores/creation-store";

export function StoryBlueprint({
  outline,
  source,
  pending,
  stale,
}: {
  outline: StoryOutline | null;
  source: StorySource | null;
  pending: boolean;
  stale: boolean;
}) {
  useCanvasStore((state) => state.edges);
  const project = useCanvasStore.getState().toProject();
  const branches = useCreationStore((s) => s.branchDesign);
  const isLinear = !source || isLinearWork(source.brief);
  let scenes = [...(outline?.scenes ?? [])].sort((a, b) => a.order - b.order);
  if (outline && !pending && branches) {
    try {
      const routes = resolveBranchRoutes(scenes, branches);
      scenes = scenes.map((s) => ({ ...s, choices: routes.get(s.id) }));
    } catch {
      /* Legacy invalid routes remain visible for validation. */
    }
  }
  return (
    <aside
      className="story-support min-w-0 min-[1280px]:sticky min-[1280px]:top-7"
      aria-label="故事蓝图"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <h2 className="text-base font-semibold">故事蓝图</h2>
        {outline && <Badge>{pending ? "待应用" : "已应用"}</Badge>}
      </div>
      {!outline ? (
        <p className="text-xs text-white/45">生成大纲后，在这里预览角色和剧情路线。</p>
      ) : (
        <>
          <h3 className="text-sm font-semibold">{outline.title}</h3>
          <div className="my-3 flex flex-wrap gap-2">
            <Badge>{outline.genre || "未分类"}</Badge>
            {source && (
              <Badge>
                {source.brief.workType === "multi-episode"
                  ? "多集连续剧"
                  : isLinear
                    ? "单集短剧"
                    : "互动剧"}
              </Badge>
            )}
            {stale && (
              <Badge className="text-amber-300">{source ? "设置已变更" : "来源待确认"}</Badge>
            )}
          </div>
          {source && (
            <p className="mb-4 text-xs leading-6 text-white/50">
              {source.brief.narrativeStyle} ·{" "}
              {source.brief.targetDurationSeconds
                ? `${source.brief.targetDurationSeconds} 秒`
                : "时长自动"}
            </p>
          )}
          <details open className="border-t border-white/[0.08] py-3">
            <summary className="cursor-pointer text-sm font-medium">故事简介</summary>
            <p className="mt-3 whitespace-pre-wrap text-xs leading-6 text-white/60">
              {outline.description}
            </p>
          </details>
          <details className="border-t border-white/[0.08] py-3">
            <summary className="cursor-pointer text-sm font-medium">
              角色 · {outline.characters.length}
            </summary>
            {outline.characters.length ? (
              outline.characters.map((c, i) => (
                <div key={i} className="mt-3">
                  <p className="text-sm">
                    {c.name}
                    <span className="ml-2 text-xs text-brand-accent">{c.role}</span>
                  </p>
                  <p className="mt-1 text-xs leading-6 text-white/60">{c.description}</p>
                </div>
              ))
            ) : (
              <p className="mt-3 text-xs text-white/45">未设置角色</p>
            )}
          </details>
          <details open className="border-t border-white/[0.08] py-3">
            <summary className="cursor-pointer text-sm font-medium">
              {isLinear ? "场景" : "场景与分支"} · {scenes.length}
            </summary>
            {!isLinear && (
              <p className="mt-2 text-xs text-white/45">
                {scenes.filter((s) => (s.choices?.length ?? 0) > 1).length} 个决策点 ·{" "}
                {scenes.filter((s) => s.choices?.length === 0).length} 个结局
              </p>
            )}
            <ol className="mt-3 space-y-4">
              {scenes.map((s, i) => (
                <li key={s.id} className="text-xs leading-6">
                  <p className="font-medium text-white/85">
                    第 {s.episode ?? 1} 集 · {String(i + 1).padStart(2, "0")} · {s.title}
                  </p>
                  {!pending && source?.brief.workType !== "single-episode" && (
                    <label className="my-1 flex items-center gap-2 text-white/60">
                      集号
                      <input
                        type="number"
                        min={1}
                        max={5000}
                        value={s.episode ?? 1}
                        className="w-16 rounded border border-white/15 bg-transparent px-2"
                        onChange={(event) => {
                          const episode = event.target.valueAsNumber;
                          if (
                            !outline ||
                            !Number.isInteger(episode) ||
                            episode < 1 ||
                            episode > 5000
                          )
                            return;
                          useCreationStore.getState().setStoryOutline({
                            ...outline,
                            scenes: outline.scenes.map((scene) =>
                              scene.id === s.id ? { ...scene, episode } : scene,
                            ),
                          });
                        }}
                      />
                    </label>
                  )}
                  <p className="text-white/50">{s.description}</p>
                  {!pending && project && source?.brief.workType !== "single-episode" && (
                    <details className="mt-2 rounded border border-white/10 px-2 py-1">
                      <summary className="cursor-pointer">入场与出场状态</summary>
                      {(["entryState", "exitState"] as const).map((phase) => (
                        <fieldset key={phase} className="mt-2 space-y-1">
                          <legend>{phase === "entryState" ? "入场" : "出场"}</legend>
                          {(
                            Object.entries(continuityFields) as [keyof ContinuityState, string][]
                          ).map(([key, label]) => (
                            <label key={key} className="flex items-center gap-2">
                              <span className="w-24 shrink-0">{label}</span>
                              <input
                                value={s[phase]?.[key] ?? ""}
                                maxLength={500}
                                className="min-w-0 flex-1 rounded border border-white/15 bg-transparent px-2"
                                placeholder={
                                  phase === "entryState"
                                    ? sceneContinuity(project, s.id).entry[key]
                                    : undefined
                                }
                                onChange={(event) => {
                                  const store = useCreationStore.getState();
                                  const current = store.storyOutline;
                                  if (!current) return;
                                  const value = event.target.value;
                                  store.setStoryOutline({
                                    ...current,
                                    scenes: current.scenes.map((item) =>
                                      item.id === s.id
                                        ? {
                                            ...item,
                                            [phase]: { ...item[phase], [key]: value || undefined },
                                          }
                                        : item,
                                    ),
                                  });
                                }}
                              />
                            </label>
                          ))}
                        </fieldset>
                      ))}
                      {sceneContinuity(project, s.id).warnings.map((warning) => (
                        <p key={warning} className="mt-2 text-amber-300">
                          {warning}
                        </p>
                      ))}
                    </details>
                  )}

                  {/* 线性短剧只显示"继续"箭头，不显示决策点标签和结局badge */}
                  {!isLinear &&
                    s.choices?.map((c, j) => (
                      <p key={j} className="mt-1 text-brand-accent">
                        {s.choices!.length === 1 ? "继续" : c.label} →{" "}
                        {scenes.find((target) => target.id === c.leadsTo)?.title ?? "目标缺失"}
                      </p>
                    ))}
                  {/* 单集短剧不展示「结局」badge，最后一场自然收尾 */}
                  {!isLinear && s.choices?.length === 0 && <Badge className="mt-1">结局</Badge>}
                </li>
              ))}
            </ol>
          </details>
        </>
      )}
    </aside>
  );
}
