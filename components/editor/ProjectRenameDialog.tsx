"use client";

import * as Dialog from "@radix-ui/react-alert-dialog";
import { useState, useRef, type ReactNode } from "react";
import { Button, Input, Label, Alert } from "@/components/ui";
import { projectNameSchema } from "@/lib/story/project-name";

export function ProjectRenameDialog({
  name,
  children,
  onRename,
}: {
  name: string;
  children: ReactNode;
  onRename: (name: string) => Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false),
    [value, setValue] = useState(name),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const submit = async () => {
    if (busy) return;
    const parsed = projectNameSchema.safeParse(value);
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }
    if (parsed.data === name && !error) {
      setOpen(false);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onRename(parsed.data);
      setOpen(false);
    } catch (e) {
      setError((e as Error).message || "重命名失败，请重试");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        setOpen(next);
        if (next) {
          setValue(name);
          setError("");
        }
      }}
    >
      <Dialog.Trigger asChild>{children}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[400] bg-black/70" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-[401] w-[400px] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 space-y-4 rounded-2xl border border-white/10 bg-[#222224] p-6 shadow-xl"
          aria-describedby={undefined}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            inputRef.current?.focus();
            inputRef.current?.select();
          }}
        >
          <Dialog.Title className="text-base font-semibold text-white">重命名项目</Dialog.Title>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label htmlFor="rename-project-name">项目名称</Label>
              <Input
                id="rename-project-name"
                ref={inputRef}
                value={value}
                maxLength={500}
                disabled={busy}
                onChange={(event) => {
                  setValue(event.target.value);
                  setError("");
                }}
                onKeyDown={(event) => {
                  if (event.key === "Escape" && !busy) {
                    event.preventDefault();
                    setOpen(false);
                  }
                }}
              />
            </div>
            {error && <Alert tone="error">{error}</Alert>}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => setOpen(false)}
              >
                取消
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? "保存中…" : "保存名称"}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
