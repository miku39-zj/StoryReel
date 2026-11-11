# Components — Shared UI Primitives (Full Source)

All components are React 19 client components using Tailwind CSS + inline styles. No UI library (no shadcn, no MUI). Icons from `lucide-react`.

---

## Canvas Nodes

### VideoNode

File: `/Users/lizejun/newbee/components/canvas/nodes/VideoNode.tsx`

```tsx
"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { VideoNodeData } from "@/lib/story/types";
import { Film, Loader2, CheckCircle, AlertCircle, Clock, Play } from "lucide-react";

const STATUS = {
  idle: null,
  pending: <Loader2 size={9} className="animate-spin text-blue-400" />,
  generating: <Loader2 size={9} className="animate-spin text-amber-400" />,
  done: <CheckCircle size={9} className="text-emerald-400" />,
  failed: <AlertCircle size={9} className="text-red-400" />,
} as const;

export const VideoNode = memo(function VideoNode({ data, selected }: NodeProps) {
  const d = data as VideoNodeData;
  const status = d.generationStatus ?? "idle";

  return (
    <div
      style={{
        width: 180,
        background: "#141414",
        borderRadius: 16,
        overflow: "hidden",
        border: selected
          ? "1px solid rgba(233,30,140,0.55)"
          : "1px solid rgba(255,255,255,0.08)",
        boxShadow: selected
          ? "0 0 0 3px rgba(233,30,140,0.12), 0 4px 24px rgba(0,0,0,0.6)"
          : "0 2px 10px rgba(0,0,0,0.5)",
      }}
    >
      {/* Thumbnail area */}
      <div
        style={{
          position: "relative",
          height: 90,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          background: d.thumbnailUrl
            ? "transparent"
            : "linear-gradient(160deg,#1a1a28 0%,#111118 100%)",
        }}
      >
        {d.thumbnailUrl ? (
          <img
            src={d.thumbnailUrl}
            alt={d.title}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : (
          <div
            style={{
              width: 36, height: 36, borderRadius: 10,
              display: "flex", alignItems: "center", justifyContent: "center",
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.07)",
            }}
          >
            <Film size={16} style={{ color: "rgba(255,255,255,0.22)" }} />
          </div>
        )}

        {/* Selected top pink glow */}
        {selected && (
          <div style={{
            position: "absolute", inset: "0 0 auto 0", height: 32,
            background: "linear-gradient(to bottom,rgba(233,30,140,0.08),transparent)",
            pointerEvents: "none",
          }} />
        )}

        {/* Status badge */}
        {STATUS[status] && (
          <div style={{
            position: "absolute", top: 6, right: 6,
            width: 18, height: 18, borderRadius: "50%",
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)",
          }}>
            {STATUS[status]}
          </div>
        )}

        {/* Interaction time label */}
        {d.interactionAt !== undefined && (
          <div style={{
            position: "absolute", bottom: 5, left: 6,
            display: "flex", alignItems: "center", gap: 3,
            padding: "1px 6px", borderRadius: 999,
            fontSize: 9, fontWeight: 600,
            background: "rgba(245,158,11,0.9)", color: "#000",
          }}>
            <Clock size={7} />
            {d.interactionAt}s
          </div>
        )}

        {/* Generating overlay */}
        {status === "generating" && (
          <div style={{
            position: "absolute", inset: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "rgba(0,0,0,0.5)", backdropFilter: "blur(3px)", gap: 5,
          }}>
            <Loader2 size={11} className="animate-spin text-amber-300" />
            <span style={{ fontSize: 10, color: "#fcd34d", fontWeight: 500 }}>生成中…</span>
          </div>
        )}

        {/* Hover play button when done */}
        {status === "done" && d.videoUrl && (
          <div
            className="group"
            style={{
              position: "absolute", inset: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
              background: "rgba(0,0,0,0)", transition: "background 200ms",
            }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLDivElement).style.background = "rgba(0,0,0,0.35)")}
            onMouseLeave={(e) => ((e.currentTarget as HTMLDivElement).style.background = "rgba(0,0,0,0)")}
          >
            <div style={{
              width: 32, height: 32, borderRadius: "50%",
              display: "flex", alignItems: "center", justifyContent: "center",
              background: "#e91e8c", boxShadow: "0 2px 8px rgba(233,30,140,0.5)",
              opacity: 0, transition: "opacity 200ms",
            }} className="group-hover:opacity-100">
              <Play size={12} style={{ color: "#fff", marginLeft: 1 }} />
            </div>
          </div>
        )}
      </div>

      {/* Info area */}
      <div style={{ padding: "8px 10px 10px" }}>
        <p style={{
          margin: 0, fontSize: 12, fontWeight: 400, lineHeight: 1.4,
          color: selected ? "#fff" : "rgba(255,255,255,0.82)",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {d.title}
        </p>
        {d.description && (
          <p style={{
            margin: "2px 0 0", fontSize: 10, color: "rgba(255,255,255,0.32)",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {d.description}
          </p>
        )}
      </div>

      {/* Selected bottom pink gradient line */}
      {selected && (
        <div style={{
          height: 1,
          background: "linear-gradient(90deg,transparent 5%,rgba(233,30,140,0.65) 50%,transparent 95%)",
        }} />
      )}

      <Handle type="target" position={Position.Left}
        style={{ width: 7, height: 7, background: selected ? "#e91e8c" : "rgba(255,255,255,0.18)", border: "none", left: -3.5, transition: "background 150ms" }} />
      <Handle type="source" position={Position.Right}
        style={{ width: 7, height: 7, background: selected ? "#e91e8c" : "rgba(255,255,255,0.18)", border: "none", right: -3.5, transition: "background 150ms" }} />
    </div>
  );
});
```

