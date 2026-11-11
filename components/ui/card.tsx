"use client";

import { forwardRef, type HTMLAttributes } from "react";
import { Button, type ButtonProps } from "./button";
import { cn } from "@/lib/utils";

export const Card = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("rounded-xl border border-white/[0.08] bg-oii-surface", className)}
      {...props}
    />
  ),
);
Card.displayName = "Card";

/** Content-sized action surface. Unlike a toolbar button, cards wrap and grow. */
export const CardAction = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, ...props }, ref) => (
    <Button
      ref={ref}
      variant="ghost"
      size="content"
      className={cn(
        "w-full min-w-0 justify-start whitespace-normal rounded-xl text-left hover:bg-white/[0.04] active:scale-[0.99]",
        className,
      )}
      {...props}
    />
  ),
);
CardAction.displayName = "CardAction";
