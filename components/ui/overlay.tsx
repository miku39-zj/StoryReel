/**
 * Switch / Tooltip / ConfirmDialog — 基于 Radix UI 的交互组件
 */
"use client";

import * as RSwitch from "@radix-ui/react-switch";
import * as RTooltip from "@radix-ui/react-tooltip";
import * as RAlert from "@radix-ui/react-alert-dialog";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./button";

// ── Switch ─────────────────────────────────────────────────────

interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label?: React.ReactNode;
  disabled?: boolean;
  className?: string;
}

export function Switch({ checked, onCheckedChange, label, disabled, className }: SwitchProps) {
  const control = (
    <RSwitch.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      className="relative h-5 w-9 shrink-0 rounded-full outline-none transition-colors duration-200
        bg-white/[0.12] data-[state=checked]:bg-brand-accent
        focus-visible:ring-2 focus-visible:ring-brand-accent/50 disabled:opacity-40"
    >
      <RSwitch.Thumb
        className="block h-4 w-4 rounded-full bg-white shadow transition-transform duration-200
          translate-x-0.5 data-[state=checked]:translate-x-[18px]"
      />
    </RSwitch.Root>
  );
  if (!label) return control;
  return (
    <label className={cn("flex items-center gap-2.5 cursor-pointer select-none", className)}>
      {control}
      <span className="text-[12px] text-white/55">{label}</span>
    </label>
  );
}

// ── Tooltip ────────────────────────────────────────────────────

export function TooltipProvider({ children }: { children: React.ReactNode }) {
  return (
    <RTooltip.Provider delayDuration={250} skipDelayDuration={100}>
      {children}
    </RTooltip.Provider>
  );
}

interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactNode;
  side?: "top" | "bottom" | "left" | "right";
}

export function Tooltip({ content, children, side = "top" }: TooltipProps) {
  return (
    <RTooltip.Root>
      <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
      <RTooltip.Portal>
        <RTooltip.Content
          side={side}
          sideOffset={6}
          className="z-[300] rounded-lg bg-[#2e2e30] border border-white/[0.08] px-2.5 py-1.5 text-[12px] text-white/85
            shadow-[0_8px_24px_rgba(0,0,0,0.5)] data-[state=delayed-open]:animate-[sr-pop_120ms_ease-out]"
        >
          {content}
          <RTooltip.Arrow className="fill-[#2e2e30]" />
        </RTooltip.Content>
      </RTooltip.Portal>
    </RTooltip.Root>
  );
}

// ── ConfirmDialog ──────────────────────────────────────────────

interface ConfirmDialogProps {
  /** 触发元素（按钮），点击后弹出确认框 */
  children: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  onConfirm: () => void;
}

export function ConfirmDialog({
  children,
  title,
  description,
  confirmText = "确认",
  cancelText = "取消",
  danger = true,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <RAlert.Root>
      <RAlert.Trigger asChild>{children}</RAlert.Trigger>
      <RAlert.Portal>
        <RAlert.Overlay className="fixed inset-0 z-[400] bg-black/70 backdrop-blur-sm data-[state=open]:animate-[sr-fade_150ms_ease-out]" />
        <RAlert.Content
          className="fixed left-1/2 top-1/2 z-[401] w-[400px] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2
            rounded-2xl border border-white/[0.08] bg-[#222224] p-6 shadow-[0_20px_60px_rgba(0,0,0,0.7)]
            data-[state=open]:animate-[sr-pop_150ms_ease-out] outline-none"
        >
          <div className="flex items-start gap-3.5">
            <div
              className={cn(
                "w-10 h-10 shrink-0 rounded-xl flex items-center justify-center",
                danger ? "bg-red-500/12 text-red-400" : "bg-brand-accent/12 text-brand-accent",
              )}
            >
              <AlertTriangle size={18} />
            </div>
            <div className="flex-1 min-w-0">
              <RAlert.Title className="text-[16px] font-semibold text-white">{title}</RAlert.Title>
              {description && (
                <RAlert.Description className="text-[13px] mt-1.5 leading-relaxed text-white/50">
                  {description}
                </RAlert.Description>
              )}
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-6">
            <RAlert.Cancel asChild>
              <Button variant="secondary">{cancelText}</Button>
            </RAlert.Cancel>
            <RAlert.Action asChild>
              <Button
                variant={danger ? "secondary" : "primary"}
                className={
                  danger ? "bg-red-500 text-white hover:bg-red-400 hover:text-white" : undefined
                }
                onClick={onConfirm}
              >
                {confirmText}
              </Button>
            </RAlert.Action>
          </div>
        </RAlert.Content>
      </RAlert.Portal>
    </RAlert.Root>
  );
}