**Props:** `NodeProps` from `@xyflow/react`. Data typed as `VideoNodeData` (`title`, `description?`, `videoUrl?`, `thumbnailUrl?`, `generationStatus?`, `interactionAt?`).

---

### ChoiceNode

File: `/Users/lizejun/newbee/components/canvas/nodes/ChoiceNode.tsx`

```tsx
"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { ChoiceNodeData } from "@/lib/story/types";
import { HelpCircle } from "lucide-react";

export const ChoiceNode = memo(function ChoiceNode({ data, selected }: NodeProps) {
  const d = data as ChoiceNodeData;

  return (
    <div
      className="w-[180px] rounded-2xl px-4 py-3 flex flex-col items-center gap-2"
      style={{
        background: "#1a1200",
        border: `1.5px solid ${selected ? "rgba(245,158,11,0.7)" : "rgba(245,158,11,0.18)"}`,
        boxShadow: selected
          ? "0 0 0 3px rgba(245,158,11,0.12), 0 4px 20px rgba(0,0,0,0.6)"
          : "0 2px 12px rgba(0,0,0,0.5)",
      }}
    >
      <div className="w-8 h-8 rounded-full flex items-center justify-center"
        style={{ background: "rgba(245,158,11,0.15)" }}>
        <HelpCircle size={16} style={{ color: "#f59e0b" }} />
      </div>
      <p className="text-[12px] font-semibold text-center leading-snug"
        style={{ color: "rgba(255,255,255,0.9)" }}>
        {d.question || "你会怎么做？"}
      </p>
      {d.timeoutSecs !== undefined && (
        <span className="text-[10px] px-2 py-0.5 rounded-full"
          style={{ background: "rgba(245,158,11,0.12)", color: "rgba(245,158,11,0.7)" }}>
          {d.timeoutSecs}s 后继续
        </span>
      )}
      <Handle type="target" position={Position.Left}
        style={{ width: 8, height: 8, background: "rgba(245,158,11,0.4)", border: "none", left: -4 }} />
      <Handle type="source" position={Position.Right}
        style={{ width: 8, height: 8, background: "rgba(245,158,11,0.4)", border: "none", right: -4 }} />
    </div>
  );
});
```

**Props:** `NodeProps`. Data typed as `ChoiceNodeData` (`question?`, `timeoutSecs?`).

---

### ConditionNode

File: `/Users/lizejun/newbee/components/canvas/nodes/ConditionNode.tsx`

