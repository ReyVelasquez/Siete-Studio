import React, { useId } from "react";
import { AlertCircle, ChevronDown } from "lucide-react";

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  helperText?: string;
  error?: string;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, helperText, error, id, className = "", children, ...props }, ref) => {
    const reactId = useId();
    const selectId = id || props.name || reactId;
    const feedbackId = `${selectId}-feedback`;

    return (
      <div className="w-full space-y-1.5">
        {label && (
          <label
            htmlFor={selectId}
            className="block text-xs font-semibold uppercase tracking-wider text-ink-secondary"
          >
            {label}
          </label>
        )}
        <div className="group relative">
          <select
            ref={ref}
            id={selectId}
            aria-invalid={Boolean(error)}
            aria-describedby={error || helperText ? feedbackId : undefined}
            className={`h-11 w-full appearance-none rounded-md border bg-surface-card pl-3.5 pr-10 text-sm text-ink-primary shadow-xs transition-all duration-fast ease-studio focus:outline-none disabled:cursor-not-allowed disabled:bg-surface-elevated/60 disabled:opacity-60 ${
              error
                ? "border-state-critical-bg ring-1 ring-state-critical-bg/35 focus:border-state-critical-bg focus:ring-2 focus:ring-state-critical-bg/30"
                : "border-line-subtle hover:border-line-strong focus:border-line-diecut focus:ring-2 focus:ring-ring/25"
            } ${className}`}
            {...props}
          >
            {children}
          </select>
          <ChevronDown
            aria-hidden="true"
            className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted transition-colors duration-fast ease-studio group-hover:text-ink-primary group-focus-within:text-accent"
          />
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

Select.displayName = "Select";
