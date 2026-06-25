// ───────────────────────────────────────────────────────────────────────────
// UI primitives — a small, dependency-light shadcn/ui-style component kit.
// Hand-written (no Radix) to keep the bundle lean while preserving the look,
// tokens, and ergonomics of shadcn/ui (cva variants, `cn` merging, CSS vars).
// ───────────────────────────────────────────────────────────────────────────

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import type { Status } from "@/lib/audit/types";

// ── Button ─────────────────────────────────────────────────────────────────
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        outline: "border border-border bg-transparent hover:bg-accent",
        ghost: "hover:bg-accent",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-8 px-3 text-xs",
        lg: "h-12 px-6 text-base",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  ),
);
Button.displayName = "Button";

// ── Card ───────────────────────────────────────────────────────────────────
export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-xl border bg-card text-card-foreground shadow-sm", className)}
      {...props}
    />
  );
}
export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col space-y-1.5 p-5", className)} {...props} />;
}
export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("font-semibold leading-tight tracking-tight", className)} {...props} />;
}
export function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-sm text-muted-foreground", className)} {...props} />;
}
export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-5 pt-0", className)} {...props} />;
}

// ── Badge ──────────────────────────────────────────────────────────────────
const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary/10 text-primary",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        outline: "text-foreground",
        success: "border-transparent bg-success/15 text-success",
        warning: "border-transparent bg-warning/20 text-warning-foreground dark:text-warning",
        destructive: "border-transparent bg-destructive/15 text-destructive",
      },
    },
    defaultVariants: { variant: "default" },
  },
);
export function Badge({
  className,
  variant,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof badgeVariants>) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

// ── Status badge (PASS / WARNING / FAIL) ─────────────────────────────────────
const STATUS_MAP: Record<Status, { label: string; variant: "success" | "warning" | "destructive" }> = {
  pass: { label: "PASS", variant: "success" },
  warning: { label: "WARNING", variant: "warning" },
  fail: { label: "FAIL", variant: "destructive" },
};
export function StatusBadge({ status, className }: { status: Status; className?: string }) {
  const s = STATUS_MAP[status];
  return (
    <Badge variant={s.variant} className={cn("font-semibold tracking-wide", className)}>
      {s.label}
    </Badge>
  );
}

// ── Progress bar ─────────────────────────────────────────────────────────────
export function Progress({ value, className }: { value: number; className?: string }) {
  return (
    <div className={cn("h-2 w-full overflow-hidden rounded-full bg-secondary", className)}>
      <div
        className="h-full rounded-full bg-primary transition-all duration-500"
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}

// ── Input ────────────────────────────────────────────────────────────────────
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "flex h-11 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";

// ── Checkbox ─────────────────────────────────────────────────────────────────
export function Checkbox({
  checked,
  onChange,
  label,
  id,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: React.ReactNode;
  id?: string;
}) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-center gap-3 py-1.5 text-sm">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="size-4 rounded border-input accent-[hsl(var(--primary))]"
      />
      <span className={cn(checked && "text-muted-foreground line-through")}>{label}</span>
    </label>
  );
}

// ── Separator ────────────────────────────────────────────────────────────────
export function Separator({ className }: { className?: string }) {
  return <div className={cn("h-px w-full bg-border", className)} />;
}

// ── Stat ─────────────────────────────────────────────────────────────────────
export function Stat({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  accent?: "success" | "warning" | "destructive" | "primary";
}) {
  const color =
    accent === "success" ? "text-success"
    : accent === "warning" ? "text-warning dark:text-warning"
    : accent === "destructive" ? "text-destructive"
    : accent === "primary" ? "text-primary"
    : "";
  return (
    <Card>
      <CardContent className="pt-5">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className={cn("mt-1 text-3xl font-bold tracking-tight", color)}>{value}</p>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}
