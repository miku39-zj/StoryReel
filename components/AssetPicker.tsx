"use client";

import * as Dialog from "@radix-ui/react-alert-dialog";
import { useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { AssetLibrary } from "@/components/AssetLibrary";
import { Button } from "@/components/ui";
import type { LibraryAsset } from "@/lib/assets";

/** Shared asset selection surface; uploading and listing remain in AssetLibrary. */
export function AssetPicker({
  title,
  types,
  onSelect,
  children,
}: {
  title: string;
  types?: LibraryAsset["type"][];
  onSelect: (asset: LibraryAsset) => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>{children}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[400] bg-black/70 backdrop-blur-sm" />
        <Dialog.Content
          role="dialog"
          aria-describedby={undefined}
          className="fixed left-1/2 top-1/2 z-[401] flex max-h-[85vh] w-[760px] max-w-[calc(100vw-24px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-white/10 bg-oii-surface shadow-2xl outline-none"
        >
          <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
            <Dialog.Title className="text-sm font-semibold">{title}</Dialog.Title>
            <Dialog.Cancel asChild>
              <Button size="sm" variant="ghost" aria-label="关闭素材选择">
                <X size={16} />
              </Button>
            </Dialog.Cancel>
          </div>
          <div className="min-h-0 overflow-y-auto p-4">
            <AssetLibrary
              types={types}
              onSelect={(asset) => {
                onSelect(asset);
                setOpen(false);
              }}
            />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
