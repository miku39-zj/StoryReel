"use client";
import { segmentedGroupClassName, segmentedItemClassName } from "@/components/ui/segmented-styles";
import { useState, useId } from "react";
import { Button, Alert } from "@/components/ui";
import { Users, Images, ImageIcon, Loader2, Layers } from "lucide-react";
import { useShotProduction } from "./useShotProduction";
import { CharacterDesignPanel } from "./CharacterDesignPanel";
import { SceneDesignPanel } from "./SceneDesignPanel";
import { ShotProductionPanel } from "./ShotProductionPanel";
import { KeyframePanel } from "./KeyframePanel";
import { useCreationStore } from "@/stores/creation-store";

const TABS = [
  { id: "characters", label: "角色", icon: Users },
  { id: "backgrounds", label: "场景", icon: Images },
  { id: "keyframes", label: "关键帧", icon: Layers },
  { id: "frames", label: "画面", icon: ImageIcon },
] as const;

export function VisualAudioPanel() {
  const [selectedTab, setTab] = useState<(typeof TABS)[number]["id"]>("characters");
  const tab = TABS.some((item) => item.id === selectedTab) ? selectedTab : "frames";
  const tabId = useId();
  const { state, busy, error, loadError, generateVisuals, resumeVisuals } = useShotProduction();
  const keyframes = useCreationStore((s) => s.keyframes);
  const sharedCount = keyframes.filter((kf) => {
    const shots = useCreationStore.getState().storyboardShots;
    const refs = shots.filter(
      (s) => s.firstFrameId === kf.id || s.lastFrameId === kf.id,
    ).length;
    return refs > 1;
  }).length;

  // Only show batch generate button for tabs that use the visual batch system
  const batchTab = tab === "characters" ? "characters" : tab === "backgrounds" ? "scenes" : tab === "frames" ? "frames" : null;
  const batch = batchTab ? state.visualBatches?.[batchTab as keyof typeof state.visualBatches] : null;
  const running = batch?.status === "running";
  const waiting = running && state.workerOnline !== true;
  const checking = running && !!loadError;
  const label = TABS.find((t) => t.id === tab)?.label ?? "画面";

  return (
    <div className="h-full overflow-y-auto">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.07] px-3 py-2 lg:px-4">
        <h1 className="sr-only">角色、场景与画面</h1>
        <div role="tablist" aria-label="角色、场景与画面" className={segmentedGroupClassName}>
          {TABS.map(({ id, label: tabLabel, icon: Icon }, index) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`${tabId}-${id}-tab`}
              aria-selected={tab === id}
              aria-controls={`${tabId}-${id}-panel`}
              tabIndex={tab === id ? 0 : -1}
              data-tab={id}
              onClick={() => setTab(id)}
              onKeyDown={(event) => {
                if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                event.preventDefault();
                const next =
                  event.key === "Home"
                    ? TABS[0]
                    : event.key === "End"
                      ? TABS.at(-1)!
                      : TABS[
                          (index + (event.key === "ArrowLeft" ? TABS.length - 1 : 1)) % TABS.length
                        ];
                setTab(next.id);
                event.currentTarget.parentElement
                  ?.querySelector<HTMLButtonElement>(`[data-tab="${next.id}"]`)
                  ?.focus();
              }}
              className={segmentedItemClassName(tab === id)}
            >
              <Icon size={15} />
              {tabLabel}
              {id === "keyframes" && sharedCount > 0 && (
                <span className="ml-1 rounded-full bg-brand-accent/20 px-1 py-0.5 text-[9px] font-bold text-brand-accent leading-none">
                  {sharedCount}
                </span>
              )}
            </button>
          ))}
        </div>
        {batchTab && (
          <Button
            size="sm"
            variant="primary"
            disabled={busy || (running && !waiting && !checking)}
            onClick={() => void (running ? resumeVisuals(batchTab as Parameters<typeof resumeVisuals>[0]) : generateVisuals(batchTab as Parameters<typeof generateVisuals>[0]))}
          >
            {(busy || (running && !waiting && !checking)) && (
              <Loader2 size={14} className="animate-spin" />
            )}
            {busy
              ? "提交计划…"
              : waiting || checking
                ? "继续执行"
                : running
                  ? `${label}批量处理中…`
                  : `${label}批量生成`}
          </Button>
        )}
      </header>
      {(error || batch?.error || waiting || checking) && (
        <div className="space-y-2 px-4 pt-4 lg:px-6">
          {error && error !== loadError && <Alert tone="error">{error}</Alert>}
          {batch?.status === "failed" && batch.error && <Alert tone="error">{batch.error}</Alert>}
          {loadError ? (
            <Alert tone="warning">暂时无法获取任务状态，页面会继续检查。</Alert>
          ) : (
            waiting && (
              <Alert tone="warning">批量计划已保存。点击「继续执行」即可接手现有计划。</Alert>
            )
          )}
        </div>
      )}
      {TABS.map(({ id }) => (
        <div
          key={id}
          role="tabpanel"
          tabIndex={0}
          id={`${tabId}-${id}-panel`}
          aria-labelledby={`${tabId}-${id}-tab`}
          hidden={tab !== id}
        >
          {id === "characters" ? (
            <CharacterDesignPanel />
          ) : id === "backgrounds" ? (
            <SceneDesignPanel />
          ) : id === "keyframes" ? (
            <KeyframePanel />
          ) : (
            <ShotProductionPanel mode="visual" />
          )}
        </div>
      ))}
    </div>
  );
}