```tsx
"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { ConditionNodeData } from "@/lib/story/types";
import { GitBranch } from "lucide-react";

export const ConditionNode = memo(function ConditionNode({ data, selected }: NodeProps) {
  const d = data as ConditionNodeData;
  const expr = d.variable && d.operator && d.value !== undefined
    ? `${d.variable} ${d.operator} ${d.value}`
    : "条件判断";

  return (
    <div
      className="w-[170px] rounded-2xl px-4 py-3 flex flex-col items-center gap-2"
      style={{
        background: "#0d0918",
        border: `1.5px solid ${selected ? "rgba(139,92,246,0.7)" : "rgba(139,92,246,0.18)"}`,
        boxShadow: selected
          ? "0 0 0 3px rgba(139,92,246,0.12), 0 4px 20px rgba(0,0,0,0.6)"
          : "0 2px 12px rgba(0,0,0,0.5)",
      }}
    >
      <div className="w-8 h-8 rounded-full flex items-center justify-center"
        style={{ background: "rgba(139,92,246,0.15)" }}>
        <GitBranch size={15} style={{ color: "#8b5cf6" }} />
      </div>
      <p className="text-[11px] font-mono text-center px-1 py-0.5 rounded"
        style={{ background: "rgba(139,92,246,0.1)", color: "rgba(167,139,250,0.9)" }}>
        {expr}
      </p>
      <Handle type="target" position={Position.Left}
        style={{ width: 8, height: 8, background: "rgba(139,92,246,0.4)", border: "none", left: -4 }} />
      <Handle type="source" position={Position.Right}
        style={{ width: 8, height: 8, background: "rgba(139,92,246,0.4)", border: "none", right: -4 }} />
    </div>
  );
});
```

**Props:** `NodeProps`. Data typed as `ConditionNodeData` (`variable?`, `operator?`, `value?`).

---

### MergeNode

File: `/Users/lizejun/newbee/components/canvas/nodes/MergeNode.tsx`

```tsx
"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { MergeNodeData } from "@/lib/story/types";
import { GitMerge } from "lucide-react";

export const MergeNode = memo(function MergeNode({ data, selected }: NodeProps) {
  const d = data as MergeNodeData;
  return (
    <div
      className="w-[150px] rounded-2xl px-3 py-2.5 flex items-center gap-2.5"
      style={{
        background: "#081408",
        border: `1.5px solid ${selected ? "rgba(34,197,94,0.7)" : "rgba(34,197,94,0.18)"}`,
        boxShadow: selected
          ? "0 0 0 3px rgba(34,197,94,0.12), 0 4px 20px rgba(0,0,0,0.6)"
          : "0 2px 12px rgba(0,0,0,0.5)",
      }}
    >
      <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
        style={{ background: "rgba(34,197,94,0.15)" }}>
        <GitMerge size={14} style={{ color: "#22c55e" }} />
      </div>
      <span className="text-[12px] font-semibold truncate"
        style={{ color: "rgba(255,255,255,0.8)" }}>
        {d.label || "汇合"}
      </span>
      <Handle type="target" position={Position.Left}
        style={{ width: 8, height: 8, background: "rgba(34,197,94,0.4)", border: "none", left: -4 }} />
      <Handle type="source" position={Position.Right}
        style={{ width: 8, height: 8, background: "rgba(34,197,94,0.4)", border: "none", right: -4 }} />
    </div>
  );
});
```

**Props:** `NodeProps`. Data typed as `MergeNodeData` (`label?`).

---

### EndingNode

File: `/Users/lizejun/newbee/components/canvas/nodes/EndingNode.tsx`

