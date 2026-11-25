import React from "react";

export type StickerCardTone = "default" | "featured" | "accent" | "critical";

export interface StickerCardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Adds subtle corner-peel sticker microinteraction on hover. */
  peel?: boolean;
  /** Uses dashed die-cut perimeter contour (`die-cut-zone`). */
  dieCut?: boolean;
  /** Shows precision corner crop marks when `dieCut` is enabled. */
  registrationMarks?: boolean;
  /** Adds consistent interactive hover elevation and focus ring. */
  interactive?: boolean;
  /** Semantic surface & border emphasis without Tailwind utility cascade conflicts. */
  tone?: StickerCardTone;
  padding?: "none" | "sm" | "md" | "lg";
}

const PADDING_MAP: Record<NonNullable<StickerCardProps["padding"]>, string> = {
  none: "",
  sm: "p-4",
  md: "p-5 sm:p-6",
  lg: "p-6 sm:p-8",
};

const TONE_MAP: Record<StickerCardTone, { solid: string; dieCut: string; mark: string }> = {
  default: {
    solid: "border border-line-subtle bg-surface-card shadow-card",
    dieCut: "die-cut-zone border-line-diecut/75 bg-surface-card shadow-card hover:border-line-diecut",
    mark: "border-line-diecut/60",
  },
  featured: {
    solid: "border border-line-strong bg-surface-card shadow-elevated",
    dieCut: "die-cut-zone border-line-diecut bg-surface-card shadow-elevated",
    mark: "border-line-diecut",
  },
  accent: {
    solid: "border border-line-diecut/70 bg-accent-soft/45 shadow-card",
    dieCut: "die-cut-zone border-line-diecut bg-accent-soft/45 shadow-card",
    mark: "border-line-diecut",
  },
  critical: {
    solid: "border border-state-critical-bg bg-surface-elevated/60 shadow-card",
    dieCut: "die-cut-zone border-state-critical-bg bg-surface-elevated/60 shadow-card",
    mark: "border-state-critical-bg",
  },
};

export const StickerCard = React.forwardRef<HTMLDivElement, StickerCardProps>(
  (
    {
      peel = false,
      dieCut = false,
      registrationMarks = false,
      interactive = false,
      tone = "default",
      padding = "md",
      className = "",
      children,
      ...rest
    },
    ref
  ) => {
    const toneStyles = TONE_MAP[tone];

    return (
      <div
        ref={ref}
        className={`relative rounded-sticker text-ink-primary transition-all duration-base ease-studio ${
          dieCut ? toneStyles.dieCut : toneStyles.solid
        } ${
          peel ? "sticker-peel hover:border-line-strong" : ""
        } ${
          interactive
            ? "cursor-pointer hover:-translate-y-0.5 hover:border-line-strong hover:shadow-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface-canvas"
            : ""
        } ${PADDING_MAP[padding]} ${className}`}
        {...rest}
      >
        {dieCut && registrationMarks && (
          <>
            <span
              aria-hidden="true"
              className={`pointer-events-none absolute left-2.5 top-2.5 h-2.5 w-2.5 border-l-[1.5px] border-t-[1.5px] ${toneStyles.mark}`}
            />
            <span
              aria-hidden="true"
              className={`pointer-events-none absolute right-2.5 top-2.5 h-2.5 w-2.5 border-r-[1.5px] border-t-[1.5px] ${toneStyles.mark}`}
            />
            <span
              aria-hidden="true"
              className={`pointer-events-none absolute bottom-2.5 left-2.5 h-2.5 w-2.5 border-b-[1.5px] border-l-[1.5px] ${toneStyles.mark}`}
            />
            <span
              aria-hidden="true"
              className={`pointer-events-none absolute bottom-2.5 right-2.5 h-2.5 w-2.5 border-b-[1.5px] border-r-[1.5px] ${toneStyles.mark}`}
            />
          </>
        )}
        {children}
      </div>
    );
  }
);

StickerCard.displayName = "StickerCard";
