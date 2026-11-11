"use client";

import type { ReactNode } from "react";
import { CardAction } from "@/components/ui";

interface FeatureCardProps {
  label: string;
  desc: string;
  icon: ReactNode;
  iconColor: string;
  needsConfiguration: boolean;
  onClick: () => void;
}

export function FeatureCard({
  label,
  desc,
  icon,
  iconColor,
  needsConfiguration,
  onClick,
}: FeatureCardProps) {
  return (
    <CardAction
      onClick={onClick}
      className="studio-tool group h-full items-center gap-3 rounded-xl border border-white/[0.08] bg-oii-surface/50 p-4"
    >
      <div className="shrink-0">
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
          style={{ color: iconColor, backgroundColor: `${iconColor}14` }}
        >
          {icon}
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="mb-1 text-sm font-semibold text-white/95">{label}</h3>
        <p className="text-xs font-normal leading-relaxed text-white/50">{desc}</p>
      </div>
      {needsConfiguration && (
        <span className="shrink-0 rounded-md bg-white/[0.04] px-2 py-1 text-[10px] text-white/45">
          待配置
        </span>
      )}
    </CardAction>
  );
}
