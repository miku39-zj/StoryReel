import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

export function EmptyState({
  icon,
  title,
  description,
  children,
  className,
}: {
  icon: ReactNode;
  title: string;
  description?: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-h-[216px] flex-col items-center justify-center px-4 py-8 text-center",
        className,
      )}
    >
      <div
        className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-brand-accent/10 text-brand-accent"
        aria-hidden="true"
      >
        {icon}
      </div>
      <h2 className="text-sm font-semibold text-white/90">{title}</h2>
      {description && (
        <p className="mt-2 max-w-md text-[13px] leading-relaxed text-white/50">{description}</p>
      )}
      {children && <div className="mt-4 flex flex-wrap justify-center gap-2">{children}</div>}
    </div>
  );
}

export function Alert({
  className,
  tone = "info",
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  tone?: "info" | "error" | "warning" | "success";
}) {
  const colors = {
    info: "border-white/10 bg-white/[0.03] text-white/65",
    error: "border-red-400/20 bg-red-400/[0.06] text-red-300",
    warning: "border-amber-400/20 bg-amber-400/[0.06] text-amber-200",
    success: "border-emerald-400/20 bg-emerald-400/[0.06] text-emerald-300",
  };
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "rounded-xl border p-4 text-sm leading-relaxed break-words",
        colors[tone],
        className,
      )}
      {...props}
    />
  );
}

export function Progress({
  value,
  max = 100,
  label,
  className,
}: {
  value: number;
  max?: number;
  label: string;
  className?: string;
}) {
  const percent = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      className={cn("h-1.5 overflow-hidden rounded-full bg-white/[0.08]", className)}
    >
      <div
        className="h-full w-full origin-left rounded-full bg-brand-accent transition-transform duration-300"
        style={{ transform: `scaleX(${percent / 100})` }}
      />
    </div>
  );
}
