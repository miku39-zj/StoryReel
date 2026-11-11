"use client";

import { useEffect, useState } from "react";
import type { PlayerChoice } from "@/lib/story/types";
import { GitBranch, ArrowRight } from "lucide-react";
import { CardAction, Badge } from "@/components/ui";

export function ChoiceOverlay({
  choices,
  onChoose,
  question,
  timeoutSecs,
}: {
  choices: PlayerChoice[];
  onChoose: (edgeId: string) => void;
  question?: string;
  timeoutSecs?: number;
}) {
  const [remaining, setRemaining] = useState(timeoutSecs);
  useEffect(() => {
    if (!timeoutSecs || !choices.length) return;
    const start = Date.now();
    const timer = window.setInterval(
      () => setRemaining(Math.max(0, Math.ceil(timeoutSecs - (Date.now() - start) / 1000))),
      250,
    );
    const timeout = window.setTimeout(() => onChoose(choices[0].edgeId), timeoutSecs * 1000);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(timeout);
    };
  }, [timeoutSecs, choices, onChoose]);
  return (
    <div className="absolute inset-0 flex items-center justify-center overflow-y-auto bg-[#101012]/95 px-5 py-6">
      <div className="my-auto w-full max-w-lg space-y-3" role="group" aria-label="选择剧情走向">
        <p className="mb-4 flex items-center justify-center gap-2 text-sm font-semibold text-white/90">
          <GitBranch size={16} className="text-brand-accent" />
          {question || "故事接下来会怎样？"}
        </p>
        {remaining !== undefined && (
          <p role="status" className="text-center text-xs text-white/60">
            {remaining} 秒后自动选择第一项
          </p>
        )}
        {choices.map((choice, i) => (
          <CardAction
            key={choice.edgeId}
            onClick={() => onChoose(choice.edgeId)}
            className="flex items-center gap-3 border border-white/10 bg-oii-surface p-4 hover:border-brand-accent/40"
          >
            <Badge className="rounded-lg border-brand-accent/20 bg-brand-accent/10 text-brand-accent">
              {String.fromCharCode(65 + i)}
            </Badge>
            <span className="min-w-0 flex-1 text-sm leading-relaxed text-white/90">
              {choice.label}
            </span>
            <ArrowRight size={16} className="shrink-0 text-white/40" />
          </CardAction>
        ))}
      </div>
    </div>
  );
}
