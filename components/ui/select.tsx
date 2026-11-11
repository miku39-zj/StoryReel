/**
 * Select — 基于 Radix UI 的下拉选择组件（替代原生 <select>）
 *
 * 用法：
 *   <Select value={v} onChange={setV} options={[{ value: "a", label: "A" }]} />
 *   <Select value={v} onChange={setV} options={["A", "B"]} icon={<Film size={15} />} />
 */
"use client";

import * as RSelect from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";

type SelectItem = string | { value: string; label: React.ReactNode };
export type SelectOption = SelectItem | { label: React.ReactNode; options: SelectItem[] };

// Radix 不允许空字符串作为 item value，内部做一次映射
const EMPTY = "__empty__";
const toInner = (v: string) => (v === "" ? EMPTY : v);
const toOuter = (v: string) => (v === EMPTY ? "" : v);

interface SelectProps {
  id?: string;
  ariaLabel?: string;
  contentClassName?: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  icon?: React.ReactNode;
  size?: "sm" | "md";
  disabled?: boolean;
  className?: string;
}

export function Select({
  id,
  ariaLabel,
  contentClassName = "",
  value,
  onChange,
  options,
  placeholder,
  icon,
  size = "md",
  disabled,
  className = "",
}: SelectProps) {
  const sm = size === "sm";
  const renderItem = (option: SelectItem) => {
    const item = typeof option === "string" ? { value: option, label: option } : option;
    return (
      <RSelect.Item
        key={item.value}
        value={toInner(item.value)}
        className={`relative flex items-center gap-2 rounded-lg pl-3 pr-8 cursor-pointer select-none outline-none
          text-white/70 data-[highlighted]:bg-white/[0.06] data-[highlighted]:text-white
          data-[state=checked]:text-brand-accent data-[state=checked]:bg-brand-accent/10
          ${sm ? "py-1.5 text-[13px]" : "py-2 text-[14px]"}`}
      >
        <RSelect.ItemText>{item.label}</RSelect.ItemText>
        <RSelect.ItemIndicator className="absolute right-2.5">
          <Check size={14} />
        </RSelect.ItemIndicator>
      </RSelect.Item>
    );
  };

  return (
    <RSelect.Root
      value={toInner(value)}
      onValueChange={(v) => onChange(toOuter(v))}
      disabled={disabled}
    >
      <RSelect.Trigger
        id={id}
        aria-label={ariaLabel}
        className={`group w-full flex items-center gap-2.5 rounded-lg text-white outline-none transition-colors
          bg-white/[0.03] border border-white/[0.08] hover:border-white/[0.16]
          focus-visible:border-brand-accent/60 data-[state=open]:border-brand-accent/60
          data-[state=open]:shadow-[0_0_0_3px_rgba(255,113,91,0.08)]
          disabled:opacity-40 disabled:cursor-not-allowed
          ${sm ? "h-7 px-2.5 text-[12px]" : "h-8 px-3 text-[13px]"} ${className}`}
      >
        {icon && <span className="shrink-0 text-white/50">{icon}</span>}
        <span className="flex-1 min-w-0 text-left truncate">
          <RSelect.Value
            placeholder={<span className="text-white/30">{placeholder ?? "请选择"}</span>}
          />
        </span>
        <RSelect.Icon asChild>
          <ChevronDown
            size={sm ? 13 : 15}
            className="shrink-0 text-white/40 transition-transform duration-200 group-data-[state=open]:rotate-180"
          />
        </RSelect.Icon>
      </RSelect.Trigger>

      <RSelect.Portal>
        <RSelect.Content
          position="popper"
          sideOffset={6}
          className={`z-[200] min-w-[var(--radix-select-trigger-width)] max-h-[var(--radix-select-content-available-height)]
            overflow-hidden rounded-lg border border-white/[0.08] bg-[#222224]/95 backdrop-blur-xl
            shadow-[0_12px_40px_rgba(0,0,0,0.6)]
            data-[state=open]:animate-[sr-pop_120ms_ease-out] ${contentClassName}`}
        >
          <RSelect.Viewport className="p-1.5">
            {options.map((option, index) =>
              typeof option !== "string" && "options" in option ? (
                <RSelect.Group key={index}>
                  <RSelect.Label className="px-3 pb-1 pt-2 text-[11px] font-medium text-white/35">
                    {option.label}
                  </RSelect.Label>
                  {option.options.map(renderItem)}
                </RSelect.Group>
              ) : (
                renderItem(option)
              ),
            )}
          </RSelect.Viewport>
        </RSelect.Content>
      </RSelect.Portal>
    </RSelect.Root>
  );
}
