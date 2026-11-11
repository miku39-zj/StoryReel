"use client";
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
            {source && <Badge>{isLinearWork(source.brief) ? "线性短剧" : "互动剧"}</Badge>}
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
                    {String(i + 1).padStart(2, "0")} · {s.title}
                  </p>
                  <p className="text-white/50">{s.description}</p>
                  {/* 线性短剧只显示"继续"箭头，不显示决策点标签和结局badge */}
                  {!isLinear && s.choices?.map((c, j) => (
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
