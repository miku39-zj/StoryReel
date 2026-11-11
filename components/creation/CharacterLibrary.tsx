"use client";
import NextImage from "next/image";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Search, UserRound, X } from "lucide-react";
import { Button, Card, Alert, EmptyState, Input } from "@/components/ui";
import type { SavedCharacter, CharacterAsset } from "@/lib/characters";
export function CharacterLibrary({
  onSelect,
  onDesign,
  picker,
}: {
  onSelect?: (asset: CharacterAsset) => void;
  onDesign?: (asset?: CharacterAsset) => void;
  picker?: { selected?: CharacterAsset[] };
}) {
  const [items, setItems] = useState<SavedCharacter[]>([]),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [search, setSearch] = useState(""),
    [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    fetch("/api/characters", { cache: "no-store", signal: abort.signal })
      .then(async (response) => {
        if (!response.ok) throw Error("角色库加载失败");
        return response.json();
      })
      .then((data) => {
        if (!abort.signal.aborted) {
          setItems(data);
          setError("");
        }
      })
      .catch((error) => {
        if (!abort.signal.aborted) setError(error.message);
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [refresh]);
  const filtered = items.filter((item) => item.name.toLowerCase().includes(search.toLowerCase()));
  return (
    <section className="space-y-5" aria-label="角色库">
      {!picker && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-semibold">角色库</h2>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setRefresh((n) => n + 1)}>
              刷新
            </Button>
            {onDesign && (
              <Button variant="primary" onClick={() => onDesign()}>
                新建角色
              </Button>
            )}
          </div>
        </div>
      )}
      <div className="relative">
        {picker && (
          <Search
            aria-hidden="true"
            size={16}
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-white/45"
          />
        )}
        <Input
          aria-label="搜索角色"
          className={picker ? "pl-9" : undefined}
          placeholder="搜索角色…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      {error && (
        <Alert tone="error">
          {error}{" "}
          <Button size="sm" onClick={() => setRefresh((n) => n + 1)}>
            重试
          </Button>
        </Alert>
      )}
      {loading ? (
        <p role="status">正在加载角色…</p>
      ) : !filtered.length ? (
        <EmptyState icon={null} title={search ? "没有匹配的角色" : "角色库暂无角色"} />
      ) : picker && onSelect ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {filtered.map((item) => {
            const selected =
              picker.selected?.some((character) => character.id === item.id) ?? false;
            return (
              <button
                key={item.id}
                type="button"
                aria-pressed={picker.selected ? selected : undefined}
                disabled={!selected && (picker.selected?.length ?? 0) >= 20}
                onClick={() => onSelect(item)}
                className="flex min-w-0 items-center gap-3 rounded-xl border border-white/10 bg-white/[0.025] p-2.5 text-left transition-colors hover:bg-white/[0.06] focus-visible:outline-2 focus-visible:outline-brand-accent aria-pressed:border-brand-accent/60 aria-pressed:bg-brand-accent/10 disabled:opacity-40"
              >
                <span className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-lg bg-black/30 text-white/45">
                  {item.imageUrl ? (
                    <NextImage
                      unoptimized
                      width={56}
                      height={56}
                      src={item.imageUrl}
                      alt=""
                      className="size-full object-cover"
                    />
                  ) : (
                    <UserRound size={20} />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{item.name}</span>
                  <span className="mt-1 line-clamp-2 text-xs leading-relaxed text-white/55">
                    {item.description}
                  </span>
                </span>
                {selected && (
                  <Check size={16} className="shrink-0 text-brand-accent" aria-hidden="true" />
                )}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((item) => (
            <Card key={item.id} className="space-y-3 p-4">
              {item.imageUrl && (
                <NextImage
                  unoptimized
                  width={512}
                  height={512}
                  src={item.imageUrl}
                  alt={item.name}
                  className="aspect-square w-full rounded-lg bg-black/30 object-contain"
                />
              )}
              <h3 className="font-semibold">{item.name}</h3>
              <p className="line-clamp-3 whitespace-pre-wrap text-xs text-white/55">
                {item.description}
              </p>
              <div className="flex gap-2">
                {onSelect && (
                  <Button variant="primary" size="sm" onClick={() => onSelect(item)}>
                    添加到剧本
                  </Button>
                )}
                {onDesign && (
                  <Button size="sm" onClick={() => onDesign(item)}>
                    设计角色
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}
export function CharacterPicker({
  open,
  onClose,
  onSelect,
  selected,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (asset: CharacterAsset) => void;
  selected?: CharacterAsset[];
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const element = dialog.current;
    if (!open || !element) return;
    element.showModal();
    return () => element.close();
  }, [open]);

  if (!open) return null;
  return createPortal(
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      className="fixed inset-0 m-auto max-h-[min(80dvh,680px)] w-[calc(100%-2rem)] max-w-2xl overflow-hidden rounded-2xl border border-white/15 bg-[#1c1c1f] p-0 text-white shadow-2xl backdrop:bg-black/65"
    >
      <div className="flex max-h-[min(80dvh,680px)] flex-col">
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-white/10 px-5 py-4">
          <div>
            <h2 id={titleId} className="text-lg font-semibold">
              从角色库选用角色
            </h2>
            <p id={descriptionId} className="mt-1 text-sm text-white/55">
              将已有角色的设定和参考图带入本次创作。
            </p>
          </div>
          <Button variant="ghost" size="sm" aria-label="关闭角色选择" onClick={onClose}>
            <X size={18} />
          </Button>
        </header>
        <div className="min-h-0 overflow-y-auto px-5 py-4">
          <CharacterLibrary
            picker={{ selected }}
            onSelect={(asset) => {
              onSelect(asset);
              if (!selected) onClose();
            }}
          />
        </div>
        {selected && (
          <footer className="shrink-0 space-y-3 border-t border-white/10 px-5 py-3">
            {selected.length > 0 && (
              <div className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto">
                {selected.map((character) => (
                  <button
                    key={character.id}
                    type="button"
                    aria-label={`移除角色 ${character.name}`}
                    onClick={() => onSelect(character)}
                    className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.07] px-2.5 py-1 text-xs hover:bg-white/15"
                  >
                    {character.name}
                    <X size={12} aria-hidden="true" />
                  </button>
                ))}
              </div>
            )}
            <div className="flex items-center justify-between gap-3">
              <span role="status" className="text-sm text-white/55">
                已选 {selected.length} / 20
              </span>
              <Button variant="primary" size="sm" onClick={onClose}>
                完成
              </Button>
            </div>
          </footer>
        )}
      </div>
    </dialog>,
    document.body,
  );
}
