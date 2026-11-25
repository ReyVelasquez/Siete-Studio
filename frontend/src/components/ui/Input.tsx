import React, { useId } from "react";
import { AlertCircle } from "lucide-react";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  helperText?: string;
  error?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ label, helperText, error, leftIcon, rightIcon, id, className = "", ...props }, ref) => {
    const reactId = useId();
    const inputId = id || props.name || reactId;
    const feedbackId = `${inputId}-feedback`;

    return (
      <div className="w-full space-y-1.5">
        {label && (
          <label
            htmlFor={inputId}
            className="block text-xs font-semibold uppercase tracking-wider text-ink-secondary"
          >
            {label}
          </label>
        )}
        <div className="group relative">
          {leftIcon && (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-muted transition-colors duration-fast ease-studio group-focus-within:text-accent"
            >
              {leftIcon}
            </span>
          )}
          <input
            ref={ref}
            id={inputId}
            aria-invalid={Boolean(error)}
            aria-describedby={error || helperText ? feedbackId : undefined}
            className={`h-11 w-full rounded-md border bg-surface-card text-sm text-ink-primary shadow-xs placeholder:text-ink-muted transition-all duration-fast ease-studio focus:outline-none disabled:cursor-not-allowed disabled:bg-surface-elevated/60 disabled:opacity-60 ${
              leftIcon ? "pl-10" : "pl-3.5"
            } ${rightIcon ? "pr-10" : "pr-3.5"} ${
              error
                ? "border-state-critical-bg ring-1 ring-state-critical-bg/35 focus:border-state-critical-bg focus:ring-2 focus:ring-state-critical-bg/30"
                : "border-line-subtle hover:border-line-strong focus:border-line-diecut focus:ring-2 focus:ring-ring/25"
            } ${className}`}
            {...props}
          />
          {rightIcon && (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-ink-muted transition-colors duration-fast ease-studio group-focus-within:text-accent"
            >
              {rightIcon}
            </span>
          )}
        </div>
        {error ? (
          <p
            id={feedbackId}
            role="alert"
            className="flex items-center gap-1.5 text-xs font-semibold text-ink-primary"
          >
            <span
              aria-hidden="true"
              className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-state-critical-bg text-state-critical-ink"
            >
              <AlertCircle className="h-3 w-3" />
            </span>
            <span>{error}</span>
          </p>
        ) : (
          helperText && (
            <p id={feedbackId} className="text-xs text-ink-muted">
              {helperText}
            </p>
          )
        )}
      </div>
    );
  }
);

Input.displayName = "Input";
