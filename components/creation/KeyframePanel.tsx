"use client";

import NextImage from "next/image";
import { useCreationStore } from "@/stores/creation-store";
import { useShotProduction } from "./useShotProduction";
import { selectedAsset } from "@/lib/production/types";
import { Link2, ImageIcon, Loader2 } from "lucide-react";
import { Badge, Button, Card, EmptyState } from "@/components/ui";

/**
 * Keyframe管理面板 — 展示所有关键帧（A/B/C…），共享帧只显示一次。
 * 生成图片时走 generate-keyframes 专属路径，不经过镜头列表校验。
 */
export function KeyframePanel() {
  const storyboardShots = useCreationStore((s) => s.storyboardShots);
  const keyframes = useCreationStore((s) => s.keyframes);
  const { state, busy, generateKeyframes } = useShotProduction();

  if (!storyboardShots.length)
    return (
      <div className="p-6">
        <Card>
          <EmptyState icon={<ImageIcon size={24} />} title="请先生成分镜脚本" />
        </Card>
      </div>
    );

  if (!keyframes.length)
    return (
      <div className="p-6">
        <Card>
          <EmptyState icon={<ImageIcon size={24} />} title="分镜脚本中尚无关键帧定义" />
        </Card>
      </div>
    );

  const labelMap = new Map(
    keyframes.map((kf, i) => [kf.id, i < 26 ? String.fromCharCode(65 + i) : `F${i + 1}`]),
  );

  const sharedBy = new Map<string, number[]>();
  for (const shot of storyboardShots) {
    for (const fid of [shot.firstFrameId, shot.lastFrameId]) {
      if (!fid) continue;
      const list = sharedBy.get(fid) ?? [];
      if (!list.includes(shot.shotIndex)) list.push(shot.shotIndex);
      sharedBy.set(fid, list);
    }
  }

  return (
    <div className="p-4 lg:p-6 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-white/90">关键帧</h2>
          <p className="mt-0.5 text-xs text-white/40">
            共享帧（橙色）由多个镜头复用，只生成一次。
          </p>
        </div>
        <Button
          size="sm"
          variant="primary"
          disabled={busy}
          onClick={() => {
            const missing = keyframes.filter((kf) => !selectedAsset(state, kf.id, "image"));
            if (missing.length) void generateKeyframes(missing.map((kf) => kf.id));
          }}
        >
          {busy && <Loader2 size={13} className="animate-spin" />}
          批量生成缺失帧
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {keyframes.map((kf) => {
          const label = labelMap.get(kf.id) ?? "?";
          const usedBy = sharedBy.get(kf.id) ?? [];
          const isShared = usedBy.length > 1;
          const asset = selectedAsset(state, kf.id, "image");
          const job = state.jobs.filter((j) => j.shotId === kf.id && j.kind === "image").at(-1);
          const running = job && ["queued", "running"].includes(job.status);

          return (
            <Card key={kf.id} className="flex flex-col gap-3 overflow-hidden bg-[#171719] p-3">
              <div className="flex items-center gap-2">
                <div
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded border text-[11px] font-bold ${
                    isShared
                      ? "border-brand-accent/50 bg-brand-accent/10 text-brand-accent"
                      : "border-white/[0.12] bg-white/[0.04] text-white/55"
                  }`}
                >
                  {label}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="truncate text-xs font-medium text-white/80">帧 {label}</p>
                  {isShared && (
                    <div className="flex items-center gap-1 text-[10px] text-brand-accent/70">
                      <Link2 size={10} />
                      <span>镜头 {usedBy.map((n) => n + 1).join("、")} 共用</span>
                    </div>
                  )}
                </div>
                {isShared && (
                  <Badge className="border-brand-accent/30 text-brand-accent text-[10px] shrink-0">
                    共享
                  </Badge>
                )}
              </div>

              {asset ? (
                <NextImage
                  loading="eager"
                  unoptimized
                  width={640}
                  height={360}
                  src={asset.url}
                  alt={`关键帧 ${label}`}
                  className="aspect-video w-full rounded-lg bg-black object-contain"
                />
              ) : (
                <div className="flex aspect-video flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-white/[0.08] bg-black/20 text-white/30">
                  {running ? (
                    <Loader2 size={20} className="animate-spin" />
                  ) : (
                    <ImageIcon size={20} strokeWidth={1.5} />
                  )}
                  <span className="text-xs">{running ? "生成中…" : "待生成"}</span>
                </div>
              )}

              <p className="line-clamp-2 text-[11px] leading-relaxed text-white/40">
                {kf.description}
              </p>

              <Button
                size="sm"
                variant={asset ? "ghost" : "primary"}
                className="w-full"
                disabled={busy || !!running}
                onClick={() => void generateKeyframes([kf.id])}
              >
                {running ? "生成中…" : asset ? "重新生成" : "生成此帧"}
              </Button>
            </Card>
          );
        })}
      </div>
    </div>
  );
}


/**
 * Keyframe管理面板 — 展示所有关键帧（A/B/C…），共享帧只显示一次。
 * 生成图片时以 keyframeId 为 shotId，共享帧只排一个任务。
 */
