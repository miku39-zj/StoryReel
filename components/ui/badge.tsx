import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Badge({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border border-white/10 bg-white/[0.06] px-2 py-0.5 text-[11px] font-medium leading-5 text-white/65",
        className,
      )}
      {...props}
    />
  );
}
