import React from "react";
import { Loader2 } from "lucide-react";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "outline"
  | "ghost"
  | "inverted"
  | "dieCut";

export type ButtonSize = "sm" | "md" | "lg" | "icon";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  fullWidth?: boolean;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    "border border-transparent bg-accent text-accent-ink shadow-xs hover:-translate-y-px hover:bg-accent-hover hover:shadow-card",
  secondary:
    "border border-line-subtle bg-surface-elevated text-ink-primary shadow-xs hover:-translate-y-px hover:border-line-strong hover:bg-surface-subtle",
  outline:
    "border border-line-strong bg-surface-card text-ink-primary shadow-xs hover:-translate-y-px hover:border-line-diecut hover:bg-surface-elevated",
  ghost:
    "border border-transparent bg-transparent text-ink-secondary hover:bg-surface-elevated hover:text-ink-primary",
  inverted:
    "border border-transparent bg-surface-inverted text-ink-inverted shadow-xs hover:-translate-y-px hover:bg-surface-inverted/90 hover:shadow-card",
  dieCut:
    "border border-dashed border-line-diecut/80 bg-surface-card text-ink-primary shadow-xs hover:-translate-y-px hover:border-line-diecut hover:bg-accent-soft/60 hover:shadow-sticker",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "h-9 rounded-md px-3 text-xs gap-1.5",
  md: "h-11 rounded-md px-4 text-sm gap-2",
  lg: "h-12 rounded-lg px-6 text-sm gap-2.5",
  icon: "h-10 w-10 rounded-md p-0",
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = "primary",
      size = "md",
      loading = false,
      leftIcon,
      rightIcon,
      fullWidth = false,
      disabled,
      className = "",
      children,
      ...rest
    },
    ref
  ) => {
    const hasChildren = children !== undefined && children !== null && children !== "";

    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        className={`inline-flex select-none items-center justify-center font-semibold tracking-tight transition-all duration-fast ease-studio focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface-canvas active:scale-[0.985] disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${
          fullWidth ? "w-full" : ""
        } ${className}`}
        {...rest}
      >
        {loading ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" /> : leftIcon}
        {hasChildren && <span>{children}</span>}
        {!loading && rightIcon}
      </button>
    );
  }
);

Button.displayName = "Button";
