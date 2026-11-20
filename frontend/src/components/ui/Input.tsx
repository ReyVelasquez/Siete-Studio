import React from "react";

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  helperText?: string;
  error?: string;
  leftIcon?: React.ReactNode;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ label, helperText, error, leftIcon, id, className = "", ...props }, ref) => {
    const inputId = id || props.name;
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
        <div className="relative">
          {leftIcon && (
            <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-muted">
              {leftIcon}
            </span>
          )}
          <input
            ref={ref}
            id={inputId}
            className={`w-full rounded-md border bg-surface-card py-2.5 text-sm text-ink-primary placeholder:text-ink-muted transition-colors focus:border-line-diecut focus:outline-none disabled:cursor-not-allowed disabled:opacity-60 ${
              leftIcon ? "pl-10 pr-3.5" : "px-3.5"
            } ${
              error
                ? "border-brand-800 ring-1 ring-brand-700/40 dark:border-brand-300"
                : "border-line-subtle hover:border-line-strong"
            } ${className}`}
            {...props}
          />
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

Input.displayName = "Input";