```tsx
"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { EndingNodeData } from "@/lib/story/types";
import { Trophy } from "lucide-react";

export const EndingNode = memo(function EndingNode({ data, selected }: NodeProps) {
  const d = data as EndingNodeData;
  return (
    <div
      className="w-[180px] rounded-2xl px-4 py-3 flex flex-col items-center gap-2"
      style={{
        background: "#180808",
        border: `1.5px solid ${selected ? "rgba(239,68,68,0.7)" : "rgba(239,68,68,0.2)"}`,
        boxShadow: selected
          ? "0 0 0 3px rgba(239,68,68,0.12), 0 4px 20px rgba(0,0,0,0.6)"
          : "0 2px 12px rgba(0,0,0,0.5)",
      }}
    >
      <div className="w-8 h-8 rounded-full flex items-center justify-center"
        style={{ background: "rgba(239,68,68,0.12)" }}>
        <Trophy size={15} style={{ color: "#ef4444" }} />
      </div>
      <p className="text-[13px] font-bold text-center" style={{ color: "rgba(255,255,255,0.9)" }}>
        {d.title || "结局"}
      </p>
      {d.description && (
        <p className="text-[11px] text-center leading-snug"
          style={{ color: "rgba(255,255,255,0.35)" }}>
          {d.description}
        </p>
      )}
      <Handle type="target" position={Position.Left}
        style={{ width: 8, height: 8, background: "rgba(239,68,68,0.4)", border: "none", left: -4 }} />
      {/* No source handle — terminal node */}
    </div>
  );
});
```

**Props:** `NodeProps`. Data typed as `EndingNodeData` (`title?`, `description?`). Terminal node — no source handle.

---

## Player Components

### ChoiceOverlay

File: `/Users/lizejun/newbee/components/player/ChoiceOverlay.tsx`

```tsx
"use client";

import type { PlayerChoice } from "@/lib/story/types";

interface Props {
  choices: PlayerChoice[];
  onChoose: (edgeId: string) => void;
}

export function ChoiceOverlay({ choices, onChoose }: Props) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-end pb-16 bg-gradient-to-t from-black/80 via-black/20 to-transparent">
      <div className="flex flex-col gap-3 w-full max-w-lg px-6">
        {choices.map((choice) => (
          <button
            key={choice.edgeId}
            onClick={() => onChoose(choice.edgeId)}
            className="w-full rounded-xl border border-white/30 bg-white/10 backdrop-blur-sm px-6 py-4 text-white font-semibold text-base text-left hover:bg-white/20 hover:border-white/60 transition-all active:scale-[0.98]"
          >
            {choice.label}
          </button>
        ))}
      </div>
    </div>
  );
}
```

**Props:** `choices: PlayerChoice[]` (array of `{ edgeId, label }`), `onChoose: (edgeId: string) => void`.

---

### EndingScreen

File: `/Users/lizejun/newbee/components/player/EndingScreen.tsx`

```tsx
"use client";

import type { EndingNodeData } from "@/lib/story/types";
import { RotateCcw, Trophy } from "lucide-react";

interface Props {
  ending: EndingNodeData | null;
  onRestart: () => void;
}

export function EndingScreen({ ending, onRestart }: Props) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/90 text-white gap-6 px-8">
      <Trophy size={48} className="text-yellow-400" />
      <div className="text-center">
        <h2 className="text-3xl font-bold mb-2">{ending?.title ?? "结局"}</h2>
        {ending?.description && (
          <p className="text-slate-400 text-base">{ending.description}</p>
        )}
      </div>
      <button
        onClick={onRestart}
        className="flex items-center gap-2 rounded-xl bg-white/10 border border-white/20 hover:bg-white/20 px-8 py-3 font-semibold transition-all"
      >
        <RotateCcw size={16} />
        重新开始
      </button>
    </div>
  );
}
```

**Props:** `ending: EndingNodeData | null`, `onRestart: () => void`.

---

### StoryPlayer

File: `/Users/lizejun/newbee/components/player/StoryPlayer.tsx`

