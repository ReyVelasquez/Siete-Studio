import React from "react";
import { Loader2 } from "lucide-react";

type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "inverted";
type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  fullWidth?: boolean;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-accent-ink hover:bg-accent-hover shadow-sm border border-transparent",
  secondary:
    "bg-surface-elevated text-ink-primary hover:bg-surface-subtle border border-line-subtle",
  outline:
    "bg-surface-card text-ink-primary hover:bg-surface-elevated border border-line-strong",
  ghost:
    "bg-transparent text-ink-secondary hover:bg-surface-elevated hover:text-ink-primary border border-transparent",
  inverted:
    "bg-surface-inverted text-ink-inverted hover:opacity-90 border border-transparent",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "h-9 px-3 text-xs rounded-md gap-1.5",
  md: "h-11 px-4 text-sm rounded-md gap-2",
  lg: "h-12 px-6 text-sm rounded-lg gap-2.5",
};

export const Button: React.FC<ButtonProps> = ({
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
}) => {
  return (
    <button
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center font-semibold tracking-tight transition-all duration-150 active:scale-[0.985] disabled:cursor-not-allowed disabled:opacity-55 ${variantClasses[variant]} ${sizeClasses[size]} ${
        fullWidth ? "w-full" : ""
      } ${className}`}
      {...rest}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : leftIcon}
      <span>{children}</span>
      {!loading && rightIcon}
    </button>
  );
};
