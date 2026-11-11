"use client";

import { useState } from "react";
import { Users } from "lucide-react";
import { Button } from "@/components/ui";
import { CharacterPicker } from "./CharacterLibrary";
import type { CharacterAsset } from "@/lib/characters";

export function StoryCastPicker({
  value,
  onChange,
  disabled,
}: {
  value: CharacterAsset[];
  onChange: (value: CharacterAsset[]) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        aria-haspopup="dialog"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <Users size={17} /> 选用角色
        {value.length > 0 && (
          <span className="rounded-full bg-brand-accent/15 px-1.5 text-xs text-brand-accent">
            {value.length}
          </span>
        )}
      </Button>
      <CharacterPicker
        open={open}
        onClose={() => setOpen(false)}
        selected={value}
        onSelect={(character) => {
          if (value.some((item) => item.id === character.id)) {
            onChange(value.filter((item) => item.id !== character.id));
          } else if (value.length < 20) {
            onChange([...value, character]);
          }
        }}
      />
    </>
  );
}
