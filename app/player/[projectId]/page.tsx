"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { usePlayerStore } from "@/stores/player-store";
import { StoryPlayer } from "@/components/player/StoryPlayer";
import Link from "next/link";
import { Button, Card, EmptyState } from "@/components/ui";
import { ArrowLeft, Film } from "lucide-react";
import type { StoryProject } from "@/lib/story/types";

export default function PlayerPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    usePlayerStore.getState().destroy();
    fetch(`/api/publications/${encodeURIComponent(projectId)}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "作品加载失败");
        return data.project as StoryProject;
      })
      .then((project) => {
        if (!active) return;
        if (!project.startNodeId) throw new Error("作品缺少播放起点");
        setName(project.name);
        // Public playback is independent of editor state and browser localStorage.
        usePlayerStore
          .getState()
          .init(project.nodes, project.edges, project.startNodeId, project.initialVariables);
        setLoading(false);
      })
      .catch((error) => {
        if (active) {
          setError(error.message);
          setLoading(false);
        }
      });
    return () => {
      active = false;
      controller.abort();
      usePlayerStore.getState().destroy();
    };
  }, [projectId]);
  if (loading)
    return (
      <div
        role="status"
        className="flex h-dvh items-center justify-center bg-[#101012] text-white/60"
      >
        正在加载作品…
      </div>
    );
  if (error)
    return (
      <div
        role="alert"
        className="flex h-dvh items-center justify-center bg-[#101012] p-5 text-white"
      >
        <Card>
          <EmptyState icon={<Film size={25} />} title="暂时无法观看" description={error}>
            <Button asChild>
              <Link href="/">返回工作台</Link>
            </Button>
          </EmptyState>
        </Card>
      </div>
    );
  return (
    <main className="relative h-dvh w-full bg-[#101012]" aria-label={name}>
      <StoryPlayer />
      <div className="absolute left-4 top-4 z-40 flex max-w-[calc(100%-2rem)] items-center gap-2 rounded-lg bg-black/70 px-3 py-2 text-sm text-white">
        <Button asChild variant="ghost" size="icon-sm">
          <Link href="/?tab=play" aria-label="返回播放列表">
            <ArrowLeft size={16} />
          </Link>
        </Button>
        <span className="truncate">{name}</span>
      </div>
    </main>
  );
}
