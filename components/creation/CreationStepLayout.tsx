"use client";

import type { ReactNode } from "react";
import { AlertCircle, CheckCircle, Clock, Loader2 } from "lucide-react";
import { Alert, Badge, Button, Card, EmptyState } from "@/components/ui";
import { useCreationStore } from "@/stores/creation-store";

export function CreationStepLayout({
  title,
  action,
  children,
  embedded = false,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  embedded?: boolean;
}) {
  return (
    <div className={embedded ? "min-w-0" : "h-full min-w-0 overflow-y-auto"}>
      <div
        className={
          embedded
            ? "space-y-3 px-3 py-3 pb-4 lg:px-4"
            : "mx-auto max-w-[1200px] space-y-5 px-5 py-7 pb-12 lg:px-8"
        }
      >
        <header className="flex flex-wrap items-center justify-between gap-3 pb-1">
          <h1 className="text-xl font-semibold tracking-tight text-white">{title}</h1>
          {action && <div className="flex flex-wrap gap-2">{action}</div>}
        </header>
        {children}
      </div>
    </div>
  );
}

export function StorySummary({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.08] pb-4">
      <h2 className="min-w-0 break-words text-sm font-medium text-white/80">{title}</h2>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

export function StoryPrerequisite({ icon }: { icon: ReactNode }) {
  const setActiveStep = useCreationStore((s) => s.setActiveStep);
  return (
    <Card>
      <EmptyState icon={icon} title="请先生成并应用故事大纲">
        <Button variant="primary" onClick={() => setActiveStep("story")}>
          前往故事与剧本
        </Button>
      </EmptyState>
    </Card>
  );
}

export function GenerationFeedback({
  running,
  error,
  text,
}: {
  running: boolean;
  error: boolean | string;
  text?: string;
}) {
  if (error)
    return (
      <Alert tone="error">
        <span className="flex items-center gap-2">
          <AlertCircle size={16} className="shrink-0" />
          {typeof error === "string" ? error : "生成失败，请检查服务配置后重试。"}
        </span>
      </Alert>
    );
  if (!running) return null;
  return (
    <Alert>
      <span className="flex items-center gap-2">
        <Loader2 size={16} className="shrink-0 animate-spin text-brand-accent" />
        正在生成…
      </span>
      {text && (
        <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs leading-relaxed text-white/50">
          {text}
        </pre>
      )}
    </Alert>
  );
}

export function AssetStatusBadge({ status }: { status?: string }) {
  const state =
    status === "done"
      ? {
          label: "已完成",
          icon: CheckCircle,
          color: "border-emerald-400/20 bg-emerald-400/10 text-emerald-300",
        }
      : status === "failed"
        ? {
            label: "生成失败",
            icon: AlertCircle,
            color: "border-red-400/20 bg-red-400/10 text-red-300",
          }
        : status === "generating"
          ? {
              label: "生成中",
              icon: Loader2,
              color: "border-brand-accent/20 bg-brand-accent/10 text-brand-accent",
            }
          : { label: "待生成", icon: Clock, color: "" };
  const Icon = state.icon;
  return (
    <Badge className={`gap-1.5 ${state.color}`}>
      <Icon size={12} className={status === "generating" ? "animate-spin" : undefined} />
      {state.label}
    </Badge>
  );
}
