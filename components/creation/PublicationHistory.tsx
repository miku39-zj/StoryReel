"use client";
import { useCallback, useEffect, useState } from "react";
import { Alert, Button, ConfirmDialog, Card } from "@/components/ui";
interface Published {
  id: string;
  name: string;
  publishedAt: string;
  path: string;
}
export function PublicationHistory({
  projectId,
  refreshKey,
  onRevoke,
}: {
  projectId: string;
  refreshKey?: string | null;
  onRevoke?: (id: string) => void;
}) {
  const [items, setItems] = useState<Published[]>([]),
    [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false);
  const url = `/api/projects/${encodeURIComponent(projectId)}/publications`;
  const load = useCallback(async () => {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) throw new Error("发布记录加载失败");
      setItems(await response.json());
      setError(null);
    } catch (error) {
      setError((error as Error).message);
    }
  }, [url]);
  useEffect(() => {
    void load();
  }, [load, refreshKey]);
  const revoke = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`${url}?publicationId=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("撤回失败，请重试");
      onRevoke?.(id);
      await load();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="space-y-3 p-4">
      <h2 className="text-base font-semibold">发布记录</h2>
      {error && (
        <Alert tone="error">
          {error}
          <Button variant="ghost" onClick={() => void load()}>
            重试
          </Button>
        </Alert>
      )}
      {!items.length ? (
        <p className="text-xs text-white/50">暂无发布记录</p>
      ) : (
        <ul className="divide-y divide-white/10">
          {items.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div>
                <a
                  href={item.path}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm text-brand-accent underline"
                >
                  {item.name}
                </a>
                <p className="mt-1 text-xs text-white/45">
                  {new Date(item.publishedAt).toLocaleString("zh-CN")}
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    void navigator.clipboard
                      .writeText(new URL(item.path, window.location.origin).href)
                      .catch(() => setError("复制失败，请打开作品后复制地址"))
                  }
                >
                  复制链接
                </Button>
                <ConfirmDialog
                  title="撤回这个发布版本？"
                  description="原分享链接将无法继续打开，项目草稿和其他发布版本会保留。"
                  confirmText="撤回"
                  onConfirm={() => void revoke(item.id)}
                >
                  <Button variant="danger" size="sm" disabled={busy}>
                    撤回
                  </Button>
                </ConfirmDialog>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
