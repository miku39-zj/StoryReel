/**
 * Button — 全局按钮组件
 *
 * variant: primary（冰川蓝）| secondary（浅灰底）| ghost（透明）| outline（品牌色描边）| danger
 * size:    sm | md | lg | icon | icon-sm
 */
"use client";

import { forwardRef } from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap font-medium transition-all duration-150 outline-none select-none " +
    "focus-visible:ring-2 focus-visible:ring-brand-accent/50 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40",
  {
    variants: {
      variant: {
        primary: "text-brand-ink bg-brand-accent shadow-sm hover:bg-brand-accent-hover",
        secondary: "text-white/70 bg-white/[0.06] hover:bg-white/[0.1] hover:text-white",
        ghost: "text-white/60 hover:text-white hover:bg-white/[0.06]",
        outline:
          "text-brand-accent bg-brand-accent/10 border border-brand-accent/30 hover:bg-brand-accent/15 hover:border-brand-accent/50",
        danger: "text-white/45 hover:text-red-400 hover:bg-red-500/10",
        success: "text-white bg-green-600 hover:bg-green-500",
      },
      size: {
        content: "h-auto p-0 text-[13px]",
        sm: "h-7 px-2.5 text-[12px] rounded-lg",
        md: "h-8 px-3 text-[13px] rounded-lg",
        lg: "h-10 px-4 text-[14px] rounded-lg",
        icon: "h-8 w-8 rounded-lg",
        "icon-sm": "h-7 w-7 rounded-lg",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild, type = "button", ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        type={type}
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { buttonVariants };
