"use client";
import NextImage from "next/image";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Film, Play, Search, RefreshCw } from "lucide-react";
import { Alert, Badge, Button, EmptyState } from "@/components/ui";
import type { PlaybackLibraryItem } from "@/lib/story/playback-library";

export function PlaybackLibrary() {
  const [items, setItems] = useState<PlaybackLibraryItem[]>([]);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all"),
    [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetch("/api/playback/projects", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("播放项目加载失败，请重试");
        const data = await response.json();
        if (!controller.signal.aborted) setItems(data);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [refresh]);
  const filtered = items.filter(
    (item) =>
      item.name.toLowerCase().includes(search.trim().toLowerCase()) &&
      (filter === "all" || item.status === filter),
  );
  const labels = { published: "已发布", preview: "可预览", incomplete: "素材未就绪" };
  return (
    <section className="studio-project-page" aria-labelledby="playback-heading">
      <div className="studio-project-heading">
        <div>
          <h1 id="playback-heading">播放</h1>
          <p>选择一部作品，进入由你决定走向的故事。已发布作品播放最新发布版本。</p>
        </div>
        <Button
          variant="secondary"
          disabled={loading}
          onClick={() => setRefresh((value) => value + 1)}
        >
          <RefreshCw size={15} />
          刷新
        </Button>
      </div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1" aria-label="播放状态筛选">
          {[
            { value: "all", label: "全部项目" },
            ...Object.entries(labels).map(([value, label]) => ({ value, label })),
          ].map((option) => (
            <Button
              key={option.value}
              variant={filter === option.value ? "secondary" : "ghost"}
              size="sm"
              aria-pressed={filter === option.value}
              onClick={() => setFilter(option.value)}
            >
              {option.label}
            </Button>
          ))}
        </div>
        <label className="studio-gallery-search">
          <Search size={16} />
          <input
            aria-label="搜索播放项目"
            placeholder="搜索作品…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
      </div>
      {error && (
        <Alert tone="error">
          {error}
          <Button variant="ghost" onClick={() => setRefresh((value) => value + 1)}>
            重试
          </Button>
        </Alert>
      )}
      {loading ? (
        <p role="status" className="py-12 text-center text-sm text-white/50">
          正在加载播放项目…
        </p>
      ) : !error && !filtered.length ? (
        <EmptyState
          icon={<Film size={28} />}
          title={items.length ? "没有符合条件的项目" : "还没有可观看的项目"}
          description={
            items.length ? "试试其他名称或播放状态。" : "先创建故事并准备视频，再回来观看。"
          }
        />
      ) : (
        !error && (
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {filtered.map((item) => (
              <article
                key={item.id}
                className="overflow-hidden rounded-2xl border border-white/10 bg-[#1c1d1f]"
              >
                <div className="relative flex aspect-video items-center justify-center overflow-hidden bg-black/30">
                  {item.cover ? (
                    <NextImage
                      loading="eager"
                      unoptimized
                      width={640}
                      height={360}
                      src={item.cover}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <Film size={40} className="text-white/15" />
                  )}
                  <span className="absolute left-3 top-3">
                    <Badge className="bg-black/75">{labels[item.status]}</Badge>
                  </span>
                  {item.path && (
                    <Link
                      href={item.path}
                      aria-label={`${item.status === "published" ? "播放" : "预览"} ${item.name}`}
                      className="absolute inset-0 flex items-center justify-center bg-black/10 transition-colors hover:bg-black/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-accent"
                    >
                      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-accent text-brand-ink shadow-lg">
                        <Play size={24} fill="currentColor" />
                      </span>
                    </Link>
                  )}
                </div>
                <div className="space-y-4 p-4">
                  <div>
                    <h2 className="truncate font-semibold text-white/90" title={item.name}>
                      {item.name}
                    </h2>
                    <p className="mt-2 text-xs text-white/45">
                      {item.publishedAt
                        ? `发布于 ${new Date(item.publishedAt).toLocaleDateString("zh-CN")}`
                        : `视频素材 ${item.ready}/${item.total}`}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {item.path ? (
                      <Button asChild variant="primary" size="sm">
                        <Link href={item.path}>
                          {item.status === "published" ? "开始观看" : "预览项目"}
                        </Link>
                      </Button>
                    ) : (
                      <Button size="sm" disabled>
                        暂不可播放
                      </Button>
                    )}
                    <Button asChild variant="ghost" size="sm">
                      <Link href={`/editor/${item.id}`}>
                        {item.status === "incomplete" ? "完善项目" : "编辑项目"}
                      </Link>
                    </Button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )
      )}
    </section>
  );
}
