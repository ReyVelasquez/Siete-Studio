import React from "react";
import { ChevronDown } from "lucide-react";

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  helperText?: string;
  error?: string;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, helperText, error, id, className = "", children, ...props }, ref) => {
    const selectId = id || props.name;
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
        <div className="relative">
          <select
            ref={ref}
            id={selectId}
            className={`w-full appearance-none rounded-md border bg-surface-card py-2.5 pl-3.5 pr-9 text-sm text-ink-primary transition-colors focus:border-line-diecut focus:outline-none disabled:cursor-not-allowed disabled:opacity-60 ${
              error
                ? "border-brand-800 ring-1 ring-brand-700/40 dark:border-brand-300"
                : "border-line-subtle hover:border-line-strong"
            } ${className}`}
            {...props}
          >
            {children}
          </select>
          <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
        </div>
        {error ? (
          <p role="alert" className="text-xs font-semibold text-brand-800 dark:text-brand-200">
            • {error}
          </p>
        ) : (
          helperText && <p className="text-xs text-ink-muted">{helperText}</p>
        )}
      </div>
    );
  }
);

Select.displayName = "Select";
