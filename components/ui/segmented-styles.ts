import { cn } from "@/lib/utils";
import { buttonVariants } from "./button";

/** Shared geometry for editor navigation and nested workspace tabs. */
export const segmentedGroupClassName =
  "inline-flex items-center gap-0.5 rounded-lg border border-white/[0.08] bg-oii-surface p-0.5";

export function segmentedItemClassName(selected: boolean, tone: "brand" | "neutral" = "neutral") {
  return cn(
    buttonVariants({ variant: "ghost", size: "sm" }),
    "min-w-14 gap-1.5 px-2.5",
    selected
      ? tone === "brand"
        ? "bg-brand-accent text-brand-ink hover:bg-brand-accent-hover hover:text-brand-ink"
        : "bg-white/10 text-white hover:bg-white/10 shadow-sm"
      : "text-white/50",
  );
}
