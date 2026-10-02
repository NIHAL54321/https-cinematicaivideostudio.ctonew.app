import * as React from "react";
import { cn } from "@/lib/cn";

/* ------------------------------------------------------------------ */
/* Button                                                              */
/* ------------------------------------------------------------------ */

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "outline" | "danger";
  size?: "sm" | "md" | "lg";
};

export function Button({ className, variant = "primary", size = "md", ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-50 disabled:pointer-events-none cursor-pointer select-none",
        size === "sm" && "h-8 px-3 text-xs",
        size === "md" && "h-10 px-4 text-sm",
        size === "lg" && "h-12 px-6 text-base",
        variant === "primary" &&
          "bg-accent text-[#171208] hover:bg-accent-strong shadow-[0_8px_24px_rgba(232,180,90,0.25)]",
        variant === "outline" && "border border-line bg-transparent text-ink hover:bg-panel-2 hover:border-line",
        variant === "ghost" && "text-ink-dim hover:text-ink hover:bg-panel-2",
        variant === "danger" && "bg-danger/15 text-danger hover:bg-danger/25 border border-danger/20",
        className,
      )}
      {...props}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Input / Label                                                       */
/* ------------------------------------------------------------------ */

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-10 w-full rounded-xl border border-line bg-panel-3/60 px-3.5 text-sm text-ink placeholder:text-ink-faint",
        "focus:outline-none focus:border-accent-line focus:ring-2 focus:ring-accent/20",
        "transition-colors duration-150",
        className,
      )}
      {...props}
    />
  );
}

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn("block text-xs font-medium uppercase tracking-wider text-ink-dim mb-1.5", className)}
      {...props}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Card                                                                */
/* ------------------------------------------------------------------ */

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("glass", className)} {...props} />;
}

/* ------------------------------------------------------------------ */
/* Badge                                                               */
/* ------------------------------------------------------------------ */

export function Badge({
  className,
  tone = "neutral",
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: "neutral" | "accent" | "ok" | "danger" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wider border",
        tone === "neutral" && "border-line bg-panel-2 text-ink-dim",
        tone === "accent" && "border-accent-line bg-accent-soft text-accent",
        tone === "ok" && "border-ok/25 bg-ok/10 text-ok",
        tone === "danger" && "border-danger/25 bg-danger/10 text-danger",
        className,
      )}
      {...props}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Page header                                                         */
/* ------------------------------------------------------------------ */

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 mb-8">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        {description ? <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-ink-dim">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