```tsx
"use client";

import { useRef, useEffect, useCallback } from "react";
import { usePlayerStore } from "@/stores/player-store";
import { ChoiceOverlay } from "./ChoiceOverlay";
import { EndingScreen } from "./EndingScreen";
import { Loader2 } from "lucide-react";

export function StoryPlayer() {
  const videoRef = useRef<HTMLVideoElement>(null);

  const phase = usePlayerStore((s) => s.phase);
  const currentVideoUrl = usePlayerStore((s) => s.currentVideoUrl);
  const currentVideoStart = usePlayerStore((s) => s.currentVideoStart);
  const interactionAt = usePlayerStore((s) => s.interactionAt);
  const choices = usePlayerStore((s) => s.choices);
  const ending = usePlayerStore((s) => s.ending);
  const onInteractionPoint = usePlayerStore((s) => s.onInteractionPoint);
  const choose = usePlayerStore((s) => s.choose);
  const reset = usePlayerStore((s) => s.reset);

  // Switch video src when currentVideoUrl changes
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !currentVideoUrl) return;
    video.src = currentVideoUrl;
    video.currentTime = currentVideoStart;
    if (phase === "playing") video.play().catch(() => {});
  }, [currentVideoUrl, currentVideoStart]);

  // timeupdate → pause at interactionAt; ended → onInteractionPoint
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const handleTimeUpdate = () => {
      if (interactionAt !== undefined && video.currentTime >= interactionAt) {
        video.pause();
        onInteractionPoint();
      }
    };
    const handleEnded = () => onInteractionPoint();
    video.addEventListener("timeupdate", handleTimeUpdate);
    video.addEventListener("ended", handleEnded);
    return () => {
      video.removeEventListener("timeupdate", handleTimeUpdate);
      video.removeEventListener("ended", handleEnded);
    };
  }, [interactionAt, onInteractionPoint]);

  // Sync play/pause to phase
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (phase === "playing") video.play().catch(() => {});
    else if (phase === "awaiting" || phase === "ended") video.pause();
  }, [phase]);

  const handleChoose = useCallback((edgeId: string) => { choose(edgeId); }, [choose]);

  if (phase === "idle") {
    return (
      <div className="flex h-full items-center justify-center bg-black text-slate-400">
        <Loader2 size={32} className="animate-spin" />
      </div>
    );
  }

  return (
    <div className="relative h-full w-full bg-black overflow-hidden">
      <video ref={videoRef} className="h-full w-full object-contain" playsInline />

      {/* No video placeholder */}
      {phase === "playing" && !currentVideoUrl && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/90">
          <p className="text-slate-400 text-sm">此场景暂无视频</p>
          <button onClick={onInteractionPoint}
            className="px-5 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-sm text-white transition-colors">
            跳过
          </button>
        </div>
      )}

      {phase === "awaiting" && choices.length > 0 && (
        <ChoiceOverlay choices={choices} onChoose={handleChoose} />
      )}

      {phase === "ended" && (
        <EndingScreen ending={ending} onRestart={reset} />
      )}
    </div>
  );
}
```

**Props:** None — reads all state from `usePlayerStore`.

**Player phases:** `idle` → `playing` → `awaiting` (choice visible) → `playing` (after choice) → `ended`.

---

## NodeDetailPanel

File: `/Users/lizejun/newbee/components/panels/NodeDetailPanel.tsx`

Full panel component with sub-editors. Reads selected node/edge from `useCanvasStore`. Renders the appropriate sub-editor based on node type.

**Sub-editors (all defined in the same file):**
- `VideoNodeEditor` — title, scenePrompt, videoUrl, interactionAt, AI generate button (streams `/api/ai/agent`)
- `ChoiceNodeEditor` — question, timeoutSecs
- `EndingNodeEditor` — title, description
- `MergeNodeEditor` — label
- `ConditionNodeEditor` — variable, operator (select: `==`, `!=`, `>`, `<`, `>=`, `<=`), value
- `EdgeDetailPanel` — choiceLabel, condition expression

**Shared primitives inside NodeDetailPanel:**
```tsx
function Label({ children }) { /* xs muted label */ }
const inputClass = "w-full rounded-lg px-3 py-2 text-sm text-white focus:outline-none transition-colors duration-150 focus:border-white/20";
const inputStyle = { background: "#1a1a1a", border: "1px solid rgba(255,255,255,0.08)" };
```

---

## AICreationPipeline

File: `/Users/lizejun/newbee/components/creation/AICreationPipeline.tsx`

