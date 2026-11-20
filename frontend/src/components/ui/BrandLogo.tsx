import React from "react";
import { THEME_CONFIG } from "@/config/theme.config";

interface BrandLogoProps {
  showTagline?: boolean;
  compact?: boolean;
}

export const BrandLogo: React.FC<BrandLogoProps> = ({
  showTagline = false,
  compact = false,
}) => {
  return (
    <div className="inline-flex items-center gap-2.5 select-none">
      <div className="relative flex h-9 w-9 items-center justify-center rounded-md bg-brand-700 text-white shadow-sticker dark:bg-brand-500 dark:text-brand-950">
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
          <span className="font-display text-base font-extrabold tracking-tight text-ink-primary">
            {THEME_CONFIG.brand.name}
            <span className="ml-1 font-mono text-xs font-medium text-brand-600 dark:text-brand-300">
              STUDIO
            </span>
          </span>
          {showTagline && (
            <span className="mt-0.5 text-[11px] font-medium text-ink-muted">
              {THEME_CONFIG.brand.tagline}
            </span>
          )}
        </div>
      )}
    </div>
  );
};
