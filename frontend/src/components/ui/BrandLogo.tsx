import React from "react";
import { THEME_CONFIG } from "@/config/theme.config";

export interface BrandLogoProps {
  showTagline?: boolean;
  compact?: boolean;
  className?: string;
}

export const BrandLogo: React.FC<BrandLogoProps> = ({
  showTagline = false,
  compact = false,
  className = "",
}) => {
  return (
    <div className={`group inline-flex select-none items-center gap-2.5 ${className}`}>
      <div className="sticker-badge relative flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-accent text-accent-ink transition-transform duration-fast ease-studio group-hover:-rotate-3 group-hover:shadow-sticker-hover">
        <svg viewBox="0 0 64 64" fill="none" className="h-6 w-6" aria-hidden="true">
          <path
            d="M14 8H50C53.3137 8 56 10.6863 56 14V38L38 56H14C10.6863 56 8 53.3137 8 50V14C8 10.6863 10.6863 8 14 8Z"
            fill="currentColor"
            fillOpacity="0.16"
            stroke="currentColor"
            strokeWidth="3.5"
            strokeLinejoin="round"
          />
          <path d="M38 56V42C38 39.7909 39.7909 38 42 38H56L38 56Z" fill="currentColor" />
          <path
            d="M21 23H37L27 39"
            stroke="currentColor"
            strokeWidth="4.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      {!compact && (
        <div className="flex flex-col leading-none">
          <span className="inline-flex items-center gap-1.5 font-display text-base font-extrabold tracking-tight text-ink-primary">
            <span>{THEME_CONFIG.brand.name}</span>
            <span className="rounded-xs border border-dashed border-line-diecut/60 bg-accent-soft px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-wider text-accent">
              STUDIO
            </span>
          </span>
          {showTagline && (
            <span className="mt-1 text-[11px] font-medium text-ink-muted">
              {THEME_CONFIG.brand.tagline}
            </span>
          )}
        </div>
      )}
    </div>
  );
};