```tsx
"use client";

import { useCreationStore, PIPELINE_STEPS, type PipelineStep } from "@/stores/creation-store";
import { CheckCircle, Circle, Loader2, AlertCircle } from "lucide-react";
import { StoryAgentPanel } from "./StoryAgentPanel";
import { BranchAgentPanel } from "./BranchAgentPanel";
import { StoryboardPanel } from "./StoryboardPanel";
import { VisualAudioPanel } from "./VisualAudioPanel";
import { VideoGenPanel } from "./VideoGenPanel";
import { ValidationPanel } from "./ValidationPanel";

const stepComponents: Record<PipelineStep, React.FC> = {
  story: StoryAgentPanel,
  branch: BranchAgentPanel,
  storyboard: StoryboardPanel,
  visual: VisualAudioPanel,
  video: VideoGenPanel,
  validate: ValidationPanel,
};

const STEP_ACCENTS: Record<PipelineStep, string> = {
  story: "#3b82f6", branch: "#f59e0b", storyboard: "#8b5cf6",
  visual: "#ec4899", video: "#f97316", validate: "#14b8a6",
};

export function AICreationPipeline() {
  const activeStep = useCreationStore((s) => s.activeStep);
  const stepStatuses = useCreationStore((s) => s.stepStatuses);
  const setActiveStep = useCreationStore((s) => s.setActiveStep);
  const ActivePanel = stepComponents[activeStep];

  return (
    <div className="flex h-full min-h-0 bg-[#0a0a0a]">
      {/* Left step nav */}
      <aside className="w-60 shrink-0 flex flex-col py-5 overflow-y-auto"
        style={{ borderRight: "1px solid rgba(255,255,255,0.05)" }}>
        <div className="px-5 mb-4">
          <p className="text-[10px] font-semibold tracking-widest uppercase"
            style={{ color: "rgba(255,255,255,0.25)" }}>AI 创作链路</p>
        </div>
        {PIPELINE_STEPS.map((step, i) => {
          const status = stepStatuses[step.id];
          const isActive = activeStep === step.id;
          const accent = STEP_ACCENTS[step.id];
          const isDone = status === "done";
          const isRunning = status === "running";
          return (
            <div key={step.id} className="relative">
              <button
                onClick={() => setActiveStep(step.id)}
                className="w-full flex items-start gap-3 px-4 py-3 text-left transition-all duration-150"
                style={{
                  background: isActive ? `${accent}0d` : "transparent",
                  borderLeft: isActive ? `2px solid ${accent}` : "2px solid transparent",
                }}
              >
                <div className="shrink-0 flex flex-col items-center mt-0.5">
                  <div className="w-5 h-5 rounded-full flex items-center justify-center"
                    style={{
                      background: isActive ? `${accent}20` : isDone ? "rgba(34,197,94,0.12)" : "rgba(255,255,255,0.04)",
                      border: `1px solid ${isActive ? `${accent}50` : isDone ? "rgba(34,197,94,0.3)" : "rgba(255,255,255,0.08)"}`,
                    }}>
                    {isRunning ? <Loader2 size={10} className="animate-spin" style={{ color: accent }} />
                      : isDone ? <CheckCircle size={10} style={{ color: "#22c55e" }} />
                      : status === "error" ? <AlertCircle size={10} style={{ color: "#ef4444" }} />
                      : <span className="text-[9px] font-mono font-bold"
                          style={{ color: isActive ? accent : "rgba(255,255,255,0.2)" }}>{step.no}</span>}
                  </div>
                  {i < PIPELINE_STEPS.length - 1 && (
                    <div className="w-px mt-1" style={{ height: 28, background: isDone ? "rgba(34,197,94,0.25)" : "rgba(255,255,255,0.06)" }} />
                  )}
                </div>
                <div className="flex-1 min-w-0 pb-1">
                  <p className="text-[12px] font-semibold truncate leading-tight"
                    style={{ color: isActive ? "#fff" : "rgba(255,255,255,0.5)" }}>{step.title}</p>
                  {isActive && (
                    <p className="text-[10px] mt-0.5 leading-tight"
                      style={{ color: "rgba(255,255,255,0.3)" }}>{step.description}</p>
                  )}
                </div>
              </button>
            </div>
          );
        })}
      </aside>

      {/* Right content panel */}
      <div className="flex-1 min-w-0 overflow-hidden">
        <ActivePanel />
      </div>
    </div>
  );
}
```

**Pipeline steps:** story → branch → storyboard → visual → video → validate. Step panel components live in `/Users/lizejun/newbee/components/creation/` (StoryAgentPanel, BranchAgentPanel, StoryboardPanel, VisualAudioPanel, VideoGenPanel, ValidationPanel — not read in this pass).
