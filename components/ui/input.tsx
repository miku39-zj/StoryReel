/**
 * Input / Textarea / NumberInput — 全局表单输入组件
 */
"use client";

import { forwardRef } from "react";
import { Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

const fieldBase =
  "w-full rounded-lg bg-white/[0.03] border border-white/[0.08] text-white placeholder:text-white/25 outline-none " +
  "transition-[border-color,box-shadow] duration-150 hover:border-white/[0.14] " +
  "focus:border-brand-accent/55 focus:shadow-[0_0_0_3px_rgba(255,113,91,0.08)] " +
  "disabled:opacity-40 disabled:cursor-not-allowed read-only:text-white/50 read-only:focus:shadow-none";

const sizes = {
  sm: "h-8 px-3 text-[13px]",
  md: "h-10 px-3 text-[14px]",
};

// ── Input ──────────────────────────────────────────────────────

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> {
  inputSize?: keyof typeof sizes;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, inputSize = "sm", ...props }, ref) => (
    <input
      ref={ref}
      className={cn(fieldBase, sizes[inputSize], className)}
      style={{ caretColor: "#ff715b" }}
      {...props}
    />
  ),
);
Input.displayName = "Input";

// ── Textarea ───────────────────────────────────────────────────

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      fieldBase,
      "min-h-[80px] px-3 py-2 text-[13px] leading-relaxed resize-y",
      className,
    )}
    style={{ caretColor: "#ff715b" }}
    {...props}
  />
));
Textarea.displayName = "Textarea";

// ── NumberInput（自定义 +/- 按钮，替代原生 number spinner）────────

interface NumberInputProps {
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  className?: string;
}

export function NumberInput({
  value,
  onChange,
  min = 0,
  max,
  step = 1,
  placeholder,
  className,
}: NumberInputProps) {
  const clamp = (n: number) => Math.min(max ?? Infinity, Math.max(min, n));
  const stepBy = (d: number) => onChange(clamp((value ?? 0) + d));

  return (
    <div
      className={cn(
        "flex items-stretch h-9 rounded-lg overflow-hidden border border-white/[0.08] bg-white/[0.03] " +
          "hover:border-white/[0.14] focus-within:border-brand-accent/55 focus-within:shadow-[0_0_0_3px_rgba(255,113,91,0.08)] transition-[border-color,box-shadow]",
        className,
      )}
    >
      <StepButton
        onClick={() => stepBy(-step)}
        disabled={value === undefined || value <= min}
        aria-label="减少"
      >
        <Minus size={13} />
      </StepButton>
      <input
        inputMode="decimal"
        value={value ?? ""}
        placeholder={placeholder}
        onChange={(e) => {
          const raw = e.target.value.trim();
          if (raw === "") return onChange(undefined);
          const n = Number(raw);
          if (!Number.isNaN(n)) onChange(clamp(n));
        }}
        className="flex-1 min-w-0 bg-transparent text-center text-[13px] text-white placeholder:text-white/25 outline-none"
        style={{ caretColor: "#ff715b" }}
      />
      <StepButton
        onClick={() => stepBy(step)}
        disabled={max !== undefined && (value ?? 0) >= max}
        aria-label="增加"
      >
        <Plus size={13} />
      </StepButton>
    </div>
  );
}

function StepButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className="w-9 shrink-0 flex items-center justify-center text-white/40 hover:text-white hover:bg-white/[0.06] disabled:opacity-30 disabled:pointer-events-none transition-colors"
      {...props}
    />
  );
}
