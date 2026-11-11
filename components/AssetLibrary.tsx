"use client";
import NextImage from "next/image";
import { useEffect, useRef, useState } from "react";
import { Button, Alert, Badge, EmptyState } from "@/components/ui";
import { FolderOpen, Upload } from "lucide-react";
import type { LibraryAsset } from "@/lib/assets";

export function AssetLibrary({
  onSelect,
  types,
}: {
  onSelect?: (asset: LibraryAsset) => void;
  types?: LibraryAsset["type"][];
}) {
  const [assets, setAssets] = useState<LibraryAsset[]>([]),
    [filter, setFilter] = useState("all"),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const load = async () => {
    try {
      const response = await fetch("/api/assets", { cache: "no-store" });
      if (!response.ok) throw new Error("素材加载失败");
      setAssets(await response.json());
      setError(null);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const upload = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch("/api/assets", { method: "POST", body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "上传失败");
      setAssets((prev) => [data, ...prev]);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };
  const filtered = assets.filter(
    (a) => (!types || types.includes(a.type)) && (filter === "all" || a.type === filter),
  );
  return (
    <section className="space-y-4" aria-label="素材库">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1">
          {[
            ["all", "全部"],
            ["image", "图片"],
            ["video", "视频"],
            ["audio", "音频"],
          ]
            .filter(
              ([key]) => key === "all" || !types || types.includes(key as LibraryAsset["type"]),
            )
            .map(([key, label]) => (
              <Button
                key={key}
                variant={filter === key ? "secondary" : "ghost"}
                size="sm"
                aria-pressed={filter === key}
                onClick={() => setFilter(key)}
              >
                {label}
              </Button>
            ))}
        </div>
        <Button variant="primary" disabled={busy} onClick={() => input.current?.click()}>
          <Upload size={14} />
          {busy ? "上传中…" : "上传素材"}
        </Button>
        <input
          ref={input}
          type="file"
          className="sr-only"
          aria-label="选择素材文件"
          accept="image/png,image/jpeg,image/webp,video/mp4,audio/mpeg,audio/wav,audio/x-wav"
          onChange={(e) => void upload(e.target.files?.[0])}
        />
      </div>
      <p className="text-xs leading-relaxed text-white/50">
        已上传和逐镜生成的素材会保存在服务端。支持 PNG、JPG、WebP、MP4、MP3、WAV。
      </p>
      {error && (
        <Alert tone="error">
          {error}
          <Button variant="ghost" size="sm" onClick={() => void load()}>
            重新加载
          </Button>
        </Alert>
      )}
      {loading ? (
        <p role="status" className="text-sm text-white/50">
          正在加载素材…
        </p>
      ) : !filtered.length ? (
        <EmptyState
          icon={<FolderOpen size={24} />}
          title="还没有素材"
          description="上传文件，或在镜头生产中生成图片、视频和配音。"
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((asset) => (
            <li key={asset.id} className="min-w-0 space-y-3 rounded-xl border border-white/10 p-3">
              {asset.type === "image" ? (
                <NextImage
                  unoptimized
                  width={640}
                  height={360}
                  src={asset.url}
                  alt={asset.name}
                  loading="lazy"
                  className="aspect-video w-full rounded-lg object-contain bg-oii-surface"
                />
              ) : asset.type === "video" ? (
                <video
                  controls
                  preload="none"
                  src={asset.url}
                  aria-label={asset.name}
                  className="aspect-video w-full rounded-lg bg-oii-surface"
                />
              ) : (
                <audio
                  controls
                  preload="none"
                  src={asset.url}
                  aria-label={asset.name}
                  className="w-full"
                />
              )}
              <p className="break-words text-xs text-white/80">{asset.name}</p>
              <div className="flex flex-wrap items-center gap-2">
                <Badge>
                  {asset.type === "image" ? "图片" : asset.type === "video" ? "视频" : "音频"}
                </Badge>
                {asset.mock && <Badge>演示素材</Badge>}
                <a
                  className="text-xs text-brand-accent underline"
                  href={asset.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  打开素材
                </a>
                {onSelect && (
                  <Button variant="secondary" size="sm" onClick={() => onSelect(asset)}>
                    使用素材
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
