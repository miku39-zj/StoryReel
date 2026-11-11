"use client";

import type { ReactNode } from "react";
import * as Menu from "@radix-ui/react-dropdown-menu";

export function DropdownMenu({
  trigger,
  label,
  items,
  side = "bottom",
  open,
  onOpenChange,
}: {
  trigger: ReactNode;
  label: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  side?: "top" | "bottom" | "left" | "right";
  items: Array<{
    key: string;
    label: string;
    icon?: ReactNode;
    disabled?: boolean;
    onSelect: () => void;
  }>;
}) {
  return (
    <Menu.Root open={open} onOpenChange={onOpenChange}>
      <Menu.Trigger asChild>{trigger}</Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          onKeyDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          side={side}
          sideOffset={8}
          collisionPadding={12}
          className="z-[250] min-w-48 max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-y-auto rounded-xl border border-white/10 bg-oii-surface p-1.5 shadow-xl"
        >
          <Menu.Label className="px-3 py-2 text-xs font-medium text-white/40">{label}</Menu.Label>
          {items.map((item) => (
            <Menu.Item
              key={item.key}
              disabled={item.disabled}
              onSelect={item.onSelect}
              className="flex cursor-pointer select-none items-center gap-2.5 rounded-lg px-3 py-2.5 text-[13px] text-white/80 outline-none data-[highlighted]:bg-white/[0.06] data-[highlighted]:text-white data-[disabled]:pointer-events-none data-[disabled]:opacity-35"
            >
              {item.icon}
              {item.label}
            </Menu.Item>
          ))}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
